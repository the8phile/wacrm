import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * DELETE /api/ai/product-images/[id]  (admin+)
 *
 * Removes a product photo record and, best-effort, its Storage
 * object — a failed storage delete (e.g. already gone) never blocks
 * removing the record itself, matching deleteAccountMedia's own
 * best-effort contract.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-product-images:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params

    const { data: existing } = await supabase
      .from('product_images')
      .select('id, storage_path')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Product photo not found' }, { status: 404 })
    }

    const { error: deleteErr } = await supabase.from('product_images').delete().eq('id', id)
    if (deleteErr) {
      console.error('[ai/product-images DELETE] error:', deleteErr)
      return NextResponse.json({ error: 'Failed to delete product photo' }, { status: 500 })
    }

    if (existing.storage_path) {
      const { error: storageErr } = await supabaseAdmin()
        .storage.from('product-media')
        .remove([existing.storage_path])
      if (storageErr) {
        console.error('[ai/product-images DELETE] storage cleanup failed:', storageErr)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
