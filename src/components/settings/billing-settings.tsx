'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface BillingInfo {
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  plan_expires_at: string | null;
}

const PLAN_OPTIONS = [
  { id: 'starter', name: 'Starter', price: '6,000 FCFA/mo' },
  { id: 'pro', name: 'Pro', price: '15,000 FCFA/mo' },
] as const;

/**
 * Billing settings panel — shows current plan/trial status and hands
 * off to PawaPay's own hosted payment page for Starter/Pro upgrades,
 * rather than us building a phone/provider form ourselves. The
 * customer picks their mobile money provider and enters their phone
 * number on PawaPay's UI, then lands back here via returnUrl (see
 * /api/billing/checkout) carrying a depositId we poll to confirm.
 */
export function BillingSettings() {
  const searchParams = useSearchParams();
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState<'starter' | 'pro' | null>(null);
  const [pendingDepositId, setPendingDepositId] = useState<string | null>(
    searchParams.get('depositId'),
  );
  const [paymentStatus, setPaymentStatus] = useState<string | null>(
    searchParams.get('depositId') ? 'PENDING' : null,
  );

  const loadBilling = () => {
    fetch('/api/account')
      .then((res) => res.json())
      .then((data) => setBilling(data.billing))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadBilling();
  }, []);

  // Poll for payment completion — either just after redirecting to
  // PawaPay's hosted page and back (depositId arrives via the return
  // URL's query string), or from a payment already in flight.
  useEffect(() => {
    if (!pendingDepositId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/billing/status/${pendingDepositId}`);
      const data = await res.json();
      setPaymentStatus(data.status);
      if (data.status === 'COMPLETED' || data.status === 'FAILED') {
        clearInterval(interval);
        if (data.status === 'COMPLETED') {
          toast.success('Payment received! Your plan is now active.');
          loadBilling();
        } else {
          toast.error('Payment failed. Please try again.');
        }
        setPendingDepositId(null);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [pendingDepositId]);

  const handlePay = async (plan: 'starter' | 'pro') => {
    setRedirecting(plan);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to start checkout');
      window.location.href = data.redirectUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout');
      setRedirecting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {billing && (
        <div className="mb-8 rounded-lg border border-border bg-card px-4 py-4">
          <p className="text-sm text-muted-foreground">Current plan</p>
          <p className="text-xl font-semibold capitalize text-foreground">{billing.plan}</p>
          {billing.subscription_status === 'trialing' && billing.trial_ends_at && (
            <p className="mt-1 text-xs text-blue-400">
              Trial ends {new Date(billing.trial_ends_at).toLocaleDateString()}
            </p>
          )}
          {billing.subscription_status === 'active' && billing.plan_expires_at && (
            <p className="mt-1 text-xs text-green-500">
              Renews by {new Date(billing.plan_expires_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}

      {pendingDepositId ? (
        <div className="rounded-lg border border-border bg-card px-4 py-6 text-center">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-muted-foreground" />
          <p className="font-medium text-foreground">Confirming your payment…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This updates automatically once PawaPay confirms the payment.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Status: {paymentStatus}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {PLAN_OPTIONS.map((p) => (
            <div key={p.id} className="rounded-lg border border-border px-4 py-4">
              <p className="font-medium text-foreground">{p.name}</p>
              <p className="mb-3 text-sm text-muted-foreground">{p.price}</p>
              <button
                onClick={() => handlePay(p.id)}
                disabled={redirecting !== null}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {redirecting === p.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Pay for {p.name}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
