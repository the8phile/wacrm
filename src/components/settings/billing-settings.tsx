'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { SUPPORTED_COUNTRIES } from '@/lib/billing/countries';

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
  { id: 'starter', name: 'Starter' },
  { id: 'pro', name: 'Pro' },
] as const;

/**
 * Reduces a raw PawaPay provider code (e.g. "MTN_MOMO_CMR",
 * "ORANGE_CMR") to a short display name + a brand-ish accent color
 * for the operator card grid. Deliberately just colored initials
 * rather than fetched logo images — no external asset dependency,
 * no logo-reproduction question, and it degrades gracefully for any
 * provider code PawaPay might add later.
 */
function providerDisplay(code: string): { name: string; bg: string; fg: string } {
  const upper = code.toUpperCase();
  if (upper.includes('MTN')) return { name: 'MTN', bg: 'bg-yellow-400', fg: 'text-yellow-950' };
  if (upper.includes('ORANGE')) return { name: 'Orange', bg: 'bg-orange-500', fg: 'text-white' };
  if (upper.includes('AIRTEL')) return { name: 'Airtel', bg: 'bg-red-500', fg: 'text-white' };
  if (upper.includes('VODAFONE') || upper.includes('VODACOM')) return { name: 'Vodafone', bg: 'bg-red-600', fg: 'text-white' };
  if (upper.includes('MPESA') || upper.includes('M-PESA')) return { name: 'M-PESA', bg: 'bg-green-600', fg: 'text-white' };
  if (upper.includes('TIGO')) return { name: 'Tigo', bg: 'bg-blue-500', fg: 'text-white' };
  if (upper.includes('HALOPESA')) return { name: 'Halopesa', bg: 'bg-purple-500', fg: 'text-white' };
  if (upper.includes('ZAMTEL')) return { name: 'Zamtel', bg: 'bg-teal-500', fg: 'text-white' };
  if (upper.includes('TNM')) return { name: 'TNM', bg: 'bg-indigo-500', fg: 'text-white' };
  if (upper.includes('WAVE')) return { name: 'Wave', bg: 'bg-sky-500', fg: 'text-white' };
  if (upper.includes('FREE')) return { name: 'Free', bg: 'bg-pink-500', fg: 'text-white' };
  if (upper.includes('TELECEL')) return { name: 'Telecel', bg: 'bg-rose-500', fg: 'text-white' };
  // Fallback: title-case the first underscore-separated segment.
  const first = code.split('_')[0] ?? code;
  return {
    name: first.charAt(0) + first.slice(1).toLowerCase(),
    bg: 'bg-muted',
    fg: 'text-foreground',
  };
}

/**
 * Billing settings panel — visually modeled on PawaPay's own hosted
 * payment page (operator logo cards, pill buttons, "Powered by
 * pawaPay" footer). Supports every African country PawaPay has an
 * active deposit provider for (see countries.ts) — selecting a
 * country re-fetches its live provider list and its converted price
 * (plans are priced in USD, converted to local currency server-side;
 * see /api/billing/quote).
 */
