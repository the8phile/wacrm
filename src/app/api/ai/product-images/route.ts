import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/ai/product-images
 *
 * List the account's product photos (any member) — feeds the AI
 * settings page's product-photo manager, and (indirectly) the AI's
 * own [[SEND_IMAGE ...]] awareness via
 * src/lib/ai/product-images.ts:getProductImageContext.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('product_images')
      .select('id, product_name, image_url, caption, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[ai/product-images GET] error:', error)
      return NextResponse.json({ error: 'Failed to load product photos' }, { status: 500 })
    }
    return NextResponse.json({ images: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/product-images  (admin+)
 *
 * Records a product photo after the client has already uploaded the
 * file to the `product-media` Storage bucket (see
 * uploadAccountMedia in src/lib/storage/upload-media.ts) — this route
 * just saves the resulting public URL alongside the product name the
 * AI will match against.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-product-images:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const productName = typeof body?.productName === 'string' ? body.productName.trim() : ''
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : ''
    const storagePath = typeof body?.storagePath === 'string' ? body.storagePath.trim() : null
    const caption = typeof body?.caption === 'string' ? body.caption.trim() : null

    if (!productName || !imageUrl) {
      return NextResponse.json({ error: 'productName and imageUrl are required' }, { status: 400 })
    }
    if (productName.length > 100) {
      return NextResponse.json({ error: 'productName must be 100 characters or fewer' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('product_images')
      .insert({
        account_id: accountId,
        product_name: productName,
        image_url: imageUrl,
        storage_path: storagePath || null,
        caption: caption || null,
      })
      .select('id, product_name, image_url, caption, created_at')
      .single()

    if (error) {
      console.error('[ai/product-images POST] error:', error)
      return NextResponse.json({ error: 'Failed to save product photo' }, { status: 500 })
    }
    return NextResponse.json({ image: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
