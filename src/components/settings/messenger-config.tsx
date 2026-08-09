'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_TOKEN = '••••••••••••••••';

interface MessengerStatus {
  connected: boolean;
  page_id: string | null;
  connected_at: string | null;
}

/**
 * Messenger connection settings. Deliberately leaner than
 * WhatsAppConfig (no phone registration flow, no PIN, no Meta
 * subscription probe) — Messenger's Send API just needs a Page ID
 * and a Page Access Token, and /api/messenger/config does the
 * encrypt-and-save server-side.
 */
export function MessengerConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<MessengerStatus | null>(null);
  const [pageId, setPageId] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenEdited, setTokenEdited] = useState(false);

  const fetchStatus = () => {
    setLoading(true);
    fetch('/api/messenger/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: MessengerStatus) => {
        setStatus(data);
        setPageId(data.page_id ?? '');
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSave = async () => {
    if (!pageId.trim()) {
      toast.error('Enter your Facebook Page ID.');
      return;
    }
    if (!pageAccessToken.trim() && !status?.connected) {
      toast.error('Enter your Page Access Token.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/messenger/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: pageId.trim(),
          // Only send the token if the user actually typed a new one —
          // an empty field on an already-connected account means "keep
          // the existing token", not "erase it".
          ...(pageAccessToken.trim() ? { page_access_token: pageAccessToken.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error('save failed');
      toast.success('Messenger connected.');
      setPageAccessToken('');
      setTokenEdited(false);
      fetchStatus();
    } catch {
      toast.error('Could not save Messenger settings. Check your Page ID and token.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsPanelHead
        title="Messenger"
        description="Connect a Facebook Page so the same AI auto-reply that answers WhatsApp can answer Messenger too."
      />

      {status?.connected ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>
            Page ID {status.page_id} is connected.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Not connected</AlertTitle>
          <AlertDescription>
            Add your Facebook Page ID and Page Access Token below to start receiving and replying to Messenger messages.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Page connection</CardTitle>
          <CardDescription>
            Get these from developers.facebook.com under your app&apos;s Messenger settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="messenger-page-id">Page ID</Label>
            <Input
              id="messenger-page-id"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="e.g. 282020521664932"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="messenger-token">Page Access Token</Label>
            <div className="relative">
              <Input
                id="messenger-token"
                type={showToken ? 'text' : 'password'}
                value={tokenEdited ? pageAccessToken : status?.connected ? MASKED_TOKEN : pageAccessToken}
                onChange={(e) => {
                  setTokenEdited(true);
                  setPageAccessToken(e.target.value);
                }}
                onFocus={() => {
                  if (status?.connected && !tokenEdited) {
                    setTokenEdited(true);
                    setPageAccessToken('');
                  }
                }}
                placeholder={status?.connected ? 'Leave blank to keep current token' : 'Paste your Page Access Token'}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook</CardTitle>
          <CardDescription>Set this in your Meta app&apos;s Messenger settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Callback URL: </span>
            <code className="rounded bg-muted px-1.5 py-0.5">
              {typeof window !== 'undefined' ? window.location.origin : ''}/api/messenger/webhook
            </code>
          </div>
          <p className="text-muted-foreground">
            Pick any verify token when subscribing the webhook, then paste that same value here if it differs from what&apos;s already saved.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
