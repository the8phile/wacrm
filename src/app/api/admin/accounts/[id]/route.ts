import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * GET /api/admin/accounts/[id]
 *
 * Full detail for one account — the drill-down behind clicking a row
 * on the platform admin dashboard. Same access model as the list
 * route: gated by requirePlatformAdmin(), runs on the service-role
 * client to see past this account's own RLS.
 *
 * Deliberately read-only and metadata-only: recent conversations show
 * contact/channel/message-count/last-activity, not message content —
 * enough to support a customer without a platform admin reading
 * every private conversation by default.
 */
export async function GET(
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

  const { data: account, error: accountErr } = await db
    .from('accounts')
    .select('id, name, owner_user_id, default_currency, created_at')
    .eq('id', accountId)
    .maybeSingle()

  if (accountErr || !account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const [
    { data: ownerProfile },
    { data: memberProfiles },
    { data: whatsappConfig },
    { data: messengerConfig },
    { data: aiConfig },
    { data: conversations },
  ] = await Promise.all([
    db.from('profiles').select('email, full_name').eq('user_id', account.owner_user_id).maybeSingle(),
    db.from('profiles').select('user_id, email, full_name, account_role').eq('account_id', accountId),
    db.from('whatsapp_config').select('status, phone_number_id, connected_at').eq('account_id', accountId).maybeSingle(),
    db.from('messenger_config').select('status, page_id, connected_at').eq('account_id', accountId).maybeSingle(),
    db
      .from('ai_configs')
      .select('provider, model, is_active, auto_reply_enabled, auto_reply_max_per_conversation')
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('conversations')
      .select('id, channel, last_message_text, last_message_at, ai_reply_count, contact_id, contacts(name, phone, external_id)')
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(20),
  ])

  return NextResponse.json({
    account: {
      id: account.id,
      name: account.name,
      created_at: account.created_at,
      default_currency: account.default_currency,
      owner_email: ownerProfile?.email ?? null,
      owner_name: ownerProfile?.full_name ?? null,
    },
    members: (memberProfiles ?? []).map((m) => ({
      email: m.email,
      full_name: m.full_name,
      role: m.account_role,
    })),
    whatsapp: whatsappConfig
      ? {
          connected: whatsappConfig.status === 'connected',
          phone_number_id: whatsappConfig.phone_number_id,
          connected_at: whatsappConfig.connected_at,
        }
      : null,
    messenger: messengerConfig
      ? {
          connected: messengerConfig.status === 'connected',
          page_id: messengerConfig.page_id,
          connected_at: messengerConfig.connected_at,
        }
      : null,
    ai_config: aiConfig
      ? {
          provider: aiConfig.provider,
          model: aiConfig.model,
          is_active: aiConfig.is_active,
          auto_reply_enabled: aiConfig.auto_reply_enabled,
          auto_reply_max_per_conversation: aiConfig.auto_reply_max_per_conversation,
        }
      : null,
    recent_conversations: (conversations ?? []).map((c) => {
      const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts
      return {
        id: c.id,
        channel: c.channel,
        contact_name: contact?.name ?? null,
        contact_phone: contact?.phone ?? null,
        last_message_text: c.last_message_text,
        last_message_at: c.last_message_at,
        ai_reply_count: c.ai_reply_count,
      }
    }),
  })
}
