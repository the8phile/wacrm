import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getPlanLimits, type PlanId } from '@/lib/billing/plan-limits'
import { initiatePaymentPage } from '@/lib/billing/pawapay'

/**
 * Resolves this deployment's own public URL, for building the
 * returnUrl PawaPay redirects the customer back to after payment.
 * Mirrors the same NEXT_PUBLIC_SITE_URL-first pattern already used by
 * the invitations route, falling back to the request's own forwarded
 * host if that env var isn't set.
 */
function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`

  return new URL(request.url).origin
}

/**
 * POST /api/billing/checkout
 *
 * Starts a PawaPay hosted payment-page session for a plan upgrade.
 * Only the account owner can initiate a real charge — this is a
 * spend decision, not something any team member should trigger.
 *
 * Uses PawaPay's own hosted UI (redirectUrl) for provider/phone
 * selection rather than building that form ourselves — the plan
 * price is fixed on our side, everything else is the customer's
 * choice on PawaPay's page.
 *
 * Creates a `payments` row up front (status='pending') so the
 * callback (or the status-polling fallback, triggered by the
 * depositId carried through returnUrl) has something to update
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

  const body = (await request.json().catch(() => null)) as { plan?: string } | null
  const plan = body?.plan

  if (plan !== 'starter' && plan !== 'pro') {
    return NextResponse.json({ error: "plan must be 'starter' or 'pro'" }, { status: 400 })
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

  const returnUrl = `${getBaseUrl(request)}/settings?tab=billing&depositId=${depositId}`

  try {
    const result = await initiatePaymentPage({
      depositId,
      amount: amountFcfa,
      returnUrl,
      reason: `wacrm ${plan} plan`,
    })

    if (!result.redirectUrl) {
      await ctx.supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('pawapay_deposit_id', depositId)
      return NextResponse.json(
        { error: result.rejectionReason?.rejectionMessage ?? 'Payment page request was rejected' },
        { status: 400 },
      )
    }

    return NextResponse.json({ depositId, redirectUrl: result.redirectUrl })
  } catch (err) {
    console.error('[billing/checkout] PawaPay request failed:', err)
    await ctx.supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('pawapay_deposit_id', depositId)
    return NextResponse.json({ error: 'Failed to reach payment provider' }, { status: 500 })
  }
}
