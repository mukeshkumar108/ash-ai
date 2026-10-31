import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  createCalendarEvent,
  createGmailDraft,
  getRecentGmailMessages,
  getUpcomingCalendarEvents,
} from '@/lib/workspace-connect';

/**
 * Gmail and Calendar as executive capabilities. They run through the app's own workspace-connect client (the app already holds that identity), so no
 * Google credential or signing secret ever reaches the Runtime or Cortex. Cortex enforces consequence and confirmation from the declaration below.
 * Nothing here sends mail: a draft is saved to the person's Drafts and stays there until they send it themselves.
 */
export const GOOGLE_CAPABILITY_DECLARATIONS = [
  {
    tool: 'calendar.agenda',
    description: 'Read the person\'s calendar for the next N days (default 7). Result arrives as an observation.',
    args: { days: 'number, 1-30' },
    consequence: 'none',
    reversible: true,
  },
  {
    tool: 'gmail.search',
    description: 'Search recent Gmail (sender, subject, date, snippet; never full bodies). Result arrives as an observation.',
    args: { query: 'Gmail search string, optional', limit: 'number, 1-20' },
    consequence: 'none',
    reversible: true,
  },
  {
    tool: 'gmail.draft',
    description: 'Save an email draft in the person\'s Gmail Drafts. Never sends.',
    args: { to: 'string[]', subject: 'string', body: 'plain text', reply_to_message_id: 'optional', thread_id: 'optional' },
    consequence: 'low',
    reversible: true,
  },
  {
    tool: 'calendar.create',
    description: 'Create a calendar event. Needs the person\'s go-ahead first.',
    args: { title: 'string', start: 'ISO with offset', end: 'ISO with offset', time_zone: 'IANA', location: 'optional', description: 'optional' },
    consequence: 'moderate',
    reversible: false,
  },
] as const;

export const GOOGLE_TOOLS: ReadonlySet<string> = new Set(
  GOOGLE_CAPABILITY_DECLARATIONS.map((d) => d.tool),
);

export type GoogleDeps = {
  getEvents: typeof getUpcomingCalendarEvents;
  getMessages: typeof getRecentGmailMessages;
  makeDraft: typeof createGmailDraft;
  makeEvent: typeof createCalendarEvent;
};

const live: GoogleDeps = {
  getEvents: getUpcomingCalendarEvents,
  getMessages: getRecentGmailMessages,
  makeDraft: createGmailDraft,
  makeEvent: createCalendarEvent,
};

export type GoogleOutcome = { resultRef: string; detail?: string };

function str(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max);
}

function validIso(v: unknown): string | null {
  const s = str(v, 40);
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) && /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : null;
}

/** Runs one Google capability; throws with a plain reason on any refusal, so the caller reports a failed receipt and never a success. */
export async function runGoogleCapability(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  workItemId: string,
  deps: GoogleDeps = live,
): Promise<GoogleOutcome> {
  if (tool === 'calendar.agenda') {
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const result = await deps.getEvents(userId, { days });
    const events = result.events.map((e) => ({
      id: e.eventId,
      title: e.title,
      start: e.start ?? e.startDate,
      end: e.end ?? e.endDate,
      all_day: e.allDay,
      location: e.location,
    }));
    return { resultRef: `events:${events.length}`, detail: JSON.stringify(events).slice(0, 1_900) };
  }
  if (tool === 'gmail.search') {
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 10));
    const query = str(args.query, 200);
    const messages = await deps.getMessages(userId, { limit, ...(query ? { query } : {}) });
    const rows = messages.map((m) => ({
      id: m.messageId,
      from: m.sender,
      subject: m.subject,
      date: m.date,
      unread: m.isUnread,
      snippet: m.snippet.slice(0, 120),
    }));
    return { resultRef: `messages:${rows.length}`, detail: JSON.stringify(rows).slice(0, 1_900) };
  }
  if (tool === 'gmail.draft') {
    const to = (Array.isArray(args.to) ? args.to : [args.to]).map((a) => str(a, 254)).filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (to.length === 0) throw new Error('gmail.draft needs a valid recipient address');
    const subject = str(args.subject, 300);
    const body = str(args.body, 20_000);
    if (!subject || !body) throw new Error('gmail.draft needs a subject and a body');
    const draft = await deps.makeDraft(userId, {
      to,
      subject,
      plainTextBody: body,
      replyToMessageId: str(args.reply_to_message_id, 200) || null,
      threadId: str(args.thread_id, 200) || null,
    });
    return { resultRef: draft.draftId, detail: 'saved to Drafts; not sent' };
  }
  if (tool === 'calendar.create') {
    const title = str(args.title, 300);
    const start = validIso(args.start);
    const end = validIso(args.end);
    if (!title || !start || !end) throw new Error('calendar.create needs a title and a start and end with a time zone offset');
    if (new Date(end) <= new Date(start)) throw new Error('calendar.create: the end must be after the start');
    const event = await deps.makeEvent(
      userId,
      {
        kind: 'timed',
        title,
        description: str(args.description, 2_000) || null,
        location: str(args.location, 300) || null,
        start,
        end,
        timeZone: str(args.time_zone, 64) || 'Europe/London',
      },
      `exec-${workItemId || randomUUID()}`,
    );
    return { resultRef: event.eventId, detail: `created ${title}` };
  }
  throw new Error(`unsupported google tool: ${tool}`);
}
