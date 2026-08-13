import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getPlanLimits, type PlanId } from '@/lib/billing/plan-limits'
import { initiateDeposit, checkDepositStatus } from '@/lib/billing/pawapay'
import { getCountry, normalizePhoneForCountry } from '@/lib/billing/countries'
import { getExchangeRate, convertUsdAmount } from '@/lib/billing/currency'

/**
 * POST /api/billing/checkout
 *
 * Starts a PawaPay mobile money deposit for a plan upgrade, for any
 * of the countries in src/lib/billing/countries.ts. Only the account
 * owner can initiate a real charge — this is a spend decision, not
 * something any team member should be able to trigger.
 *
 * Plans are priced in USD (see plan-limits.ts) and converted into
 * the customer's own currency here using a cached exchange rate
 * (never a live external call during checkout itself — see
 * src/lib/billing/currency.ts).
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
    country?: string
    phoneNumber?: string
    provider?: string
  } | null

  const plan = body?.plan
  const countryCode = body?.country
  const phoneNumber = body?.phoneNumber?.trim()
  const provider = body?.provider?.trim()

  if (plan !== 'starter' && plan !== 'pro') {
    return NextResponse.json({ error: "plan must be 'starter' or 'pro'" }, { status: 400 })
  }
  const country = countryCode ? getCountry(countryCode) : undefined
  if (!country) {
    return NextResponse.json({ error: 'Unsupported or missing country' }, { status: 400 })
  }
  if (!phoneNumber || !provider) {
    return NextResponse.json({ error: 'phoneNumber and provider are required' }, { status: 400 })
  }

  const rate = await getExchangeRate(ctx.supabase, country.currency)
  if (rate === null) {
    // No cached rate for this currency yet (e.g. the refresh cron
    // hasn't run since it was added, or the provider dropped it) —
    // refuse rather than guess a price.
    return NextResponse.json(
      { error: `Pricing temporarily unavailable for ${country.currency}. Please try again shortly.` },
      { status: 503 },
    )
  }

  const priceUsd = getPlanLimits(plan as PlanId).priceUsd
  const localAmount = convertUsdAmount(priceUsd, rate)
  const normalizedPhone = normalizePhoneForCountry(phoneNumber, country)
  const depositId = randomUUID()

  const { error: insertErr } = await ctx.supabase.from('payments').insert({
    account_id: ctx.accountId,
    plan,
    amount: localAmount,
    currency: country.currency,
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
      amount: localAmount,
      currency: country.currency,
      phoneNumber: normalizedPhone,
      provider,
    })

    if (result.status !== 'ACCEPTED') {
      await ctx.supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('pawapay_deposit_id', depositId)
      const reason = result.failureReason?.failureMessage ?? 'Payment request was rejected'
      // Include exactly what we sent — the number PawaPay is judging
      // "too long/short" against — so a length-mismatch report can be
      // traced immediately instead of guessed at.
      return NextResponse.json(
        { error: `${reason} (sent: ${normalizedPhone}, ${country.name})` },
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
