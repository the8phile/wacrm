import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getAvailableProviders } from '@/lib/billing/pawapay'

/**
 * GET /api/billing/providers?country=CMR
 *
 * Lists which mobile money providers (MTN/Orange/etc.) are actually
 * live for a country right now, for the checkout form's provider
 * dropdown. Discovered live from PawaPay rather than hardcoded, since
 * correspondent availability can change.
 */
export async function GET(request: Request) {
  try {
    await requireRole('viewer')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { searchParams } = new URL(request.url)
  const country = searchParams.get('country') ?? 'CMR'

  try {
    const providers = await getAvailableProviders(country)
    return NextResponse.json({ providers })
  } catch (err) {
    console.error('[billing/providers] failed to fetch providers:', err)
    return NextResponse.json({ error: 'Failed to load payment providers' }, { status: 500 })
  }
}
