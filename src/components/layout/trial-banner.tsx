'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Sparkles } from 'lucide-react';

interface BillingInfo {
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  plan_expires_at: string | null;
}

/**
 * Persistent trial/plan status banner shown across every dashboard
 * page (wired into DashboardShell). Not dismissible — this exists
 * specifically to drive trial conversion, so a one-time dismiss would
 * defeat the point. Fetches its own /api/account rather than sharing
 * useAuth's fetch, matching the same pattern already used by
 * BillingSettings.
 */
export function TrialBanner() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);

  useEffect(() => {
    fetch('/api/account')
      .then((res) => res.json())
      .then((data) => setBilling(data.billing))
      .catch(() => setBilling(null));
  }, []);

  if (!billing) return null;

  if (billing.subscription_status === 'trialing' && billing.trial_ends_at) {
    const daysLeft = Math.max(0, Math.ceil(daysUntil(billing.trial_ends_at)));

    const urgent = daysLeft <= 1;
    const warning = daysLeft <= 3 && !urgent;

    return (
      <div
        className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
          urgent
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : warning
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
              : 'border-blue-500/30 bg-blue-500/10 text-blue-400'
        }`}
      >
        <div className="flex items-center gap-2">
          {urgent ? <AlertTriangle className="size-4 shrink-0" /> : <Sparkles className="size-4 shrink-0" />}
          <span>
            {daysLeft === 0
              ? 'Your Pro trial ends today.'
              : `Your Pro trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`}
            {' '}Pick a plan to keep full access.
          </span>
        </div>
        <Link
          href="/settings?tab=billing"
          className="whitespace-nowrap rounded-md bg-foreground/10 px-3 py-1 font-medium hover:bg-foreground/20"
        >
          View plans
        </Link>
      </div>
    );
  }

  if (billing.subscription_status === 'free') {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
        <span>You&apos;re on the Free plan. Upgrade for more contacts, AI replies, and both channels.</span>
        <Link
          href="/settings?tab=billing"
          className="whitespace-nowrap rounded-md bg-foreground/10 px-3 py-1 font-medium text-foreground hover:bg-foreground/20"
        >
          View plans
        </Link>
      </div>
    );
  }

  return null;
}

/** Pure helper, not a component — keeps Date.now() out of any
 *  component's render body per the react-hooks/purity rule. */
function daysUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}
