import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * GET /api/admin/accounts
 *
 * Lists every account on the platform with key at-a-glance stats —
 * the core data source for the platform admin dashboard. Requires
 * platform_admins membership (see requirePlatformAdmin), which is
 * entirely separate from any per-account role.
 *
 * Runs on the service-role client deliberately: RLS scopes every
 * account's data to that account's own members, which is exactly
 * what a normal user should see and exactly what a platform admin
 * needs to see PAST. Access control here is the explicit
 * requirePlatformAdmin() check above, not RLS.
 */
export async function GET() {
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const db = supabaseAdmin()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: accounts, error } = await db
    .from('accounts')
    .select('id, name, owner_user_id, default_currency, created_at')
    .order('created_at', { ascending: false })

  if (error || !accounts) {
    console.error('[admin/accounts] failed to load accounts:', error)
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 })
  }

  // Per-account stats in parallel — small account counts today, but
  // worth batching into fewer round trips if this ever needs to
  // scale past a few hundred accounts.
  const stats = await Promise.all(
    accounts.map(async (account) => {
      const [
        { count: contactCount },
        { count: messageCount },
        { data: whatsappConfig },
        { data: messengerConfig },
        { data: ownerProfile },
        { data: lastConversation },
        { data: usageRows },
      ] = await Promise.all([
        db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', account.id),
        db
          .from('messages')
          .select('id, conversations!inner(account_id)', { count: 'exact', head: true })
          .eq('conversations.account_id', account.id),
        db.from('whatsapp_config').select('status').eq('account_id', account.id).maybeSingle(),
        db.from('messenger_config').select('status').eq('account_id', account.id).maybeSingle(),
        db.from('profiles').select('email, full_name').eq('user_id', account.owner_user_id).maybeSingle(),
        db
          .from('conversations')
          .select('last_message_at')
          .eq('account_id', account.id)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('ai_usage_log')
          .select('total_tokens')
          .eq('account_id', account.id)
          .gte('created_at', thirtyDaysAgo),
      ])

      const tokens30d = (usageRows ?? []).reduce((sum, r) => sum + (r.total_tokens ?? 0), 0)

      return {
        id: account.id,
        name: account.name,
        created_at: account.created_at,
        owner_email: ownerProfile?.email ?? null,
        owner_name: ownerProfile?.full_name ?? null,
        contact_count: contactCount ?? 0,
        message_count: messageCount ?? 0,
        whatsapp_connected: whatsappConfig?.status === 'connected',
        messenger_connected: messengerConfig?.status === 'connected',
        last_activity_at: lastConversation?.last_message_at ?? null,
        tokens_30d: tokens30d,
      }
    }),
  )

  return NextResponse.json({ accounts: stats })
}
