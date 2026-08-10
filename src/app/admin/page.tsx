'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, MessageCircle, PlugZap } from 'lucide-react';

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
}

/**
 * Platform admin dashboard — every account on the whole platform,
 * with basic activity stats. Gated by `requirePlatformAdmin()` on
 * the API side (see /api/admin/accounts); this page itself just
 * renders whatever that endpoint returns, or the 403 it sends back
 * for anyone who isn't a platform admin.
 */
export default function AdminDashboardPage() {
  const [accounts, setAccounts] = useState<AdminAccountRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Platform Admin</h1>
          <p className="text-sm text-muted-foreground">
            {accounts?.length ?? 0} account{accounts?.length === 1 ? '' : 's'} total
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Channels</th>
                <th className="px-4 py-3 font-medium">Contacts</th>
                <th className="px-4 py-3 font-medium">Messages</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {accounts?.map((account) => (
                <tr key={account.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{account.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {account.owner_name || account.owner_email || '—'}
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
              {accounts?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No accounts yet.
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
