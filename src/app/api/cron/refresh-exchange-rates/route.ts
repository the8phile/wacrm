import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { SUPPORTED_COUNTRIES } from '@/lib/billing/countries'

/**
 * Refreshes wacrm.exchange_rates from open.er-api.com — a free,
 * keyless endpoint that updates once daily, which is exactly why
 * this only needs to run once daily too (running more often just
 * re-fetches the same numbers). Checkout always reads the cached
 * table (see src/lib/billing/currency.ts), never this API directly,
 * so a slow/down rate provider can never block a real payment.
 *
 * Same shared-secret pattern as the other cron routes (see
 * /api/cron/abandoned-followup).
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

  let data: { result?: string; rates?: Record<string, number> }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD')
    if (!res.ok) throw new Error(`open.er-api.com returned ${res.status}`)
    data = await res.json()
  } catch (err) {
    console.error('[refresh-exchange-rates cron] fetch failed:', err)
    return NextResponse.json({ error: 'Failed to fetch exchange rates' }, { status: 502 })
  }

  if (data.result !== 'success' || !data.rates) {
    console.error('[refresh-exchange-rates cron] unexpected response shape:', data)
    return NextResponse.json({ error: 'Unexpected response from rate provider' }, { status: 502 })
  }

  // Only the currencies we actually bill in, deduplicated (multiple
  // countries share XAF/XOF).
  const currencies = Array.from(new Set(SUPPORTED_COUNTRIES.map((c) => c.currency)))
  const db = supabaseAdmin()

  let updated = 0
  const missing: string[] = []

  for (const currency of currencies) {
    const rate = data.rates[currency]
    if (typeof rate !== 'number') {
      // Leave the previously-cached rate in place rather than wipe
      // it — a stale-but-present rate is safer than none at all.
      missing.push(currency)
      continue
    }
    const { error } = await db
      .from('exchange_rates')
      .upsert({ currency, usd_rate: rate, updated_at: new Date().toISOString() })
    if (error) {
      console.error(`[refresh-exchange-rates cron] failed to upsert ${currency}:`, error)
    } else {
      updated++
    }
  }

  return NextResponse.json({ updated, missing })
}
