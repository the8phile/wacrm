import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkDepositStatus, activatePlanForPayment } from '@/lib/billing/pawapay'

/**
 * GET /api/billing/status/[depositId]
 *
 * Polling fallback for the checkout page while it waits for the
 * PawaPay callback — PawaPay explicitly recommends this pattern
 * since callbacks can be missed (network issues, misconfiguration).
 * Also self-heals: if this poll discovers COMPLETED before the
 * callback arrives, it activates the plan itself so the customer
 * isn't stuck waiting on a callback that may never come.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ depositId: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('viewer')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { depositId } = await context.params

  const { data: payment } = await ctx.supabase
    .from('payments')
    .select('id, account_id, plan, status')
    .eq('pawapay_deposit_id', depositId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
  }

  if (payment.status === 'completed') {
    return NextResponse.json({ status: 'COMPLETED' })
  }
  if (payment.status === 'failed') {
    return NextResponse.json({ status: 'FAILED' })
  }

  const remote = await checkDepositStatus(depositId)
  if (!remote) {
    return NextResponse.json({ status: 'PENDING' })
  }

  if (remote.status === 'COMPLETED' && payment.status !== 'completed') {
    await activatePlanForPayment(ctx.supabase, payment)
  } else if (remote.status === 'FAILED') {
    await ctx.supabase.from('payments').update({ status: 'failed' }).eq('id', payment.id)
  }

  return NextResponse.json({ status: remote.status })
}
