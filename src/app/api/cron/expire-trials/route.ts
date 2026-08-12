import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * Downgrades any account still 'trialing' past its trial_ends_at to
 * plan='free' / subscription_status='free'. Accounts that upgraded
 * to a real Flutterwave subscription during the trial are already
 * subscription_status='active' by then and are untouched here.
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

  const { data: expired, error: findErr } = await db
    .from('accounts')
    .select('id')
    .eq('subscription_status', 'trialing')
    .lt('trial_ends_at', new Date().toISOString())

  if (findErr) {
    console.error('[expire-trials cron] lookup failed:', findErr)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }
  if (!expired || expired.length === 0) {
    return NextResponse.json({ downgraded: 0 })
  }

  const { error: updateErr } = await db
    .from('accounts')
    .update({ plan: 'free', subscription_status: 'free' })
    .in('id', expired.map((a) => a.id))

  if (updateErr) {
    console.error('[expire-trials cron] downgrade failed:', updateErr)
    return NextResponse.json({ error: 'downgrade failed' }, { status: 500 })
  }

  return NextResponse.json({ downgraded: expired.length })
}
