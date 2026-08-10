import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'wacrm' } },
    )
  }
  return _adminClient
}

interface MessengerEntry {
  id: string // Page ID
  messaging?: Array<{
    sender: { id: string } // customer's PSID
    recipient: { id: string } // Page ID
    timestamp: number
    message?: {
      mid: string
      text?: string
      attachments?: Array<{ type: string; payload: { url?: string } }>
    }
  }>
}

interface MessengerWebhookBody {
  object: string
  entry: MessengerEntry[]
}

// GET — webhook verification (same hub.mode/challenge/verify_token
// handshake as the WhatsApp route, checked against messenger_config
// instead of whatsapp_config).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const challenge = searchParams.get('hub.challenge')
  const verifyToken = searchParams.get('hub.verify_token')

  if (mode !== 'subscribe' || !challenge || !verifyToken) {
    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
  }

  const { data: configs } = await supabaseAdmin()
    .from('messenger_config')
    .select('id, verify_token')

  const matched = (configs ?? []).some(
    (c: { verify_token: string | null }) => c.verify_token === verifyToken,
  )
  if (!matched) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
  }

  return new NextResponse(challenge, { status: 200 })
}

// POST — inbound messages + delivery/read events.
export async function POST(request: Request) {
  const rawBody = await request.text()

  // TEMPORARY debug aid — logs every stage of processing to a table
  // so delivery can be confirmed directly via SQL, independent of
  // Meta's own error panel (which only tracks verification issues,
  // not delivery/signature failures) and of Vercel log access.
  const debugLog = async (stage: string, detail?: string) => {
    try {
      await supabaseAdmin()
        .from('messenger_webhook_debug')
        .insert({ stage, detail: detail ?? null, raw_body: rawBody.slice(0, 2000) })
    } catch {
      // never let debug logging itself break the real flow
    }
  }
  await debugLog('post_received')

  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyMetaWebhookSignature(rawBody, signature, 'META_MESSENGER_APP_SECRET')) {
    // Report exactly what secret the server actually sees — length and
    // first/last 2 chars only (never the full value) — so a mismatch
    // between "what was saved" and "what's deployed" is provable
    // without exposing the secret itself.
    const seen = process.env.META_MESSENGER_APP_SECRET
    const fingerprint = seen
      ? `len=${seen.length} starts=${seen.slice(0, 2)} ends=${seen.slice(-2)}`
      : 'UNSET'
    await debugLog('signature_failed', `sig=${signature ?? 'none'} secret_seen=[${fingerprint}]`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  await debugLog('signature_ok')

  const body = JSON.parse(rawBody) as MessengerWebhookBody
  if (body.object !== 'page') {
    await debugLog('ignored_not_page', body.object)
    return NextResponse.json({ status: 'ignored' })
  }

  for (const entry of body.entry) {
    const pageId = entry.id
    if (!entry.messaging) {
      await debugLog('no_messaging_array', pageId)
      continue
    }

    const { data: config } = await supabaseAdmin()
      .from('messenger_config')
      .select('account_id, user_id')
      .eq('page_id', pageId)
      .maybeSingle()

    if (!config) {
      await debugLog('no_config_for_page', pageId)
      console.error('[messenger webhook] no config found for page_id:', pageId)
      continue
    }

    for (const event of entry.messaging) {
      // Only handle actual messages with text for now — attachments
      // sent BY the customer, postbacks, and read receipts are future
      // scope, not this pass.
      if (!event.message?.text) {
        await debugLog('no_message_text', JSON.stringify(event).slice(0, 500))
        continue
      }

      await processMessengerMessage(event, config.account_id, config.user_id)
    }
  }

  return NextResponse.json({ status: 'ok' })
}

async function processMessengerMessage(
  event: NonNullable<MessengerEntry['messaging']>[number],
  accountId: string,
  configOwnerUserId: string,
) {
  const db = supabaseAdmin()
  const psid = event.sender.id
  const text = event.message!.text!

  // Find or create the contact for this PSID. Messenger gives no name
  // on the message event itself (unlike WhatsApp's contacts.profile.name) —
  // fetching the person's name requires a separate Graph API call, which
  // is a follow-up, not blocking here. New contacts start unnamed; the
  // customer-profile context (getCustomerProfileContext) already handles
  // an unnamed contact gracefully.
  const { data: existingContact } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('channel', 'messenger')
    .eq('external_id', psid)
    .maybeSingle()

  let contactId = existingContact?.id as string | undefined
  if (!contactId) {
    const { data: newContact, error: contactErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        channel: 'messenger',
        external_id: psid,
      })
      .select('id')
      .single()
    if (contactErr || !newContact) {
      console.error('[messenger webhook] failed to create contact:', contactErr)
      return
    }
    contactId = newContact.id
  }

  const { data: existingConv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'messenger')
    .maybeSingle()

  let conversationId = existingConv?.id as string | undefined
  if (!conversationId) {
    const { data: newConv, error: convErr } = await db
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: configOwnerUserId,
        contact_id: contactId,
        channel: 'messenger',
      })
      .select('id')
      .single()
    if (convErr || !newConv) {
      console.error('[messenger webhook] failed to create conversation:', convErr)
      return
    }
    conversationId = newConv.id
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: text,
    message_id: event.message!.mid,
    status: 'delivered',
  })
  if (msgErr) {
    console.error('[messenger webhook] failed to insert inbound message:', msgErr)
    return
  }

  await db
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)

  // Same AI auto-reply pipeline WhatsApp uses — dispatchInboundToAiReply
  // is channel-aware (see src/lib/ai/auto-reply.ts) and will send back
  // through the Messenger Send API automatically based on this contact's
  // channel.
  await dispatchInboundToAiReply({
    accountId,
    conversationId: conversationId!,
    contactId: contactId!,
    configOwnerUserId,
  })
}
