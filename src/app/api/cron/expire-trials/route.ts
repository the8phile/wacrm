import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * Downgrades to plan='free' / subscription_status='free' any account
 * whose paid access has run out:
 *   - still 'trialing' past trial_ends_at (never converted), or
 *   - 'active' (a real PawaPay payment) past plan_expires_at (the
 *     one-time 30-day charge lapsed and wasn't renewed — see
 *     src/lib/billing/pawapay.ts activatePlanForPayment).
 *
 * Same shared-secret pattern as the other cron routes (see
 * /api/cron/abandoned-followup) — one external pinger can cover all
 * of them by hitting each URL on a schedule with the same header.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  const now = new Date().toISOString()

  const [{ data: expiredTrials, error: trialErr }, { data: expiredPaid, error: paidErr }] =
    await Promise.all([
      db.from('accounts').select('id').eq('subscription_status', 'trialing').lt('trial_ends_at', now),
      db.from('accounts').select('id').eq('subscription_status', 'active').lt('plan_expires_at', now),
    ])

  if (trialErr || paidErr) {
    console.error('[expire-trials cron] lookup failed:', trialErr ?? paidErr)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }

  const expiredIds = [...(expiredTrials ?? []), ...(expiredPaid ?? [])].map((a) => a.id)
  if (expiredIds.length === 0) {
    return NextResponse.json({ downgraded: 0 })
  }

  const { error: updateErr } = await db
    .from('accounts')
    .update({ plan: 'free', subscription_status: 'free' })
    .in('id', expiredIds)

  if (updateErr) {
    console.error('[expire-trials cron] downgrade failed:', updateErr)
    return NextResponse.json({ error: 'downgrade failed' }, { status: 500 })
  }

  return NextResponse.json({ downgraded: expiredIds.length })
}
