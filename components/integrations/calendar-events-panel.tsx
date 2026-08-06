'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addCalendarDays,
  calendarEventTimeLabel,
  safeGoogleCalendarUrl,
  writeErrorMessage,
  writeRequest,
  zonedDateTimeToIso,
  type CalendarEvent,
} from '@/lib/integrations';
import { generateUUID } from '@/lib/utils';

type BusyAction = 'create' | 'get' | 'update' | 'delete' | null;

type Notice = { kind: 'success' | 'error'; text: string } | null;

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function CalendarEventsPanel({
  onEventChange,
}: {
  onEventChange: () => void;
}) {
  const [allDay, setAllDay] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(today());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [timeZone, setTimeZone] = useState('Europe/London');

  const [currentEvent, setCurrentEvent] = useState<CalendarEvent | null>(null);
  const [operationId, setOperationId] = useState(() => generateUUID());
  const [busy, setBusy] = useState<BusyAction>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const eventUrl = currentEvent
    ? `/api/integrations/google/calendar/events/${encodeURIComponent(
        currentEvent.eventId,
      )}`
    : null;

  const buildBody = (includeOperationId: boolean) => {
    if (allDay) {
      // Google all-day event end dates are exclusive, so a one-day event
      // on the selected date ends on the following calendar day.
      return {
        ...(includeOperationId ? { operationId } : {}),
        title,
        description: description || null,
        location: location || null,
        startDate: date,
        endDate: addCalendarDays(date, 1),
      };
    }

    const start = zonedDateTimeToIso(date, startTime, timeZone);
    const end = zonedDateTimeToIso(date, endTime, timeZone);

    if (!start || !end) {
      setNotice({
        kind: 'error',
        text: 'Enter a valid date and time.',
      });
      return null;
    }

    return {
      ...(includeOperationId ? { operationId } : {}),
      title,
      description: description || null,
      location: location || null,
      start,
      end,
      timeZone,
    };
  };

  const handleCreate = async () => {
    const body = buildBody(true);

    if (!body) {
      return;
    }

    setBusy('create');
    setNotice(null);

    const result = await writeRequest<CalendarEvent>(
      '/api/integrations/google/calendar/events',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    setBusy(null);

    if (result.ok) {
      setCurrentEvent(result.data);
      setNotice({
        kind: 'success',
        text: `Event created with ID ${result.data.eventId}`,
      });
      setOperationId(generateUUID());
      onEventChange();
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const handleGet = async () => {
    if (!eventUrl) {
      setNotice({ kind: 'error', text: 'Create an event first.' });
      return;
    }

    setBusy('get');
    setNotice(null);

    const result = await writeRequest<CalendarEvent>(eventUrl, {
      cache: 'no-store',
    });

    setBusy(null);

    if (result.ok) {
      setCurrentEvent(result.data);
      setNotice({ kind: 'success', text: 'Event retrieved.' });
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const handleUpdate = async () => {
    if (!eventUrl) {
      setNotice({ kind: 'error', text: 'Create an event first.' });
      return;
    }

    const body = buildBody(false);

    if (!body) {
      return;
    }

    setBusy('update');
    setNotice(null);

    const result = await writeRequest<CalendarEvent>(eventUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    setBusy(null);

    if (result.ok) {
      setCurrentEvent(result.data);
      setNotice({ kind: 'success', text: 'Event updated.' });
      onEventChange();
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const handleDelete = async () => {
    if (!eventUrl) {
      return;
    }

    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setBusy('delete');
    setNotice(null);

    const result = await writeRequest<{ deleted: boolean }>(eventUrl, {
      method: 'DELETE',
    });

    setBusy(null);
    setConfirmingDelete(false);

    if (result.ok) {
      setCurrentEvent(null);
      setNotice({ kind: 'success', text: 'Event deleted.' });
      onEventChange();
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const inputClass = 'bg-muted text-md md:text-sm';
  const safeLink = safeGoogleCalendarUrl(currentEvent?.htmlLink ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar Event</CardTitle>
        <CardDescription>
          Create, update, and delete an event on your primary calendar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="event-title"
              className="text-zinc-600 dark:text-zinc-400"
            >
              Title
            </Label>
            <Input
              id="event-title"
              className={inputClass}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy !== null}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="event-description"
              className="text-zinc-600 dark:text-zinc-400"
            >
              Description
            </Label>
            <Textarea
              id="event-description"
              className="bg-muted text-md min-h-[70px] md:text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy !== null}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="event-location"
              className="text-zinc-600 dark:text-zinc-400"
            >
              Location
            </Label>
            <Input
              id="event-location"
              className={inputClass}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              disabled={busy !== null}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(event) => setAllDay(event.target.checked)}
              disabled={busy !== null}
            />
            All-day event
          </label>

          {allDay ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label
                  htmlFor="event-date"
                  className="text-zinc-600 dark:text-zinc-400"
                >
                  Date
                </Label>
                <Input
                  id="event-date"
                  type="date"
                  className={inputClass}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  disabled={busy !== null}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label
                  htmlFor="event-date"
                  className="text-zinc-600 dark:text-zinc-400"
                >
                  Date
                </Label>
                <Input
                  id="event-date"
                  type="date"
                  className={inputClass}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  disabled={busy !== null}
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="event-start"
                  className="text-zinc-600 dark:text-zinc-400"
                >
                  Start time
                </Label>
                <Input
                  id="event-start"
                  type="time"
                  className={inputClass}
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  disabled={busy !== null}
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="event-end"
                  className="text-zinc-600 dark:text-zinc-400"
                >
                  End time
                </Label>
                <Input
                  id="event-end"
                  type="time"
                  className={inputClass}
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  disabled={busy !== null}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label
              htmlFor="event-timezone"
              className="text-zinc-600 dark:text-zinc-400"
            >
              Time zone
            </Label>
            <Input
              id="event-timezone"
              className={inputClass}
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              disabled={busy !== null}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleCreate}
              disabled={busy !== null}
            >
              {busy === 'create' ? 'Creating...' : 'Create event'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleGet}
              disabled={busy !== null || !currentEvent}
            >
              {busy === 'get' ? 'Retrieving...' : 'Retrieve current event'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleUpdate}
              disabled={busy !== null || !currentEvent}
            >
              {busy === 'update' ? 'Updating...' : 'Update current event'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={busy !== null || !currentEvent}
            >
              {busy === 'delete'
                ? 'Deleting...'
                : confirmingDelete
                  ? 'Confirm delete'
                  : 'Delete current event'}
            </Button>
            {confirmingDelete && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy !== null}
              >
                Cancel
              </Button>
            )}
          </div>

          {notice && (
            <p
              data-testid="event-notice"
              className={
                notice.kind === 'success'
                  ? 'text-sm text-green-600'
                  : 'text-sm text-red-600'
              }
            >
              {notice.text}
            </p>
          )}

          {currentEvent && (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <p className="font-medium text-foreground">
                Event {currentEvent.eventId}
              </p>
              <p className="mt-1 text-muted-foreground">
                Title: {currentEvent.title || '(untitled)'}
              </p>
              <p className="text-muted-foreground">
                Time: {calendarEventTimeLabel(currentEvent)}
              </p>
              <p className="text-muted-foreground">
                Status: {currentEvent.status}
              </p>
              {safeLink && (
                <a
                  href={safeLink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  Open in Google Calendar
                </a>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
