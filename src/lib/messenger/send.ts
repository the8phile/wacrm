import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendMessengerText, sendMessengerMedia, type MessengerMediaKind } from './meta-api'

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

interface SendMessengerTextEngineArgs {
  accountId: string
  conversationId: string
  contactId: string
  text: string
  aiGenerated?: boolean
}

/**
 * Send a text message on Messenger and persist it, mirroring
 * `engineSendText` in ../flows/meta-send.ts. Same DB shape (the
 * `messages` / `conversations` tables are shared across channels),
 * different transport (Messenger Send API, PSID recipient instead
 * of a phone number).
 */
export async function engineSendMessengerText(
  args: SendMessengerTextEngineArgs,
): Promise<{ message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, external_id')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.external_id) {
    throw new Error('Messenger contact not found for this account')
  }

  const { data: config, error: configErr } = await db
    .from('messenger_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('Messenger not configured for this account')
  }

  const pageAccessToken = decrypt(config.page_access_token)

  const { messageId } = await sendMessengerText({
    pageId: config.page_id,
    pageAccessToken,
    recipientId: contact.external_id,
    text: args.text,
  })

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: messageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { message_id: messageId }
}

interface SendMessengerMediaEngineArgs {
  accountId: string
  conversationId: string
  contactId: string
  kind: MessengerMediaKind
  /** Public URL Meta fetches at send time. */
  url: string
}

/** Send an image/video/audio/file on Messenger and persist it —
 *  Messenger counterpart to `engineSendMedia` in ../flows/meta-send.ts. */
export async function engineSendMessengerMedia(
  args: SendMessengerMediaEngineArgs,
): Promise<{ message_id: string }> {
  const db = supabaseAdmin()

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, external_id')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.external_id) {
    throw new Error('Messenger contact not found for this account')
  }

  const { data: config, error: configErr } = await db
    .from('messenger_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('Messenger not configured for this account')
  }

  const pageAccessToken = decrypt(config.page_access_token)

  const { messageId } = await sendMessengerMedia({
    pageId: config.page_id,
    pageAccessToken,
    recipientId: contact.external_id,
    kind: args.kind,
    url: args.url,
  })

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind === 'file' ? 'document' : args.kind,
    message_id: messageId,
    status: 'sent',
    ai_generated: true,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', args.conversationId)

  return { message_id: messageId }
}
