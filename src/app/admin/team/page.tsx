'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, ShieldAlert, ArrowLeft, UserPlus, Trash2 } from 'lucide-react';

interface AdminRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  granted_at: string;
}

/**
 * Platform admin team management — add/remove who can see the
 * /admin dashboard. Deliberately separate from any per-account role;
 * this controls platform-wide access, so every action here re-checks
 * requirePlatformAdmin() server-side (see /api/admin/admins) rather
 * than trusting anything client-side.
 */
export default function AdminTeamPage() {
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadAdmins = () => {
    setLoading(true);
    fetch('/api/admin/admins')
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((data) => setAdmins(data.admins))
      .catch((err) => setError(err.message ?? 'Failed to load admins'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to add admin');
      toast.success('Admin access granted.');
      setNewEmail('');
      loadAdmins();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add admin');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove platform admin access for this user?')) return;
    setRemovingId(userId);
    try {
      const res = await fetch(`/api/admin/admins?user_id=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed to remove admin');
      toast.success('Admin access removed.');
      loadAdmins();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove admin');
    } finally {
      setRemovingId(null);
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

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to accounts
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Platform Admins</h1>
          <p className="text-sm text-muted-foreground">
            Who can see the /admin dashboard across every account.
          </p>
        </div>

        <form onSubmit={handleAdd} className="mb-6 flex gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Add by email — must already have an account"
            className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding || !newEmail.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
            Add
          </button>
        </form>

        <div className="overflow-hidden rounded-lg border border-border">
          {admins?.map((admin) => (
            <div
              key={admin.user_id}
              className="flex items-center justify-between border-b border-border px-4 py-3 text-sm last:border-0"
            >
              <div>
                <p className="font-medium text-foreground">{admin.full_name || admin.email || '—'}</p>
                {admin.full_name && admin.email && (
                  <p className="text-xs text-muted-foreground">{admin.email}</p>
                )}
              </div>
              <button
                onClick={() => handleRemove(admin.user_id)}
                disabled={removingId === admin.user_id || admins.length <= 1}
                title={admins.length <= 1 ? "Can't remove the last remaining admin" : 'Remove admin access'}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              >
                {removingId === admin.user_id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </button>
            </div>
          ))}
          {admins?.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No admins found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
