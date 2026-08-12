import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { activatePlanForPayment } from '@/lib/billing/pawapay'

/**
 * POST /api/billing/callback
 *
 * PawaPay calls this URL directly when a deposit reaches a final
 * status (COMPLETED or FAILED) — configure this exact URL as the
 * deposit callback URL in the PawaPay dashboard.
 *
 * Deliberately has NO auth — PawaPay is the caller, not a signed-in
 * wacrm user. This is the same trust model as the WhatsApp/Messenger
 * webhooks: identity comes from knowing the depositId we generated
 * ourselves, not from a session. PawaPay does support optional
 * request signing (see "Only accept signed requests" in their
 * dashboard) for a stronger guarantee — worth turning on before
 * going live, not required for sandbox testing.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const depositId = body?.depositId
  const status = body?.status

  if (!depositId || !status) {
    return NextResponse.json({ error: 'Malformed callback' }, { status: 400 })
  }

  const db = supabaseAdmin()

  const { data: payment } = await db
    .from('payments')
    .select('id, account_id, plan, status')
    .eq('pawapay_deposit_id', depositId)
    .maybeSingle()

  if (!payment) {
    // Not one of ours (or already deleted) — acknowledge anyway so
    // PawaPay doesn't retry indefinitely.
    return NextResponse.json({ ok: true })
  }

  if (payment.status === 'completed') {
    return NextResponse.json({ ok: true }) // already handled
  }

  if (status === 'COMPLETED') {
    await activatePlanForPayment(db, payment)
  } else if (status === 'FAILED') {
    await db.from('payments').update({ status: 'failed' }).eq('id', payment.id)
  }

  return NextResponse.json({ ok: true })
}