export function BillingSettings() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'pro'>('starter');
  const [selectedCountry, setSelectedCountry] = useState(SUPPORTED_COUNTRIES[0].code);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [quote, setQuote] = useState<{ currency: string; amount: number } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDepositId, setPendingDepositId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  const country = SUPPORTED_COUNTRIES.find((c) => c.code === selectedCountry)!;

  useEffect(() => {
    fetch('/api/account')
      .then((res) => res.json())
      .then((data) => setBilling(data.billing))
      .finally(() => setLoading(false));
  }, []);

  // Providers depend only on the selected country.
  useEffect(() => {
    setProviderError(null);
    setSelectedProvider('');
    fetch(`/api/billing/providers?country=${selectedCountry}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
        return data;
      })
      .then((data) => {
        const list = data.providers ?? [];
        setProviders(list);
        if (list.length === 0) {
          setProviderError(`PawaPay returned no available providers for ${country.name} right now.`);
        }
      })
      .catch((err) => {
        setProviders([]);
        setProviderError(err instanceof Error ? err.message : 'Failed to load payment providers');
      });
  }, [selectedCountry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Price quote depends on both the selected country and plan.
  useEffect(() => {
    setQuoteError(null);
    fetch(`/api/billing/quote?country=${selectedCountry}&plan=${selectedPlan}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
        return data;
      })
      .then((data) => setQuote({ currency: data.currency, amount: data.amount }))
      .catch((err) => {
        setQuote(null);
        setQuoteError(err instanceof Error ? err.message : 'Failed to load price');
      });
  }, [selectedCountry, selectedPlan]);

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
        } else {
          toast.error('Payment failed. Please try again.');
          setPendingDepositId(null);
        }
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [pendingDepositId]);

  const handlePay = async () => {
    if (!selectedProvider || !phoneNumber.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          country: selectedCountry,
          phoneNumber: phoneNumber.trim(),
          provider: selectedProvider,
        }),
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

  const activePlan = PLAN_OPTIONS.find((p) => p.id === selectedPlan)!;

  return (
    <div className="max-w-md">
      {billing && (
        <div className="mb-6 rounded-lg border border-border bg-card px-4 py-4">
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
        <div className="rounded-2xl border border-border bg-card px-6 py-8 text-center shadow-sm">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-muted-foreground" />
          <p className="font-medium text-foreground">Waiting for payment approval…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your phone and approve the mobile money request. This updates automatically.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">Status: {paymentStatus}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card px-6 py-6 shadow-sm">
          {/* Header — "Payment to" / "For", matching PawaPay's own payment page */}
          <div className="mb-5 flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Payment to</p>
              <p className="font-semibold text-foreground">wacrm</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">For</p>
              <p className="font-semibold text-primary">{activePlan.name} plan</p>
            </div>
          </div>

          {/* Plan switch */}
          <div className="mb-4 flex gap-1 rounded-full border border-border bg-muted p-1">
            {PLAN_OPTIONS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedPlan(p.id)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedPlan === p.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Country */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs text-muted-foreground">Country</label>
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground"
            >
              {SUPPORTED_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Amount — computed from the USD price, converted to the
              selected country's currency. */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs text-muted-foreground">Amount</label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5">
              {quoteError ? (
                <span className="text-xs text-destructive">{quoteError}</span>
              ) : quote ? (
                <>
                  <span className="text-xs font-medium text-muted-foreground">{quote.currency}</span>
                  <span className="text-sm font-medium text-foreground">{quote.amount.toLocaleString()}</span>
                </>
              ) : (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          {/* Phone number */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs text-muted-foreground">Phone number</label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5">
              <span aria-hidden="true">{country.flag}</span>
              <span className="text-sm text-muted-foreground">+{country.callingCode}</span>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder={'X'.repeat(country.phoneDigits)}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>

          {/* Operator — logo-style card grid, matching PawaPay's own layout. */}
          <div className="mb-6">
            <label className="mb-1.5 block text-xs text-muted-foreground">Operator</label>
            {providerError && (
              <p className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {providerError}
              </p>
            )}
            <div className="grid grid-cols-3 gap-2">
              {providers.map((p) => {
                const display = providerDisplay(p.provider);
                const selected = selectedProvider === p.provider;
                return (
                  <button
                    key={p.provider}
                    onClick={() => setSelectedProvider(p.provider)}
                    className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors ${
                      selected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {selected && (
                      <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-2.5" />
                      </span>
                    )}
                    <span
                      className={`flex size-9 items-center justify-center rounded-lg text-[10px] font-bold ${display.bg} ${display.fg}`}
                    >
                      {display.name.slice(0, 3).toUpperCase()}
                    </span>
                    <span className="text-[11px] text-foreground">{display.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setSelectedProvider('');
                setPhoneNumber('');
              }}
              className="flex-1 rounded-full border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handlePay}
              disabled={submitting || !selectedProvider || !phoneNumber.trim() || !quote}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Pay
            </button>
          </div>

          <p className="mt-4 text-center text-xs text-muted-foreground">Powered by pawaPay</p>
        </div>
      )}
    </div>
  );
}
