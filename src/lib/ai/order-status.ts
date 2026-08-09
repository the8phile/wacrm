import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Order-status awareness: lets the AI auto-reply answer "where is
// my order?" style questions by reading the customer's own deals
// and current pipeline stage, instead of guessing or stalling for
// a human. Mirrors getStockContext's shape (see ./stock.ts).
// ============================================================

interface OrderStatusRow {
  title: string
  created_at: string
  status: string | null
  pipeline_stages: { name: string } | { name: string }[] | null
}

/**
 * Build a short "here's what this customer has on order" note for
 * the system prompt, scoped to the contact currently messaging in
 * (never another customer's orders — contactId comes from the
 * inbound conversation, so this can't cross accounts or contacts).
 *
 * Only looks at this contact's most recent deals so the prompt
 * stays small. Returns null when the contact has no deals yet
 * (keeps the prompt clean for first-time customers).
 */
export async function getOrderStatusContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('deals')
    .select('title, created_at, status, pipeline_stages(name)')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(3)

  if (error || !data || data.length === 0) return null

  const rows = data as unknown as OrderStatusRow[]
  const lines = rows.map((r) => {
    const stageField = r.pipeline_stages
    const stageName = Array.isArray(stageField) ? stageField[0]?.name : stageField?.name
    const placedOn = new Date(r.created_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
    })
    return `"${r.title}" (placed ${placedOn}) — current status: ${stageName ?? 'unknown'}${r.status === 'closed' ? ' (closed)' : ''}`
  })

  return (
    `This customer's recent order(s) — use this to answer "where is my order" ` +
    `or status questions, and don't invent a status that isn't listed here:\n${lines.join('\n')}`
  )
}
