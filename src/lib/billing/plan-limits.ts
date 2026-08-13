export type PlanId = 'free' | 'starter' | 'pro'

export interface PlanLimits {
  name: string
  /** Canonical USD price — converted into the customer's local
   *  currency at checkout time (see src/lib/billing/currency.ts),
   *  since PawaPay charges each country in its own currency. */
  priceUsd: number
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
    priceUsd: 0,
    maxContacts: 50,
    maxAiRepliesPerMonth: 50,
    multiChannel: false,
  },
  starter: {
    name: 'Starter',
    priceUsd: 10,
    maxContacts: 500,
    maxAiRepliesPerMonth: 500,
    multiChannel: true,
  },
  pro: {
    name: 'Pro',
    priceUsd: 25,
    maxContacts: null,
    maxAiRepliesPerMonth: null,
    multiChannel: true,
  },
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  if (plan === 'starter' || plan === 'pro') return PLAN_LIMITS[plan]
  return PLAN_LIMITS.free
}
