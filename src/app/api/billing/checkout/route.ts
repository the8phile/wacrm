import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getPlanLimits, type PlanId } from '@/lib/billing/plan-limits'
import { initiateDeposit, checkDepositStatus } from '@/lib/billing/pawapay'

/**
 * POST /api/billing/checkout
 *
 * Starts a PawaPay mobile money deposit for a plan upgrade. Only the
 * account owner can initiate a real charge — this is a spend
 * decision, not something any team member should be able to trigger.
 *
 * Creates a `payments` row up front (status='pending') so the
 * callback (or the status-polling fallback) has something to update
 * regardless of which arrives first or whether the customer abandons
 * the flow entirely.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('owner')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as {
    plan?: string
    phoneNumber?: string
    provider?: string
  } | null

  const plan = body?.plan
  const phoneNumber = body?.phoneNumber?.trim()
  const provider = body?.provider?.trim()

  if (plan !== 'starter' && plan !== 'pro') {
    return NextResponse.json({ error: "plan must be 'starter' or 'pro'" }, { status: 400 })
  }
  if (!phoneNumber || !provider) {
    return NextResponse.json({ error: 'phoneNumber and provider are required' }, { status: 400 })
  }

  // PawaPay expects the full MSISDN including country code (e.g.
  // "237670114225"), but a customer naturally types their local
  // 9-digit number (e.g. "670114225") — normalize rather than reject,
  // since this is Cameroon-only (country="CMR" everywhere else in
  // this billing flow) so the 237 prefix is always correct here.
  const digitsOnly = phoneNumber.replace(/[^\d]/g, '')
  const normalizedPhone = digitsOnly.startsWith('237') ? digitsOnly : `237${digitsOnly.replace(/^0+/, '')}`

  const amountFcfa = getPlanLimits(plan as PlanId).priceFcfa
  const depositId = randomUUID()

  const { error: insertErr } = await ctx.supabase.from('payments').insert({
    account_id: ctx.accountId,
    plan,
    amount_fcfa: amountFcfa,
    pawapay_deposit_id: depositId,
    status: 'pending',
  })
  if (insertErr) {
    console.error('[billing/checkout] failed to record payment:', insertErr)
    return NextResponse.json({ error: 'Failed to start checkout' }, { status: 500 })
  }

  try {
    const result = await initiateDeposit({
      depositId,
      amount: amountFcfa,
      currency: 'XAF',
      phoneNumber: normalizedPhone,
      provider,
    })

    if (result.status !== 'ACCEPTED') {
      await ctx.supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('pawapay_deposit_id', depositId)
      return NextResponse.json(
        { error: result.failureReason?.failureMessage ?? 'Payment request was rejected' },
        { status: 400 },
      )
    }

    return NextResponse.json({ depositId, status: 'ACCEPTED' })
  } catch (err) {
    // PawaPay's own guidance: a network error/timeout here doesn't
    // tell you whether the request actually reached them — it might
    // have been accepted and we just never saw the response. Check
    // before assuming failure, so a real payment in flight isn't
    // wrongly marked failed (which would mean charging the customer
    // without ever activating their plan).
    console.error('[billing/checkout] PawaPay request failed, checking whether it landed:', err)
    const check = await checkDepositStatus(depositId)

    if (check.outcome === 'not_found') {
      // Confirmed it never reached PawaPay. Safe to fail.
      await ctx.supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('pawapay_deposit_id', depositId)
      return NextResponse.json({ error: 'Failed to reach payment provider' }, { status: 500 })
    }

    // 'found' or 'unknown' — either it did land at PawaPay, or we
    // simply can't tell yet. Leave status as 'pending' either way;
    // the callback and the recheck cron (see
    // /api/cron/recheck-pending-payments) will resolve it from here.
    return NextResponse.json({ depositId, status: 'ACCEPTED' })
  }
}
