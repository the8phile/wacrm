'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Ban } from 'lucide-react';

/**
 * Full-screen block shown to any signed-in user whose account has
 * been suspended (see /admin/accounts/[id] → Suspend). Middleware
 * redirects here before the dashboard shell ever renders, so a
 * suspended team never sees a confusing empty/zeroed-out dashboard —
 * they see exactly what's wrong and why.
 */
export default function AccountSuspendedPage() {
  return (
    <Suspense fallback={null}>
      <AccountSuspendedInner />
    </Suspense>
  );
}

function AccountSuspendedInner() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10">
        <Ban className="size-8 text-destructive" />
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Account suspended</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This account has been suspended and is no longer accessible. Your AI has also
        stopped auto-replying to customers.
      </p>
      {reason && (
        <p className="max-w-md rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
          <span className="font-medium">Reason: </span>
          {reason}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        If you believe this is a mistake, please contact support.
      </p>
    </div>
  );
}
