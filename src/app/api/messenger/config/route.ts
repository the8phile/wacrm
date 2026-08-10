import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'wacrm' } },
    )
  }
  return _adminClient
}

/**
 * POST /api/messenger/config
 *
 * Save (or update) this account's Messenger Page connection. The
 * Page Access Token is encrypted server-side with the same
 * encrypt() helper whatsapp_config.access_token uses — this route
 * exists specifically so that encryption can happen with the live
 * ENCRYPTION_KEY, which only the deployed app has access to.
 *
 * Body: { page_id: string, page_access_token: string, verify_token?: string }
 * Requires an authenticated session with at least the 'admin' role
 * (same bar as connecting WhatsApp).
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as {
    page_id?: string
    page_access_token?: string
    verify_token?: string
  } | null

  if (!body?.page_id || !body?.page_access_token) {
    return NextResponse.json(
      { error: 'page_id and page_access_token are required' },
      { status: 400 },
    )
  }

  const db = supabaseAdmin()
  const encryptedToken = encrypt(body.page_access_token)

  const { error } = await db
    .from('messenger_config')
    .upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        page_id: body.page_id,
        page_access_token: encryptedToken,
        ...(body.verify_token ? { verify_token: body.verify_token } : {}),
        status: 'connected',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )

  if (error) {
    console.error('[messenger config] save failed:', error)
    return NextResponse.json({ error: 'Failed to save Messenger config' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/** GET /api/messenger/config — check current connection status
 *  (mirrors the shape whatsapp/config's GET returns, minus the
 *  live phone-number verification call Messenger has no equivalent
 *  for). Never returns the decrypted token. */
export async function GET() {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data } = await ctx.supabase
    .from('messenger_config')
    .select('page_id, status, connected_at, page_access_token')
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  if (!data) {
    return NextResponse.json({ connected: false, reason: 'no_config' })
  }

  // A placeholder row (created before the real token is saved) should
  // read as not-yet-connected, not as a broken connection.
  const looksReal = data.page_id !== 'pending-setup'
  let tokenLooksValid = false
  if (looksReal) {
    try {
      decrypt(data.page_access_token)
      tokenLooksValid = true
    } catch {
      tokenLooksValid = false
    }
  }

  return NextResponse.json({
    connected: looksReal && tokenLooksValid && data.status === 'connected',
    page_id: looksReal ? data.page_id : null,
    connected_at: data.connected_at,
  })
}

/** POST /api/messenger/config/test — actually calls Meta's Graph API
 *  with the saved token to check whether the Page has genuinely
 *  installed this app for message events. This is the real signal —
 *  the Messenger dashboard's checkbox UI can look "subscribed" while
 *  the underlying installation never went through. Returns Meta's
 *  raw response so the real failure reason (bad permission, expired
 *  token, not installed) is visible instead of guessed at. */
export async function PUT() {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data } = await ctx.supabase
    .from('messenger_config')
    .select('page_id, page_access_token')
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  if (!data || data.page_id === 'pending-setup') {
    return NextResponse.json({ error: 'No Messenger config saved yet' }, { status: 400 })
  }

  let token: string
  try {
    token = decrypt(data.page_access_token)
  } catch {
    return NextResponse.json({ error: 'Saved token could not be decrypted — re-save it' }, { status: 400 })
  }

  const url = `https://graph.facebook.com/v21.0/${data.page_id}/subscribed_apps?access_token=${encodeURIComponent(token)}`
  const metaRes = await fetch(url)
  const metaBody = await metaRes.json().catch(() => null)

  return NextResponse.json({
    page_id: data.page_id,
    http_status: metaRes.status,
    meta_response: metaBody,
  })
}
