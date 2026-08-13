'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

interface BillingInfo {
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  plan_expires_at: string | null;
}

interface Provider {
  provider: string;
  operationTypes: Record<string, string>;
}

const PLAN_OPTIONS = [
  { id: 'starter', name: 'Starter', price: '6,000 FCFA/mo' },
  { id: 'pro', name: 'Pro', price: '15,000 FCFA/mo' },
] as const;

/**
 * Billing settings panel — shows current plan/trial status and lets
 * the account owner pay for Starter/Pro via PawaPay mobile money.
 * One-time 30-day charges for now, not auto-recurring (see
 * plan-limits.ts and the /api/billing routes for the full flow).
 */
export function BillingSettings() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'pro' | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingDepositId, setPendingDepositId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/account')
      .then((res) => res.json())
      .then((data) => setBilling(data.billing))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedPlan) return;
    setProviderError(null);
    fetch('/api/billing/providers?country=CMR')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
        return data;
      })
      .then((data) => {
        const list = data.providers ?? [];
        setProviders(list);
        if (list.length === 0) {
          setProviderError('PawaPay returned no available providers for Cameroon (CMR) right now.');
        }
      })
      .catch((err) => {
        setProviders([]);
        setProviderError(err instanceof Error ? err.message : 'Failed to load payment providers');
      });
  }, [selectedPlan]);

  // Poll for payment completion once a deposit is in flight.
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
          fetch('/api/account')
            .then((res) => res.json())
            .then((data) => setBilling(data.billing));
          setPendingDepositId(null);
          setSelectedPlan(null);
        } else {
          toast.error('Payment failed. Please try again.');
          setPendingDepositId(null);
        }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [pendingDepositId]);

  const handlePay = async () => {
    if (!selectedPlan || !selectedProvider || !phoneNumber.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan, phoneNumber: phoneNumber.trim(), provider: selectedProvider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to start payment');
      toast.success('Check your phone to approve the payment.');
      setPendingDepositId(data.depositId);
      setPaymentStatus('SUBMITTED');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start payment');
    } finally {
      setSubmitting(false);
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
          <p className="font-medium text-foreground">Waiting for payment approval…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your phone and approve the mobile money request. This updates automatically.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Status: {paymentStatus}</p>
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            {PLAN_OPTIONS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlan(p.id)}
                className={`rounded-lg border px-4 py-4 text-left transition-colors ${
                  selectedPlan === p.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <p className="font-medium text-foreground">{p.name}</p>
                <p className="text-sm text-muted-foreground">{p.price}</p>
              </button>
            ))}
          </div>

          {selectedPlan && (
            <div className="rounded-lg border border-border bg-card px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <Smartphone className="size-4" /> Pay with mobile money
              </div>

              <div className="mb-3 flex flex-col gap-2">
                <label className="text-xs text-muted-foreground">Provider</label>
                {providerError && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                    {providerError}
                  </p>
                )}
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select provider…</option>
                  {providers.map((p) => (
                    <option key={p.provider} value={p.provider}>
                      {p.provider}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-4 flex flex-col gap-2">
                <label className="text-xs text-muted-foreground">Phone number</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="6XXXXXXXX"
                  className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <button
                onClick={handlePay}
                disabled={submitting || !selectedProvider || !phoneNumber.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Pay for {PLAN_OPTIONS.find((p) => p.id === selectedPlan)?.name}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
