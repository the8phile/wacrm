import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkDepositStatus, activatePlanForPayment } from '@/lib/billing/pawapay'

/**
 * PawaPay's own documented recovery pattern: run a recheck cycle over
 * every payment still 'pending' for longer than 15 minutes. Covers
 * every way a payment can otherwise get stuck forever:
 *   - the callback never arrived (misconfigured URL, delivery issue)
 *   - the customer closed the tab before the client-side poll (see
 *     /api/billing/status/[depositId]) resolved it
 *   - our own initiateDeposit call was interrupted and we couldn't
 *     tell at the time whether it reached PawaPay (see the checkout
 *     route's catch block)
 *
 * 15 minutes is deliberate — checking too early risks a false
 * 'not_found' before PawaPay has indexed a deposit that's actually
 * fine; PawaPay's own example uses the same threshold.
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
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { data: stuck, error: findErr } = await db
    .from('payments')
    .select('id, account_id, plan, pawapay_deposit_id, status')
    .eq('status', 'pending')
    .lt('created_at', cutoff)

  if (findErr) {
    console.error('[recheck-pending-payments cron] lookup failed:', findErr)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }
  if (!stuck || stuck.length === 0) {
    return NextResponse.json({ checked: 0, completed: 0, failed: 0, stillPending: 0 })
  }

  let completed = 0
  let failed = 0
  let stillPending = 0

  for (const payment of stuck) {
    const check = await checkDepositStatus(payment.pawapay_deposit_id)

    if (check.outcome === 'not_found') {
      // Confirmed PawaPay never received it — safe to fail after 15
      // minutes of grace.
      await db.from('payments').update({ status: 'failed' }).eq('id', payment.id)
      failed++
      continue
    }

    if (check.outcome === 'found') {
      if (check.data.status === 'COMPLETED') {
        await activatePlanForPayment(db, payment)
        completed++
      } else if (check.data.status === 'FAILED') {
        await db.from('payments').update({ status: 'failed' }).eq('id', payment.id)
        failed++
      } else {
        // Still ACCEPTED/SUBMITTED at PawaPay — genuinely still in
        // flight, leave for the next cycle.
        stillPending++
      }
      continue
    }

    // 'unknown' — couldn't get a clean answer this cycle (network
    // issue, PawaPay temporarily unreachable). Leave pending; try
    // again next run rather than guess.
    stillPending++
  }

  return NextResponse.json({ checked: stuck.length, completed, failed, stillPending })
}
