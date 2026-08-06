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
import type { IntegrationsGoogleStatusResponse } from '@/lib/integrations';

type ViewState =
  | { view: 'loading' }
  | { view: 'unavailable' }
  | { view: 'disconnected' }
  | {
      view: 'connected';
      googleEmail: string;
      gmailAuthorized: boolean;
      calendarAuthorized: boolean;
    };

export function IntegrationsPanel({
  callbackReturned,
}: {
  callbackReturned: boolean;
}) {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [view, setView] = useState<ViewState>({ view: 'loading' });
  const [disconnecting, setDisconnecting] = useState(false);
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

      if (data.connected && data.googleEmail) {
        setView({
          view: 'connected',
          googleEmail: data.googleEmail,
          gmailAuthorized: data.gmailAuthorized,
          calendarAuthorized: data.calendarAuthorized,
        });
        return;
      }

      setView({ view: 'disconnected' });
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

  const handleDisconnect = async () => {
    setDisconnecting(true);

    try {
      const response = await fetch('/api/integrations/google', {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({ type: 'success', description: 'Google disconnected' });
        await loadStatus();
        return;
      }

      const body = await response.json().catch(() => null);

      if (body?.error === 'workspace_connect_unavailable') {
        toast({
          type: 'error',
          description:
            'Google could not be disconnected. Please try again later.',
        });
      } else {
        toast({ type: 'error', description: 'Failed to disconnect Google' });
      }
    } catch (error) {
      console.error('[integrations] failed to disconnect Google:', error);
      toast({ type: 'error', description: 'Failed to disconnect Google' });
    } finally {
      setDisconnecting(false);
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
          <CardDescription>Connect Gmail and Google Calendar.</CardDescription>
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

  if (view.view === 'disconnected') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Google</CardTitle>
          <CardDescription>Connect Gmail and Google Calendar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/integrations/google" method="POST">
            <Button type="submit">Connect Google</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google</CardTitle>
        <CardDescription>Connected as {view.googleEmail}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="mb-4 space-y-1 text-sm text-muted-foreground">
          <li>
            Gmail: {view.gmailAuthorized ? 'Authorised' : 'Not authorised'}
          </li>
          <li>
            Calendar:{' '}
            {view.calendarAuthorized ? 'Authorised' : 'Not authorised'}
          </li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/settings/integrations/google">
              View Gmail &amp; Calendar
            </Link>
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect Google'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
