'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { GmailThreadDrawer } from '@/components/integrations/gmail-thread-drawer';
import { GmailDraftsPanel } from '@/components/integrations/gmail-drafts-panel';
import { CalendarEventsPanel } from '@/components/integrations/calendar-events-panel';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  calendarEventTimeLabel,
  describeIntegrationFailure,
  formatGmailMessageDate,
  type CalendarEvent,
  type CalendarEventsResult,
  type GmailMessageSummary,
  type IntegrationDataResponse,
  type IntegrationFailureReason,
} from '@/lib/integrations';
import { cn } from '@/lib/utils';

type SectionState<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'failure'; reason: IntegrationFailureReason };

async function fetchSection<T>(url: string): Promise<SectionState<T>> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body: IntegrationDataResponse<T> = await response.json();

    if (body.ok) {
      return { state: 'ready', data: body.data };
    }

    return { state: 'failure', reason: body.reason };
  } catch {
    return { state: 'failure', reason: 'unavailable' };
  }
}

function SectionFailure({
  reason,
  onRetry,
}: {
  reason: IntegrationFailureReason;
  onRetry: () => void;
}) {
  const needsReconnect = reason === 'not_connected' || reason === 'revoked';

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {describeIntegrationFailure(reason)}
      </p>
      {needsReconnect ? (
        <form action="/api/integrations/google" method="POST">
          <Button type="submit">
            {reason === 'revoked' ? 'Reconnect Google' : 'Connect Google'}
          </Button>
        </form>
      ) : (
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function GoogleDataPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [gmail, setGmail] = useState<SectionState<GmailMessageSummary[]>>({
    state: 'loading',
  });
  const [calendar, setCalendar] = useState<SectionState<CalendarEvent[]>>({
    state: 'loading',
  });
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setGmail({ state: 'loading' });

    const messagesResult = await fetchSection<{
      messages: GmailMessageSummary[];
    }>('/api/integrations/google/gmail/messages');

    setGmail(
      messagesResult.state === 'ready'
        ? { state: 'ready', data: messagesResult.data.messages }
        : messagesResult,
    );
  }, []);

  const loadEvents = useCallback(async () => {
    setCalendar({ state: 'loading' });

    const eventsResult = await fetchSection<CalendarEventsResult>(
      '/api/integrations/google/calendar/events',
    );

    setCalendar(
      eventsResult.state === 'ready'
        ? { state: 'ready', data: eventsResult.data.events }
        : eventsResult,
    );
  }, []);

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (sessionStatus === 'authenticated') {
      loadMessages();
      loadEvents();
    }
  }, [sessionStatus, router, loadMessages, loadEvents]);

  if (gmail.state === 'loading' && calendar.state === 'loading') {
    return (
      <div className="flex justify-center py-16">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
          <p className="text-sm text-muted-foreground">Loading your data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Gmail</CardTitle>
          <CardDescription>Latest messages</CardDescription>
        </CardHeader>
        <CardContent>
          {gmail.state === 'loading' && (
            <p className="py-4 text-sm text-muted-foreground">
              Loading messages...
            </p>
          )}

          {gmail.state === 'failure' && (
            <SectionFailure reason={gmail.reason} onRetry={loadMessages} />
          )}

          {gmail.state === 'ready' && gmail.data.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">No messages</p>
          )}

          {gmail.state === 'ready' && gmail.data.length > 0 && (
            <ul className="-mx-1 divide-y divide-border">
              {gmail.data.map((message) => (
                <li key={message.messageId}>
                  <button
                    type="button"
                    onClick={() => setSelectedThreadId(message.threadId)}
                    className="w-full px-1 py-3 text-left transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex w-2 shrink-0 justify-center">
                        {message.isUnread && (
                          <span className="h-2 w-2 rounded-full bg-blue-500" />
                        )}
                      </span>
                      <span
                        className={cn(
                          'truncate text-sm',
                          message.isUnread
                            ? 'font-semibold text-foreground'
                            : 'text-foreground',
                        )}
                      >
                        {message.sender || 'Unknown sender'}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatGmailMessageDate(message.date)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-foreground">
                      {message.subject || '(no subject)'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {message.snippet}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
          <CardDescription>Next 7 days</CardDescription>
        </CardHeader>
        <CardContent>
          {calendar.state === 'loading' && (
            <p className="py-4 text-sm text-muted-foreground">
              Loading events...
            </p>
          )}

          {calendar.state === 'failure' && (
            <SectionFailure reason={calendar.reason} onRetry={loadEvents} />
          )}

          {calendar.state === 'ready' && calendar.data.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              No upcoming events
            </p>
          )}

          {calendar.state === 'ready' && calendar.data.length > 0 && (
            <ul className="-mx-1 divide-y divide-border">
              {calendar.data.map((event) => (
                <li key={event.eventId} className="px-1 py-3">
                  <p className="text-sm font-medium text-foreground">
                    {event.title || '(untitled event)'}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {calendarEventTimeLabel(event)}
                  </p>
                  {event.location ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {event.location}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <GmailDraftsPanel />

      <CalendarEventsPanel onEventChange={loadEvents} />

      <GmailThreadDrawer
        threadId={selectedThreadId}
        onClose={() => setSelectedThreadId(null)}
      />
    </div>
  );
}
