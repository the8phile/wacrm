import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Customer-identity awareness: tells the AI who it's talking to
// and whether they've ordered before, so replies can use the
// customer's name and treat repeat buyers differently from a
// first-time contact — without this, the model has no idea who
// sent the message beyond the raw text.
// ============================================================

/**
 * Build a short "who is this customer" note for the system prompt.
 * Always returns something (even for a brand-new, unnamed contact)
 * so the model never has to guess.
 */
export async function getCustomerProfileContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string> {
  const { data: contact } = await db
    .from('contacts')
    .select('name')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  const name = contact?.name?.trim() || null

  // Count this contact's past deals (orders) to detect a repeat
  // customer. Any prior deal counts — win or lose — since even a
  // past inquiry means the AI shouldn't treat them as a total
  // stranger.
  const { count } = await db
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)

  const priorOrders = count ?? 0

  const nameNote = name
    ? `This customer's name is "${name}" — greet them by name and use it naturally in conversation.`
    : `This customer has no name on file yet — if they introduce themselves, remember it for the rest of this conversation; otherwise don't ask for it unless it's relevant to completing an order.`

  const historyNote =
    priorOrders > 0
      ? `They are a RETURNING customer with ${priorOrders} prior order${priorOrders === 1 ? '' : 's'} — acknowledge that they've ordered before (e.g. "welcome back") rather than treating them like a first-time visitor.`
      : `They have no prior orders on file — this looks like their first time ordering, so a normal first-time welcome is appropriate.`

  return `${nameNote} ${historyNote}`
}
