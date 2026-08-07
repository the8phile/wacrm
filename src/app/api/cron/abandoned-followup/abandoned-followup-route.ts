import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { engineSendText } from '@/lib/flows/meta-send'

/**
 * Finds WhatsApp conversations that went quiet 4-48h after the
 * customer's last message with no order placed since, and sends one
 * gentle "still interested?" nudge — then tags the contact so it's
 * never sent twice for the same lull.
 *
 * Meant to be hit on a schedule (same shared secret + header as
 * `/api/automations/cron` and `/api/flows/cron` — one external
 * pinger, e.g. cron-job.org, can cover all three).
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()

  const { data: candidates, error } = await db.rpc('find_abandoned_conversations')
  if (error) {
    console.error('[abandoned-followup cron] lookup failed:', error)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  const { data: sentTag } = await db
    .from('tags')
    .select('id')
    .eq('name', 'Abandoned Follow-up Sent')
    .limit(1)
    .maybeSingle()

  const FOLLOW_UP_TEXT =
    'Hi! Just checking in, are you still interested in your order? Happy to help if you have any questions.\n\n' +
    'Francais: Bonjour! Juste pour verifier, etes-vous toujours interesse par votre commande? N\'hesitez pas si vous avez des questions.'

  let sent = 0
  for (const row of candidates as {
    conversation_id: string
    contact_id: string
    account_id: string
    user_id: string
  }[]) {
    try {
      await engineSendText({
        accountId: row.account_id,
        userId: row.user_id,
        conversationId: row.conversation_id,
        contactId: row.contact_id,
        text: FOLLOW_UP_TEXT,
      })
      if (sentTag?.id) {
        await db
          .from('contact_tags')
          .insert({ contact_id: row.contact_id, tag_id: sentTag.id })
          .select()
      }
      sent++
    } catch (err) {
      console.error(
        `[abandoned-followup cron] failed for conversation ${row.conversation_id}:`,
        err,
      )
    }
  }

  return NextResponse.json({ sent, candidates: candidates.length })
}
