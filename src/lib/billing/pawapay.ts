/**
 * Thin wrapper around PawaPay's v2 Merchant API.
 *
 * IMPORTANT: v1 and v2 are genuinely different APIs with separate
 * sandbox test data — v1 uses bare paths like /deposits with a
 * `correspondent` field and MSISDN payer type; v2 uses /v2/deposits
 * with a `payer.accountDetails.provider` shape (what this file uses).
 * Calling v1 paths against a dashboard/token set up for v2 can
 * silently return empty/different data rather than an obvious error
 * — that's what happened here (Cameroon showed configured in the
 * dashboard but v1's /active-conf returned nothing for it).
 *
 * PAWAPAY_API_URL should be the bare sandbox host
 * (https://api.sandbox.pawapay.io) — this file appends /v2/... itself
 * — switched to https://api.pawapay.io only once real payments are
 * ready to go live. PAWAPAY_API_TOKEN is the bearer token from the
 * PawaPay dashboard for that same environment.
 */

function baseUrl(): string {
  const url = process.env.PAWAPAY_API_URL
  if (!url) throw new Error('PAWAPAY_API_URL is not configured')
  return `${url}/v2`
}

function authHeaders(): Record<string, string> {
  const token = process.env.PAWAPAY_API_TOKEN
  if (!token) throw new Error('PAWAPAY_API_TOKEN is not configured')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export interface PawaPayProvider {
  provider: string
  operationTypes: Record<string, string>
}

/**
 * Discover which mobile money providers are actually available for a
 * country right now, rather than hardcoding correspondent codes that
 * can change or vary by merchant configuration.
 */
export async function getAvailableProviders(country: string): Promise<PawaPayProvider[]> {
  const res = await fetch(
    `${baseUrl()}/active-conf?country=${encodeURIComponent(country)}&operationType=DEPOSIT`,
    { headers: authHeaders() },
  )
  if (!res.ok) {
    // Include PawaPay's own response body when we can — a 401 here is
    // almost always PAWAPAY_API_TOKEN being wrong/missing, and their
    // body usually says so explicitly rather than us just guessing.
    const bodyText = await res.text().catch(() => '')
    throw new Error(`PawaPay active-conf request failed (${res.status}): ${bodyText || 'no response body'}`)
  }
  const data = await res.json()
  // The response is a list of every enabled country, in whatever
  // order PawaPay returns them — NOT scoped to the `country` query
  // param the way the endpoint name might suggest. Find the entry
  // that actually matches, rather than blindly taking countries[0]
  // (which silently returned a *different* country's providers here).
  const countries = data?.countries ?? []
  const match = countries.find(
    (c: { country?: string }) => c?.country === country,
  )
  if (!match) {
    // Diagnostic only — surfaces exactly what country codes PawaPay
    // actually returned, since a mismatch here (wrong field name,
    // different response shape than expected, or the account
    // genuinely has no config for this country/environment) can't be
    // told apart from a real "empty" any other way without server
    // log access.
    const codesSeen = countries.map((c: { country?: string }) => c?.country)
    throw new Error(
      `No active-conf entry matched country "${country}". Countries PawaPay returned: ${JSON.stringify(codesSeen)}`,
    )
  }
  return match.providers ?? []
}

export interface InitiateDepositArgs {
  depositId: string
  amount: number
  currency: string
  phoneNumber: string
  provider: string
}

export interface PawaPayDepositResponse {
  status: string
  failureReason?: { failureCode: string; failureMessage: string }
}

export async function initiateDeposit(args: InitiateDepositArgs): Promise<PawaPayDepositResponse> {
  const res = await fetch(`${baseUrl()}/deposits`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      depositId: args.depositId,
      amount: String(args.amount),
      currency: args.currency,
      payer: {
        type: 'MMO',
        accountDetails: {
          phoneNumber: args.phoneNumber,
          provider: args.provider,
        },
      },
      // Required by v2 (4–22 chars) — shown to the customer on the
      // PIN prompt / SMS receipt by some providers.
      customerMessage: 'wacrm plan upgrade',
    }),
  })
  return res.json()
}

export interface PawaPayDepositStatus {
  depositId: string
  status: 'ACCEPTED' | 'COMPLETED' | 'FAILED' | 'SUBMITTED'
  failureReason?: { failureCode: string; failureMessage: string }
}

export async function checkDepositStatus(depositId: string): Promise<PawaPayDepositStatus | null> {
  const res = await fetch(`${baseUrl()}/deposits/${depositId}`, { headers: authHeaders() })
  if (!res.ok) return null
  const data = await res.json()
  if (data?.status !== 'FOUND') return null
  return data.data
}

/**
 * Marks a payment row completed and activates the paid plan on its
 * account for 30 days from now. Shared by both the PawaPay callback
 * (the primary path) and the status-polling fallback (for when a
 * callback never arrives — network issues, misconfiguration, etc.),
 * so a completed payment is recognized no matter which one notices
 * it first. Safe to call twice for the same deposit: the payments
 * row's status column makes the second call a no-op via the caller's
 * own "already completed" check before invoking this.
 */
export async function activatePlanForPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  payment: { id: string; account_id: string; plan: string },
): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  await db
    .from('payments')
    .update({ status: 'completed', completed_at: now.toISOString() })
    .eq('id', payment.id)

  await db
    .from('accounts')
    .update({
      plan: payment.plan,
      subscription_status: 'active',
      plan_expires_at: expiresAt.toISOString(),
    })
    .eq('id', payment.account_id)
}
