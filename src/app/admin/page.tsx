'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldAlert, MessageCircle, PlugZap, Search, ArrowUp, ArrowDown } from 'lucide-react';

interface AdminAccountRow {
  id: string;
  name: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  contact_count: number;
  message_count: number;
  whatsapp_connected: boolean;
  messenger_connected: boolean;
  last_activity_at: string | null;
}

type ChannelFilter = 'all' | 'whatsapp' | 'messenger' | 'none';
type SortColumn = 'name' | 'contact_count' | 'message_count' | 'created_at';
type SortDirection = 'asc' | 'desc';

/**
 * Platform admin dashboard — every account on the whole platform,
 * with basic activity stats. Gated by `requirePlatformAdmin()` on
 * the API side (see /api/admin/accounts); this page itself just
 * renders whatever that endpoint returns, or the 403 it sends back
 * for anyone who isn't a platform admin.
 *
 * Search/filter/sort all happen client-side against the full list —
 * fine at today's account counts. Worth moving server-side (with
 * pagination) once this grows past a few hundred accounts.
 */
export default function AdminDashboardPage() {
  const [accounts, setAccounts] = useState<AdminAccountRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    fetch('/api/admin/accounts')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((data) => setAccounts(data.accounts))
      .catch((err) => setError(err.message ?? 'Failed to load accounts'))
      .finally(() => setLoading(false));
  }, []);

  const visibleAccounts = useMemo(() => {
    if (!accounts) return [];

    const query = searchQuery.trim().toLowerCase();
    let rows = accounts.filter((a) => {
      if (query) {
        const haystack = `${a.name} ${a.owner_name ?? ''} ${a.owner_email ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (channelFilter === 'whatsapp' && !a.whatsapp_connected) return false;
      if (channelFilter === 'messenger' && !a.messenger_connected) return false;
      if (channelFilter === 'none' && (a.whatsapp_connected || a.messenger_connected)) return false;
      return true;
    });

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortColumn === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortColumn === 'contact_count') cmp = a.contact_count - b.contact_count;
      else if (sortColumn === 'message_count') cmp = a.message_count - b.message_count;
      else if (sortColumn === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [accounts, searchQuery, channelFilter, sortColumn, sortDirection]);

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <ShieldAlert className="size-8 text-destructive" />
        <p className="text-lg font-medium text-foreground">Access denied</p>
        <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const totalAccounts = accounts?.length ?? 0;
  const whatsappConnectedCount = accounts?.filter((a) => a.whatsapp_connected).length ?? 0;
  const messengerConnectedCount = accounts?.filter((a) => a.messenger_connected).length ?? 0;
  const totalMessages = accounts?.reduce((sum, a) => sum + a.message_count, 0) ?? 0;
  const totalContacts = accounts?.reduce((sum, a) => sum + a.contact_count, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Platform Admin</h1>
            <p className="text-sm text-muted-foreground">
              {accounts?.length ?? 0} account{accounts?.length === 1 ? '' : 's'} total
            </p>
          </div>
          <Link
            href="/admin/team"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Manage admins
          </Link>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Total accounts" value={totalAccounts} />
          <StatCard label="WhatsApp connected" value={whatsappConnectedCount} />
          <StatCard label="Messenger connected" value={messengerConnectedCount} />
          <StatCard label="Total contacts" value={totalContacts} />
          <StatCard label="Total messages" value={totalMessages} />
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full rounded-lg border border-border bg-muted py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
            {(['all', 'whatsapp', 'messenger', 'none'] as ChannelFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setChannelFilter(filter)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  channelFilter === filter
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {filter === 'none' ? 'No channel' : filter}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                <SortableHeader label="Account" column="name" current={sortColumn} direction={sortDirection} onSort={toggleSort} />
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Channels</th>
                <SortableHeader label="Contacts" column="contact_count" current={sortColumn} direction={sortDirection} onSort={toggleSort} />
                <SortableHeader label="Messages" column="message_count" current={sortColumn} direction={sortDirection} onSort={toggleSort} />
                <SortableHeader label="Created" column="created_at" current={sortColumn} direction={sortDirection} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {visibleAccounts.map((account) => (
                <tr key={account.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <Link href={`/admin/accounts/${account.id}`} className="hover:text-primary hover:underline">
                      {account.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {account.owner_name || account.owner_email || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge lastActivityAt={account.last_activity_at} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <PlugZap
                        className={`size-4 ${account.whatsapp_connected ? 'text-green-500' : 'text-muted-foreground/30'}`}
                      />
                      <MessageCircle
                        className={`size-4 ${account.messenger_connected ? 'text-blue-500' : 'text-muted-foreground/30'}`}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{account.contact_count}</td>
                  <td className="px-4 py-3 text-foreground">{account.message_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(account.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {visibleAccounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    {accounts?.length === 0 ? 'No accounts yet.' : 'No accounts match your search/filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

/** Pure helper, not a component — keeps Date.now() out of any
 *  component's render body per the react-hooks/purity rule. */
function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Simple activity-recency badge: Active (message within 7 days),
 * Quiet (8–30 days), Inactive (30+ days or never messaged). Purely
 * a visual signal for where to look first — not a stored status,
 * so it always reflects the real data live.
 */
function StatusBadge({ lastActivityAt }: { lastActivityAt: string | null }) {
  if (!lastActivityAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" /> No activity
      </span>
    );
  }

  const days = daysSince(lastActivityAt);

  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-500">
        <span className="size-1.5 rounded-full bg-green-500" /> Active
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-yellow-500">
        <span className="size-1.5 rounded-full bg-yellow-500" /> Quiet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" /> Inactive
    </span>
  );
}

function SortableHeader({
  label,
  column,
  current,
  direction,
  onSort,
}: {
  label: string;
  column: SortColumn;
  current: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  const isActive = current === column;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        onClick={() => onSort(column)}
        className="flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {isActive &&
          (direction === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </th>
  );
}
