export type PlanId = 'free' | 'starter' | 'pro'

export interface PlanLimits {
  name: string
  priceFcfa: number
  maxContacts: number | null // null = unlimited
  maxAiRepliesPerMonth: number | null // null = unlimited
  multiChannel: boolean // both WhatsApp + Messenger, vs. one only
}

/**
 * Single source of truth for what each plan includes — read by both
 * the enforcement checks (webhook contact creation, AI auto-reply)
 * and the public pricing page, so the two can never drift apart.
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    name: 'Free',
    priceFcfa: 0,
    maxContacts: 50,
    maxAiRepliesPerMonth: 50,
    multiChannel: false,
  },
  starter: {
    name: 'Starter',
    priceFcfa: 6000,
    maxContacts: 500,
    maxAiRepliesPerMonth: 500,
    multiChannel: true,
  },
  pro: {
    name: 'Pro',
    priceFcfa: 15000,
    maxContacts: null,
    maxAiRepliesPerMonth: null,
    multiChannel: true,
  },
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  if (plan === 'starter' || plan === 'pro') return PLAN_LIMITS[plan]
  return PLAN_LIMITS.free
}
