import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   The chosen secret env var is **required**. If it's missing we fail
 *   closed — every request is rejected until the operator configures
 *   the secret. A previous version fell open with a warning log, which
 *   is unsafe for a public template: anyone who forgets the env var
 *   would be running a fully spoofable webhook.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  /** Which env var holds the signing secret. WhatsApp and Messenger
   *  are commonly two separate Meta Apps with two separate App
   *  Secrets — pass 'META_MESSENGER_APP_SECRET' from the Messenger
   *  webhook route if that's the case for this deployment. Defaults
   *  to the original WhatsApp-only env var for backward compatibility. */
  secretEnvVar: 'META_APP_SECRET' | 'META_MESSENGER_APP_SECRET' = 'META_APP_SECRET',
): boolean {
  const secret = process.env[secretEnvVar]
  if (!secret) {
    console.error(
      `[webhook] ${secretEnvVar} is not set — rejecting request. ` +
        'Configure the env var (Meta → App Settings → Basic → App Secret) ' +
        'to enable signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
