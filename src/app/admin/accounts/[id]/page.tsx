'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, ShieldAlert, ArrowLeft, PlugZap, MessageCircle, Bot } from 'lucide-react';

interface AccountDetail {
  account: {
    id: string;
    name: string;
    created_at: string;
    default_currency: string | null;
    owner_email: string | null;
    owner_name: string | null;
  };
  members: { email: string | null; full_name: string | null; role: string }[];
  whatsapp: { connected: boolean; phone_number_id: string | null; connected_at: string | null } | null;
  messenger: { connected: boolean; page_id: string | null; connected_at: string | null } | null;
  ai_config: {
    provider: string;
    model: string;
    is_active: boolean;
    auto_reply_enabled: boolean;
    auto_reply_max_per_conversation: number;
  } | null;
  tokens_30d: number;
  recent_conversations: {
    id: string;
    channel: string;
    contact_name: string | null;
    contact_phone: string | null;
    last_message_text: string | null;
    last_message_at: string | null;
    ai_reply_count: number;
  }[];
}

/**
 * Platform admin drill-down for a single account — reachable by
 * clicking a row on /admin. Read-only: shows connection status, AI
 * config, and recent conversation metadata (not message content).
 * Support/suspend actions are a deliberate follow-up, not here yet.
 */
export default function AdminAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/accounts/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((data) => setDetail(data))
      .catch((err) => setError(err.message ?? 'Failed to load account'))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <ShieldAlert className="size-8 text-destructive" />
        <p className="text-lg font-medium text-foreground">{error ?? 'Account not found'}</p>
        <Link href="/admin" className="text-sm text-primary hover:underline">
          Back to accounts
        </Link>
      </div>
    );
  }

  const { account, members, whatsapp, messenger, ai_config, recent_conversations, tokens_30d } = detail;

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to accounts
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">{account.name}</h1>
          <p className="text-sm text-muted-foreground">
            Owner: {account.owner_name || account.owner_email || '—'} · Created{' '}
            {new Date(account.created_at).toLocaleDateString()}
          </p>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <ChannelCard
            icon={<PlugZap className="size-4" />}
            label="WhatsApp"
            connected={whatsapp?.connected ?? false}
            detail={whatsapp?.phone_number_id ?? undefined}
          />
          <ChannelCard
            icon={<MessageCircle className="size-4" />}
            label="Messenger"
            connected={messenger?.connected ?? false}
            detail={messenger?.page_id ?? undefined}
          />
          <div className="rounded-lg border border-border bg-card px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
              <Bot className="size-4" /> AI Agent
            </div>
            {ai_config ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {ai_config.provider} / {ai_config.model}
                </p>
                <p className="mt-1 text-xs">
                  {ai_config.is_active && ai_config.auto_reply_enabled ? (
                    <span className="text-green-500">Active, auto-replying</span>
                  ) : (
                    <span className="text-muted-foreground">Not active</span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tokens_30d.toLocaleString()} tokens (30d)
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Not configured</p>
            )}
          </div>
        </div>

        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-foreground">
            Team members ({members.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            {members.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border px-4 py-2 text-sm last:border-0"
              >
                <span className="text-foreground">{m.full_name || m.email || '—'}</span>
                <span className="text-xs capitalize text-muted-foreground">{m.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">
            Recent conversations ({recent_conversations.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            {recent_conversations.map((c) => (
              <div key={c.id} className="border-b border-border px-4 py-3 text-sm last:border-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">
                    {c.contact_name || c.contact_phone || 'Unnamed'}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{c.channel}</span>
                </div>
                {c.last_message_text && (
                  <p className="mt-1 truncate text-xs text-muted-foreground">{c.last_message_text}</p>
                )}
              </div>
            ))}
            {recent_conversations.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No conversations yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelCard({
  icon,
  label,
  connected,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
        {icon} {label}
      </div>
      {connected ? (
        <>
          <p className="text-xs text-green-500">Connected</p>
          {detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Not connected</p>
      )}
    </div>
  );
}
