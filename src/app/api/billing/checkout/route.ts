import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getPlanLimits, type PlanId } from '@/lib/billing/plan-limits'
import { initiateDeposit } from '@/lib/billing/pawapay'

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
      phoneNumber,
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
    console.error('[billing/checkout] PawaPay request failed:', err)
    await ctx.supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('pawapay_deposit_id', depositId)
    return NextResponse.json({ error: 'Failed to reach payment provider' }, { status: 500 })
  }
}
