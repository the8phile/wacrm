export interface CountryInfo {
  /** ISO 3166-1 alpha-3 — the value PawaPay's `country` param expects. */
  code: string
  /** ISO 3166-1 alpha-2, lowercase — used to build the flag image URL
   *  (flagcdn.com identifies countries by alpha-2, not alpha-3). */
  iso2: string
  name: string
  flag: string
  /** ISO 4217 currency code PawaPay charges in for this country. */
  currency: string
  /** Calling code without the leading "+", used to normalize a
   *  customer's locally-typed phone number into a full MSISDN. */
  callingCode: string
  /** Local subscriber number length (after the calling code) — a
   *  display hint only, not strictly enforced, since PawaPay itself
   *  validates and reports a specific error if the number is wrong. */
  phoneDigits: number
}

/**
 * Every country PawaPay has at least one active DEPOSIT provider for
 * (per the account's own active-conf check) — Nigeria is deliberately
 * excluded, since it currently has no active provider.
 */
export const SUPPORTED_COUNTRIES: CountryInfo[] = [
  { code: 'CMR', iso2: 'cm', name: 'Cameroon', flag: '🇨🇲', currency: 'XAF', callingCode: '237', phoneDigits: 9 },
  { code: 'GHA', iso2: 'gh', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', callingCode: '233', phoneDigits: 9 },
  { code: 'KEN', iso2: 'ke', name: 'Kenya', flag: '🇰🇪', currency: 'KES', callingCode: '254', phoneDigits: 9 },
  { code: 'UGA', iso2: 'ug', name: 'Uganda', flag: '🇺🇬', currency: 'UGX', callingCode: '256', phoneDigits: 9 },
  { code: 'TZA', iso2: 'tz', name: 'Tanzania', flag: '🇹🇿', currency: 'TZS', callingCode: '255', phoneDigits: 9 },
  { code: 'RWA', iso2: 'rw', name: 'Rwanda', flag: '🇷🇼', currency: 'RWF', callingCode: '250', phoneDigits: 9 },
  { code: 'ZMB', iso2: 'zm', name: 'Zambia', flag: '🇿🇲', currency: 'ZMW', callingCode: '260', phoneDigits: 9 },
  { code: 'MWI', iso2: 'mw', name: 'Malawi', flag: '🇲🇼', currency: 'MWK', callingCode: '265', phoneDigits: 9 },
  { code: 'MOZ', iso2: 'mz', name: 'Mozambique', flag: '🇲🇿', currency: 'MZN', callingCode: '258', phoneDigits: 9 },
  { code: 'COD', iso2: 'cd', name: 'DR Congo', flag: '🇨🇩', currency: 'CDF', callingCode: '243', phoneDigits: 9 },
  { code: 'COG', iso2: 'cg', name: 'Congo', flag: '🇨🇬', currency: 'XAF', callingCode: '242', phoneDigits: 9 },
  { code: 'GAB', iso2: 'ga', name: 'Gabon', flag: '🇬🇦', currency: 'XAF', callingCode: '241', phoneDigits: 8 },
  { code: 'CIV', iso2: 'ci', name: "Côte d'Ivoire", flag: '🇨🇮', currency: 'XOF', callingCode: '225', phoneDigits: 10 },
  { code: 'SEN', iso2: 'sn', name: 'Senegal', flag: '🇸🇳', currency: 'XOF', callingCode: '221', phoneDigits: 9 },
  { code: 'SLE', iso2: 'sl', name: 'Sierra Leone', flag: '🇸🇱', currency: 'SLE', callingCode: '232', phoneDigits: 8 },
]

export function getCountry(code: string): CountryInfo | undefined {
  return SUPPORTED_COUNTRIES.find((c) => c.code === code)
}

/**
 * Normalizes a customer-typed local phone number into a full MSISDN
 * for the given country — strips everything but digits, strips a
 * leading 0 (common in local formats), and prepends the calling code
 * unless it's already there.
 */
export function normalizePhoneForCountry(rawPhone: string, country: CountryInfo): string {
  const digitsOnly = rawPhone.replace(/[^\d]/g, '')
  if (digitsOnly.startsWith(country.callingCode)) return digitsOnly
  return `${country.callingCode}${digitsOnly.replace(/^0+/, '')}`
}
