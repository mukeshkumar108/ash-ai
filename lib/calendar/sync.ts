import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import { calendarEventSync, type CalendarEventSync } from '@/lib/db/schema';
import {
  getCalendarEvent,
  getGoogleConnectionStatus,
  getUpcomingCalendarEvents,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';
import { postObjectState } from '@/lib/synapse-cortex';

/**
 * Calendar awareness via the existing Workspace Connect boundary.
 *
 * Google Calendar stays canonical: this module keeps only a minimal durable
 * reconciliation index (identity, timing, status, content hash, revision) for
 * the bounded sync window, pushes deterministic object-state to Cortex via the
 * stable source-link contract (`google_calendar` + event id + revision), and
 * marks a bounded post-event follow-up window. It never sends messages —
 * proactive outreach remains the exclusive decision of the initiative system.
 */

const SYNC_DAYS_AHEAD = Number(process.env.CALENDAR_SYNC_DAYS_AHEAD ?? 2);
const SYNC_LOOKBACK_HOURS = Number(
  process.env.CALENDAR_SYNC_LOOKBACK_HOURS ?? 24,
);
const FOLLOWUP_WINDOW_HOURS = Number(
  process.env.CALENDAR_FOLLOWUP_WINDOW_HOURS ?? 6,
);
const COMPLETED_PUSH_LOOKBACK_HOURS = 24;
const MAX_USERS_PER_SWEEP = Number(process.env.CALENDAR_SYNC_MAX_USERS ?? 50);
const PUSH_TIMEOUT_MS = Number(
  process.env.SYNAPSE_CORTEX_INGEST_TIMEOUT_MS ?? 20_000,
);

export type CalendarEventSnapshot = {
  eventId: string;
  calendarId: string;
  status: string;
  title: string | null;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
};

export type SyncDeps = {
  now?: Date;
  timeZone?: string | null;
  fetchEvents?: (userId: string) => Promise<CalendarEventSnapshot[]>;
  getEvent?: (
    userId: string,
    eventId: string,
  ) => Promise<CalendarEventSnapshot | null>;
  post?: typeof postObjectState;
};

export function calendarContentHash(event: {
  status: string;
  title: string | null;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
}): string {
  return createHash('sha256')
    .update(
      [
        event.status,
        event.title ?? '',
        event.start?.toISOString() ?? '',
        event.end?.toISOString() ?? '',
        event.allDay ? '1' : '0',
      ].join('|'),
    )
    .digest('hex');
}

function snapshotFromProvider(event: {
  eventId: string;
  calendarId: string;
  status: string;
  title: string | null;
  start: string | null;
  end: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
}): CalendarEventSnapshot {
  const parse = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const start = parse(event.start) ?? parse(event.startDate);
  const end = parse(event.end) ?? parse(event.endDate);
  return {
    eventId: event.eventId,
    calendarId: event.calendarId || 'primary',
    status: event.status || 'confirmed',
    title: event.title?.slice(0, 500) ?? null,
    start,
    end,
    allDay: event.allDay,
  };
}

export const defaultFetchEvents = async (
  userId: string,
): Promise<CalendarEventSnapshot[]> => {
  const result = await getUpcomingCalendarEvents(userId, {
    days: SYNC_DAYS_AHEAD,
    limit: 50,
  });
  return result.events.map(snapshotFromProvider);
};

export const defaultGetEvent = async (
  userId: string,
  eventId: string,
): Promise<CalendarEventSnapshot | null> => {
  try {
    const event = await getCalendarEvent(userId, eventId);
    return snapshotFromProvider(event);
  } catch (error) {
    if (error instanceof WorkspaceConnectError && error.code === 'not_found') {
      return null;
    }
    throw error;
  }
};

async function pushEventState(
  userId: string,
  chatId: string,
  row: CalendarEventSync,
  action: 'created' | 'updated' | 'completed' | 'cancelled',
  timeZone: string | null,
  post: typeof postObjectState,
  now: Date,
): Promise<boolean> {
  const outcome = await post(
    {
      userId,
      chatId,
      now,
      timeZone: timeZone ?? undefined,
      source: {
        system: 'google_calendar',
        objectId: row.eventId,
        version: row.revision,
        kind: 'calendar_event',
      },
      action,
      title: row.title ?? 'Calendar event',
      eventStart: row.startAt,
      eventEnd: row.endAt,
      followupWindowHours:
        action === 'completed' ? FOLLOWUP_WINDOW_HOURS : null,
    },
    { timeoutMs: PUSH_TIMEOUT_MS },
  );
  if (!outcome.pushed) {
    console.warn('[calendar-sync] cortex push failed', {
      eventId: row.eventId,
      action,
      error: outcome.error,
    });
  }
  return outcome.pushed;
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function syncCalendarForUser(
  userId: string,
  anchorChatId: string,
  deps: SyncDeps = {},
): Promise<{
  fetched: number;
  created: number;
  updated: number;
  cancelled: number;
  completed: number;
  pushFailures: number;
}> {
  const now = deps.now ?? new Date();
  const timeZone = deps.timeZone ?? null;
  const fetchEvents = deps.fetchEvents ?? defaultFetchEvents;
  const getEvent = deps.getEvent ?? defaultGetEvent;
  const post = deps.post ?? postObjectState;
  const summary = {
    fetched: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    completed: 0,
    pushFailures: 0,
  };

  const events = await fetchEvents(userId);
  summary.fetched = events.length;
  const fetchedIds = new Set<string>();

  for (const rawEvent of events) {
    // Normalize injected/provider snapshots: dates may arrive as ISO strings.
    const event: CalendarEventSnapshot = {
      ...rawEvent,
      start: asDate(rawEvent.start),
      end: asDate(rawEvent.end),
    };
    fetchedIds.add(event.eventId);
    const hash = calendarContentHash(event);
    const [existing] = await db
      .select()
      .from(calendarEventSync)
      .where(
        and(
          eq(calendarEventSync.userId, userId),
          eq(calendarEventSync.eventId, event.eventId),
        ),
      )
      .limit(1);

    if (event.status === 'cancelled') {
      if (existing && existing.status !== 'cancelled') {
        const [updatedRow] = await db
          .update(calendarEventSync)
          .set({
            status: 'cancelled',
            revision: existing.revision + 1,
            contentHash: hash,
            updatedAt: now,
          })
          .where(eq(calendarEventSync.id, existing.id))
          .returning();
        summary.cancelled += 1;
        const pushed = await pushEventState(
          userId,
          anchorChatId,
          updatedRow,
          'cancelled',
          timeZone,
          post,
          now,
        );
        if (!pushed) summary.pushFailures += 1;
      }
      continue;
    }

    if (!existing) {
      const [inserted] = await db
        .insert(calendarEventSync)
        .values({
          userId,
          calendarId: event.calendarId,
          eventId: event.eventId,
          title: event.title,
          startAt: event.start,
          endAt: event.end,
          allDay: event.allDay,
          status: 'confirmed',
          contentHash: hash,
          revision: 1,
          lastSeenAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) continue; // concurrent sync won the race
      summary.created += 1;
      const pushed = await pushEventState(
        userId,
        anchorChatId,
        inserted,
        'created',
        timeZone,
        post,
        now,
      );
      if (!pushed) summary.pushFailures += 1;
      continue;
    }

    if (existing.contentHash !== hash || existing.status !== 'confirmed') {
      const [updatedRow] = await db
        .update(calendarEventSync)
        .set({
          title: event.title,
          startAt: event.start,
          endAt: event.end,
          allDay: event.allDay,
          status: 'confirmed',
          contentHash: hash,
          revision: existing.revision + 1,
          // Timing changed: any prior completion state is stale.
          completedAt: null,
          followupWindowEnd: null,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(calendarEventSync.id, existing.id))
        .returning();
      summary.updated += 1;
      const pushed = await pushEventState(
        userId,
        anchorChatId,
        updatedRow,
        'updated',
        timeZone,
        post,
        now,
      );
      if (!pushed) summary.pushFailures += 1;
      continue;
    }

    await db
      .update(calendarEventSync)
      .set({ lastSeenAt: now })
      .where(eq(calendarEventSync.id, existing.id));
  }

  // Reconciliation: rows inside the fetch window missing from the provider
  // response are verified individually. 404/not_found ⇒ cancelled (or
  // deleted — same lifecycle outcome for stale attention).
  const windowFloor = new Date(now.getTime() - SYNC_LOOKBACK_HOURS * 3_600_000);
  const tracked = await db
    .select()
    .from(calendarEventSync)
    .where(
      and(
        eq(calendarEventSync.userId, userId),
        eq(calendarEventSync.status, 'confirmed'),
        or(
          gte(calendarEventSync.startAt, windowFloor),
          gte(calendarEventSync.endAt, windowFloor),
        ),
      ),
    );
  for (const row of tracked) {
    if (fetchedIds.has(row.eventId)) continue;
    // NOTE: rows whose end has just passed (within the lookback floor above)
    // are deliberately NOT skipped: a provider-side deletion after an event
    // ended is exactly the stale-attention case we must reconcile. Events
    // still present in Google verify via getEvent and are left untouched.
    const current = await getEvent(userId, row.eventId).catch(() => null);
    if (current && current.status !== 'cancelled') {
      continue; // still exists; list/fetch raced
    }
    const [updatedRow] = await db
      .update(calendarEventSync)
      .set({
        status: 'cancelled',
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(calendarEventSync.id, row.id),
          eq(calendarEventSync.status, 'confirmed'),
        ),
      )
      .returning();
    if (!updatedRow) continue; // another worker cancelled it first
    summary.cancelled += 1;
    const pushed = await pushEventState(
      userId,
      anchorChatId,
      updatedRow,
      'cancelled',
      timeZone,
      post,
      now,
    );
    if (!pushed) summary.pushFailures += 1;
  }

  // Completion: events whose end has passed get exactly one 'completed'
  // projection push, which creates the bounded post-event follow-up window
  // in Cortex. Bounded lookback keeps ancient rows quiet.
  const pendingCompletion = await db
    .select()
    .from(calendarEventSync)
    .where(
      and(
        eq(calendarEventSync.userId, userId),
        eq(calendarEventSync.status, 'confirmed'),
        isNull(calendarEventSync.completedAt),
        lte(calendarEventSync.endAt, now),
      ),
    );
  const lookbackFloor = new Date(
    now.getTime() - COMPLETED_PUSH_LOOKBACK_HOURS * 3_600_000,
  );
  for (const row of pendingCompletion) {
    const shouldPush = Boolean(row.endAt && row.endAt >= lookbackFloor);
    const followupWindowEnd = row.endAt
      ? new Date(row.endAt.getTime() + FOLLOWUP_WINDOW_HOURS * 3_600_000)
      : null;
    await db
      .update(calendarEventSync)
      .set({ completedAt: now, followupWindowEnd, updatedAt: now })
      .where(
        and(
          eq(calendarEventSync.id, row.id),
          isNull(calendarEventSync.completedAt),
        ),
      );
    if (shouldPush) {
      const pushed = await pushEventState(
        userId,
        anchorChatId,
        row,
        'completed',
        timeZone,
        post,
        now,
      );
      if (pushed) {
        summary.completed += 1;
      } else {
        summary.pushFailures += 1;
      }
    }
  }

  return summary;
}

export type UserAnchor = {
  userId: string;
  anchorChatId: string;
  timeZone: string | null;
};

/**
 * One anchor per user: their most recently active chat (by last message,
 * falling back to chat creation) plus the stored timezone. The anchor chat is
 * only the projection coordinate for sync-derived state; Cortex continuity is
 * owner-scoped, so the state remains visible across the owner's chats.
 */
export async function getUserSyncAnchors(
  options: { limit?: number } = {},
): Promise<UserAnchor[]> {
  const limit = Math.max(
    1,
    Math.min(options.limit ?? MAX_USERS_PER_SWEEP, MAX_USERS_PER_SWEEP),
  );
  const rows = await db.execute(sql`
    WITH latest_message AS (
      SELECT "chatId", MAX("createdAt") AS "lastAt"
      FROM "Message_v2" GROUP BY "chatId"
    )
    SELECT u.id AS "userId", u.time_zone AS "timeZone", ranked.id AS "anchorChatId"
    FROM "User" u
    JOIN LATERAL (
      SELECT c.id
      FROM "Chat" c
      LEFT JOIN latest_message lm ON lm."chatId" = c.id
      WHERE c."userId" = u.id
      ORDER BY COALESCE(lm."lastAt", c."createdAt") DESC
      LIMIT 1
    ) ranked ON true
    LIMIT ${limit}
  `);
  const typedRows =
    (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>);
  return (Array.isArray(typedRows) ? typedRows : []).map((row) => ({
    userId: String(row.userId),
    anchorChatId: String(row.anchorChatId),
    timeZone: row.timeZone ? String(row.timeZone) : null,
  }));
}

/**
 * Full sweep: for every user with an active Google connection, run the
 * calendar reconciliation. Anchor chat resolution is delegated to the caller
 * (the cron route), which computes each user's most recently active chat.
 */
export async function syncAllCalendars(
  anchors: UserAnchor[],
  deps: SyncDeps = {},
) {
  const results: Array<
    { userId: string } & Awaited<ReturnType<typeof syncCalendarForUser>>
  > = [];
  for (const anchor of anchors.slice(0, MAX_USERS_PER_SWEEP)) {
    try {
      const status = await getGoogleConnectionStatus(anchor.userId);
      const scopes = status.granted_scopes ?? [];
      if (
        !status.connected ||
        !scopes.some((scope) => scope.includes('/auth/calendar'))
      ) {
        continue;
      }
    } catch {
      continue; // workspace-connect unavailable or user not connected
    }
    const summary = await syncCalendarForUser(
      anchor.userId,
      anchor.anchorChatId,
      {
        ...deps,
        timeZone: anchor.timeZone,
      },
    );
    results.push({ userId: anchor.userId, ...summary });
  }
  return results;
}

/**
 * Initiative-side consumption: mark a bounded post-event follow-up consumed
 * so the scan never re-offers it. The initiative pipeline remains the only
 * delivery path; this is bookkeeping, not delivery.
 */
export async function consumeCalendarFollowup(
  userId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db
    .update(calendarEventSync)
    .set({ followupConsumedAt: now, updatedAt: now })
    .where(
      and(
        eq(calendarEventSync.userId, userId),
        eq(calendarEventSync.eventId, eventId),
        isNull(calendarEventSync.followupConsumedAt),
      ),
    )
    .returning({ id: calendarEventSync.id });
  return result.length > 0;
}
