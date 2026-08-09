/**
 * Meta Messenger Platform API helpers.
 *
 * Mirrors the style of src/lib/whatsapp/meta-api.ts (named-param
 * options objects, MetaSendResult shape) so the two channels' send
 * paths read the same way. Key differences from WhatsApp:
 *   - Recipient is a Page-Scoped ID (PSID), not a phone number.
 *   - The Send API endpoint is POST /{PAGE-ID}/messages, authorized
 *     with the Page Access Token as a query param (not a header).
 *   - Messenger enforces a 24-hour messaging window from the
 *     customer's last message unless a message tag applies — this
 *     client does not attempt to work around that; callers should
 *     expect Meta to reject sends outside the window.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface SendMessengerTextArgs {
  pageId: string
  pageAccessToken: string
  /** Recipient's Page-Scoped ID (PSID), from the inbound webhook's sender.id. */
  recipientId: string
  text: string
}

export async function sendMessengerText(args: SendMessengerTextArgs): Promise<MetaSendResult> {
  const { pageId, pageAccessToken, recipientId, text } = args
  const url = `${META_API_BASE}/${pageId}/messages?access_token=${encodeURIComponent(pageAccessToken)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient: { id: recipientId },
      message: { text },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Messenger send error: ${response.status}`)
  }
  const data = (await response.json()) as { message_id: string }
  return { messageId: data.message_id }
}

export type MessengerMediaKind = 'image' | 'video' | 'audio' | 'file'

export interface SendMessengerMediaArgs {
  pageId: string
  pageAccessToken: string
  recipientId: string
  kind: MessengerMediaKind
  /** Public URL Meta fetches at send time — same contract as WhatsApp's `link`. */
  url: string
}

export async function sendMessengerMedia(
  args: SendMessengerMediaArgs,
): Promise<MetaSendResult> {
  const { pageId, pageAccessToken, recipientId, kind, url: mediaUrl } = args
  const url = `${META_API_BASE}/${pageId}/messages?access_token=${encodeURIComponent(pageAccessToken)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient: { id: recipientId },
      message: {
        attachment: { type: kind, payload: { url: mediaUrl, is_reusable: true } },
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Messenger send error: ${response.status}`)
  }
  const data = (await response.json()) as { message_id: string }
  return { messageId: data.message_id }
}
