import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Stock awareness: a lightweight, no-UI-yet inventory table the AI
// checks on every reply so it can warn customers about low/out-of-stock
// items instead of quietly taking orders you can't fulfill.
// ============================================================

interface StockRow {
  product_name: string
  stock_qty: number
  low_stock_threshold: number
}

/**
 * Build a short stock-status note for the system prompt. Only mentions
 * items that are actually low or out — a full inventory dump would
 * bloat the prompt and drown out the business's own pricing text.
 * Returns null when nothing is noteworthy (keeps the prompt clean on a
 * normal day).
 */
export async function getStockContext(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('product_stock')
    .select('product_name, stock_qty, low_stock_threshold')
    .eq('account_id', accountId)

  if (error || !data || data.length === 0) return null

  const rows = data as StockRow[]
  const outOfStock = rows.filter((r) => r.stock_qty <= 0)
  const lowStock = rows.filter((r) => r.stock_qty > 0 && r.stock_qty <= r.low_stock_threshold)

  if (outOfStock.length === 0 && lowStock.length === 0) return null

  const lines: string[] = []
  for (const r of outOfStock) {
    lines.push(`${r.product_name}: OUT OF STOCK — do not take new orders for this item, offer an alternative or say it will be back soon.`)
  }
  for (const r of lowStock) {
    lines.push(`${r.product_name}: only ${r.stock_qty} left — you can still sell it, but mention stock is limited if they order a large quantity.`)
  }

  return `Current stock status (check this before confirming any order):\n${lines.join('\n')}`
}
