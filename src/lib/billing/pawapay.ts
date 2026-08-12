/**
 * Thin wrapper around PawaPay's v1 Merchant API — mirrors the shape
 * already proven working in a separate project (momo-wallet), so
 * this follows the same field names/endpoints rather than guessing
 * from documentation alone.
 *
 * PAWAPAY_API_URL should be the sandbox base (https://api.sandbox.pawapay.io)
 * while testing, switched to https://api.pawapay.io only once real
 * payments are ready to go live. PAWAPAY_API_TOKEN is the bearer
 * token from the PawaPay dashboard for that same environment.
 */

function baseUrl(): string {
  const url = process.env.PAWAPAY_API_URL
  if (!url) throw new Error('PAWAPAY_API_URL is not configured')
  return url
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
  return data?.countries?.[0]?.providers ?? []
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

export async function initiateDeposit(args: InitiateDepositArgs): Promise<PawaPayDepositResponse> { const res = await fetch(`${baseUrl()}/deposits`, {
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
