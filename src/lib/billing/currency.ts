// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/**
 * Reads a cached USD exchange rate from wacrm.exchange_rates (kept
 * fresh by /api/cron/refresh-exchange-rates). Checkout never calls
 * an external rate API live — that would add an extra point of
 * failure to the actual payment flow. USD itself always converts
 * 1:1 without a DB lookup.
 */
export async function getExchangeRate(db: Db, currency: string): Promise<number | null> {
  if (currency === 'USD') return 1

  const { data } = await db
    .from('exchange_rates')
    .select('usd_rate')
    .eq('currency', currency)
    .maybeSingle()

  return data?.usd_rate ?? null
}

/**
 * Converts a USD price into the target currency using the cached
 * rate, rounded to a whole unit — PawaPay's `amount` field for these
 * currencies is not fractional in practice (mobile money doesn't
 * deal in cents).
 */
export function convertUsdAmount(usdAmount: number, rate: number): number {
  return Math.round(usdAmount * rate)
}
