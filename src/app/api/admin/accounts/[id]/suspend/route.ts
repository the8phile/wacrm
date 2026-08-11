import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * POST /api/admin/accounts/[id]/suspend — suspend an account.
 * DELETE /api/admin/accounts/[id]/suspend — unsuspend it.
 *
 * This is the one genuinely destructive action in the admin panel —
 * a suspended account's whole team is locked out of the dashboard
 * (getCurrentAccount fails closed, see src/lib/auth/account.ts) and
 * its AI stops auto-replying (dispatchInboundToAiReply checks the
 * same flag). Inbound WhatsApp/Messenger messages still land — they
 * just sit unanswered — rather than silently dropping a customer's
 * message with no trace.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id: accountId } = await context.params
  const body = (await request.json().catch(() => null)) as { reason?: string } | null

  const db = supabaseAdmin()

  const { error } = await db
    .from('accounts')
    .update({
      suspended: true,
      suspended_at: new Date().toISOString(),
      suspended_reason: body?.reason?.trim() || null,
    })
    .eq('id', accountId)

  if (error) {
    console.error('[admin/accounts/suspend] failed to suspend:', error)
    return NextResponse.json({ error: 'Failed to suspend account' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const { id: accountId } = await context.params
  const db = supabaseAdmin()

  const { error } = await db
    .from('accounts')
    .update({ suspended: false, suspended_at: null, suspended_reason: null })
    .eq('id', accountId)

  if (error) {
    console.error('[admin/accounts/suspend] failed to unsuspend:', error)
    return NextResponse.json({ error: 'Failed to unsuspend account' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
