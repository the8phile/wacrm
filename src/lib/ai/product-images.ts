import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Product-photo awareness: tells the AI which exact product names
// have a photo on file, so it only ever emits a [[SEND_IMAGE ...]]
// sentinel (see ./defaults.ts) for something that actually exists —
// never a guessed or misspelled product name.
// ============================================================

/**
 * Build a short "here's what photos you can send" note for the
 * system prompt. Returns null when the account hasn't uploaded any
 * product photos yet (keeps the prompt clean, and the model falls
 * back to telling the customer it has no photo).
 */
export async function getProductImageContext(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('product_images')
    .select('product_name')
    .eq('account_id', accountId)

  if (error || !data || data.length === 0) return null

  const names = data.map((r) => `"${r.product_name}"`).join(', ')
  return (
    `Product photos available (use the [[SEND_IMAGE product="..."]] sentinel with the ` +
    `EXACT name from this list when a customer asks to see one of these): ${names}`
  )
}
