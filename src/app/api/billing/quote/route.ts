import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getPlanLimits, type PlanId } from '@/lib/billing/plan-limits'
import { getCountry } from '@/lib/billing/countries'
import { getExchangeRate, convertUsdAmount } from '@/lib/billing/currency'

/**
 * GET /api/billing/quote?country=XXX&plan=starter|pro
 *
 * Converts the plan's canonical USD price into the requested
 * country's currency, using the same cached rate checkout itself
 * uses — so the price the customer sees here always matches what
 * they're actually charged.
 */
export async function GET(request: Request) {
  let ctx
  try {
    ctx = await requireRole('viewer')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { searchParams } = new URL(request.url)
  const plan = searchParams.get('plan')
  const countryCode = searchParams.get('country')

  if (plan !== 'starter' && plan !== 'pro') {
    return NextResponse.json({ error: "plan must be 'starter' or 'pro'" }, { status: 400 })
  }
  const country = countryCode ? getCountry(countryCode) : undefined
  if (!country) {
    return NextResponse.json({ error: 'Unsupported or missing country' }, { status: 400 })
  }

  const rate = await getExchangeRate(ctx.supabase, country.currency)
  if (rate === null) {
    return NextResponse.json(
      { error: `Pricing temporarily unavailable for ${country.currency}` },
      { status: 503 },
    )
  }

  const priceUsd = getPlanLimits(plan as PlanId).priceUsd
  const amount = convertUsdAmount(priceUsd, rate)

  return NextResponse.json({ currency: country.currency, amount, priceUsd })
}
