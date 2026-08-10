import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * GET /api/admin/admins — list everyone with platform admin access.
 * POST /api/admin/admins — grant access to a user by email.
 * DELETE /api/admin/admins?user_id=... — revoke access.
 *
 * All three require the CALLER to already be a platform admin
 * (requirePlatformAdmin) — this is a privilege-escalation surface,
 * so only existing admins can grant or revoke it, never a self-serve
 * account action. DELETE additionally refuses to remove the very
 * last remaining admin, so this page can never lock everyone out of
 * itself.
 */
export async function GET() {
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const db = supabaseAdmin()

  const { data: admins, error } = await db
    .from('platform_admins')
    .select('user_id, created_at')
    .order('created_at', { ascending: true })

  if (error || !admins) {
    console.error('[admin/admins] failed to load admins:', error)
    return NextResponse.json({ error: 'Failed to load admins' }, { status: 500 })
  }

  const profiles = await Promise.all(
    admins.map((a) =>
      db.from('profiles').select('email, full_name').eq('user_id', a.user_id).maybeSingle(),
    ),
  )

  return NextResponse.json({
    admins: admins.map((a, i) => ({
      user_id: a.user_id,
      granted_at: a.created_at,
      email: profiles[i].data?.email ?? null,
      full_name: profiles[i].data?.full_name ?? null,
    })),
  })
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as { email?: string } | null
  const email = body?.email?.trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const db = supabaseAdmin()

  // Platform admin status is granted to an existing platform user, not
  // a fresh invite — find them by the email already on their profile.
  const { data: profile } = await db
    .from('profiles')
    .select('user_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()

  if (!profile) {
    return NextResponse.json(
      { error: 'No user with that email has an account on this platform yet' },
      { status: 404 },
    )
  }

  const { error } = await db
    .from('platform_admins')
    .insert({ user_id: profile.user_id })

  if (error) {
    // Most likely a duplicate (already an admin) — the unique
    // primary key on user_id makes that the expected failure mode.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That user is already a platform admin' }, { status: 409 })
    }
    console.error('[admin/admins] failed to grant admin:', error)
    return NextResponse.json({ error: 'Failed to grant admin access' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  let callerUserId: string
  try {
    const ctx = await requirePlatformAdmin()
    callerUserId = ctx.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get('user_id')
  if (!targetUserId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  }

  const db = supabaseAdmin()

  const { count: totalAdmins } = await db
    .from('platform_admins')
    .select('user_id', { count: 'exact', head: true })

  if ((totalAdmins ?? 0) <= 1) {
    return NextResponse.json(
      { error: 'Cannot remove the last remaining platform admin' },
      { status: 400 },
    )
  }

  const { error } = await db.from('platform_admins').delete().eq('user_id', targetUserId)

  if (error) {
    console.error('[admin/admins] failed to revoke admin:', error)
    return NextResponse.json({ error: 'Failed to revoke admin access' }, { status: 500 })
  }

  // Informational only — not blocked, since a platform admin
  // deliberately stepping down (while others remain) is legitimate.
  const steppingDown = targetUserId === callerUserId

  return NextResponse.json({ ok: true, steppingDown })
}
