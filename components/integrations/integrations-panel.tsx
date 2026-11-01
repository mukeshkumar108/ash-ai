'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from '@/components/toast';
import type {
  GoogleCapability,
  IntegrationsGoogleStatusResponse,
} from '@/lib/integrations';

type ViewState =
  | { view: 'loading' }
  | { view: 'unavailable' }
  | {
      view: 'ready';
      googleEmail: string | null;
      connected: boolean;
      capabilities: GoogleCapability[];
      declined: string[];
    };

export function IntegrationsPanel({
  callbackReturned,
}: {
  callbackReturned: boolean;
}) {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [view, setView] = useState<ViewState>({ view: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const handledCallbackRef = useRef(false);

  const loadStatus = useCallback(async () => {
    setView({ view: 'loading' });

    try {
      const response = await fetch('/api/integrations/google', {
        cache: 'no-store',
      });
      const data: IntegrationsGoogleStatusResponse = await response.json();

      if (data.available === false) {
        setView({ view: 'unavailable' });
        return;
      }

      setView({
        view: 'ready',
        googleEmail: data.googleEmail,
        connected: data.connected && Boolean(data.googleEmail),
        capabilities: data.capabilities ?? [],
        declined: data.declined ?? [],
      });
    } catch (error) {
      console.error('[integrations] failed to load Google status:', error);
      setView({ view: 'unavailable' });
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (sessionStatus === 'authenticated') {
      loadStatus();
    }
  }, [sessionStatus, router, loadStatus]);

  useEffect(() => {
    if (!callbackReturned || handledCallbackRef.current) {
      return;
    }

    handledCallbackRef.current = true;
    router.replace('/settings/integrations');
  }, [callbackReturned, router]);

  const turnOff = async (capability: GoogleCapability) => {
    setBusy(capability.id);
    try {
      const response = await fetch(
        `/api/integrations/google?capability=${encodeURIComponent(capability.id)}`,
        { method: 'DELETE' },
      );
      if (response.ok) {
        toast({ type: 'success', description: `${capability.label} turned off` });
        await loadStatus();
        return;
      }
      toast({ type: 'error', description: `Could not turn off ${capability.label}` });
    } catch (error) {
      console.error('[integrations] failed to turn off a capability:', error);
      toast({ type: 'error', description: `Could not turn off ${capability.label}` });
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setBusy('all');

    try {
      const response = await fetch('/api/integrations/google', {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({ type: 'success', description: 'Google disconnected' });
        await loadStatus();
        return;
      }

      toast({ type: 'error', description: 'Failed to disconnect Google' });
    } catch (error) {
      console.error('[integrations] failed to disconnect Google:', error);
      toast({ type: 'error', description: 'Failed to disconnect Google' });
    } finally {
      setBusy(null);
    }
  };

  if (view.view === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
          <p className="text-sm text-muted-foreground">
            Loading integrations...
          </p>
        </div>
      </div>
    );
  }

  if (view.view === 'unavailable') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Google</CardTitle>
          <CardDescription>
            Sophie works without it. Add what you want, when you want it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            The Google connection service is currently unavailable. Please try
            again later.
          </p>
          <Button type="button" onClick={loadStatus}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const anyOn = view.capabilities.some((c) => c.enabled);
  const names = new Map(view.capabilities.map((c) => [c.id, c.label]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google</CardTitle>
        <CardDescription>
          {view.connected
            ? `Connected as ${view.googleEmail}`
            : 'Sophie works without it. Add only what you want, when you want it.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {view.declined.length > 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">
            Google did not allow {view.declined.map((id) => names.get(id) ?? id).join(', ')}.
            Nothing was added for it. You can try again whenever you like.
          </p>
        ) : null}
        <ul className="mb-4 divide-y">
          {view.capabilities.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-sm text-muted-foreground">{c.description}</p>
                {c.enabled && c.sharedWith.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Also shared with {c.sharedWith.join(', ')}
                  </p>
                ) : null}
              </div>
              {c.enabled ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => turnOff(c)}
                >
                  {busy === c.id ? 'Turning off...' : 'Turn off'}
                </Button>
              ) : (
                <form action="/api/integrations/google" method="POST">
                  <input type="hidden" name="capabilities" value={c.id} />
                  <Button type="submit" size="sm" disabled={busy !== null}>
                    Turn on
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {anyOn ? (
            <Button asChild variant="outline">
              <Link href="/settings/integrations/google">
                View Gmail &amp; Calendar
              </Link>
            </Button>
          ) : null}
          {view.connected ? (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDisconnect}
              disabled={busy !== null}
            >
              {busy === 'all' ? 'Disconnecting...' : 'Disconnect Google'}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
