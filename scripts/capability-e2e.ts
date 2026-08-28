/**
 * End-to-end capability scenario: personal commitments + calendar awareness.
 *
 * Chain under test (live local Cortex + dev Postgres):
 *  1. user creates an explicit reminder/task            -> canonical Task row
 *  2. persists canonically (app Postgres)               -> assert row + reminders
 *  3. Cortex receives/derives lifecycle state           -> source-linked expectation
 *  4. appears in the continuity/attention packet at
 *     the right time (upcoming -> reminder window)      -> packet assertions
 *  5. the existing initiative path can consume it       -> scan candidate + claim + dedupe
 *
 * Calendar scenario:
 *  1. provider event exists                             -> injected provider fetch
 *  2. ingested/referenced (source-linked)               -> Cortex expectation
 *  3. timing changes                                    -> revision bump, new timing in packet
 *  4. event finishes                                    -> bounded callback attention in Cortex
 *  5. a bounded follow-up opportunity becomes available -> initiative scan candidate
 *  6. cancellation correctly invalidates stale attention-> callback gone from packet
 *
 * Run (with local Cortex on :8010):
 *   SYNAPSE_CORTEX_URL=http://127.0.0.1:8010 pnpm exec tsx scripts/capability-e2e.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  chat as chatTable,
  message as messageTable,
  user as userTable,
} from '@/lib/db/schema';
import {
  consumeCalendarFollowup,
  syncCalendarForUser,
} from '@/lib/calendar/sync';
import {
  claimInitiative,
  serverInitiativeScanCandidates,
} from '@/lib/ai/relationship/store';
import {
  completeTask,
  createTask,
  markTaskReminderFired,
} from '@/lib/tasks/domain';

const CORTEX_URL = process.env.SYNAPSE_CORTEX_URL?.replace(/\/$/u, '');
if (!CORTEX_URL) {
  console.error('SYNAPSE_CORTEX_URL must point at the local Cortex instance');
  process.exit(1);
}

let failures = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok: ${message}`);
  }
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

async function packet(
  workspaceId: string,
  sessionId: string,
  now: Date,
  peerId: string,
) {
  const query = new URLSearchParams({
    workspace_id: workspaceId,
    session_id: sessionId,
    peer_id: peerId,
    now: now.toISOString(),
    timezone: 'Europe/London',
  });
  const response = await fetch(
    `${CORTEX_URL}/v1/cortex/attention-packet?${query}`,
  );
  if (!response.ok) {
    throw new Error(`packet fetch failed: ${response.status}`);
  }
  return (await response.json()) as Record<string, any>;
}

async function main() {
  console.log('capability-e2e');
  const userId = randomUUID();
  const chatId = randomUUID();
  const workspaceId = `llm-test-agent`;
  const sessionId = `chat_${chatId}`;
  const peerId = `user_${userId}`;
  const now = new Date();

  await db
    .insert(userTable)
    .values({ id: userId, email: `capability-e2e-${userId}@test.local` });
  await db
    .insert(chatTable)
    .values({ id: chatId, userId, title: 'e2e', createdAt: now });
  await db.insert(messageTable).values({
    id: randomUUID(),
    chatId,
    role: 'user',
    parts: [
      { type: 'text', text: 'remind me to water the plants on friday morning' },
    ],
    attachments: [],
    createdAt: now,
  });
  await db.insert(messageTable).values({
    id: randomUUID(),
    chatId,
    role: 'assistant',
    parts: [{ type: 'text', text: 'Absolutely — I have set a reminder.' }],
    attachments: [],
    createdAt: new Date(now.getTime() + MINUTE),
  });

  try {
    // ── Scenario 1: explicit task ──
    console.log('\n[scenario] personal commitment');

    const task = await createTask({
      userId,
      chatId,
      title: 'Water the plants',
      notes: 'friday morning',
      dueAt: new Date(now.getTime() + 72 * HOUR),
      reminders: [
        {
          startAt: new Date(now.getTime() + 71 * HOUR),
          endAt: new Date(now.getTime() + 74 * HOUR),
          label: 'friday morning',
        },
      ],
      source: 'conversation',
    });
    assert(
      Boolean(task.id) && task.cortexDirty === false,
      'task persisted canonically and projected to Cortex (dirty flag cleared)',
    );

    const pFar = await packet(workspaceId, sessionId, now, peerId);
    const farItem = (pFar.commitments as any[]).find(
      (item) => item.source_object_id === task.id,
    );
    assert(
      farItem && farItem.state === 'upcoming',
      'packet shows the commitment as upcoming before the reminder window',
    );

    const windowNow = new Date(now.getTime() + 71.5 * HOUR);
    const pWindow = await packet(workspaceId, sessionId, windowNow, peerId);
    const windowItem = (pWindow.commitments as any[]).find(
      (item) => item.source_object_id === task.id,
    );
    assert(
      windowItem && windowItem.state === 'reminder_due',
      'at the explicit window the commitment is reminder_due',
    );
    assert(
      (pWindow.continuity_context.continuity as any[]).some(
        (item) => item.type === 'task_due' && item.topic === 'Water the plants',
      ),
      'continuity context carries the reminder',
    );

    // ── Existing initiative path consumes the reminder ──
    const scanAt = new Date(windowNow.getTime() + 2 * MINUTE);
    const candidates = await serverInitiativeScanCandidates(20, scanAt);
    const reminderCandidate = candidates.find(
      (candidate) =>
        candidate.trigger === 'task_reminder' &&
        (candidate.context as any)?.taskId === task.id,
    );
    assert(
      Boolean(reminderCandidate),
      'initiative scan surfaces the due task reminder',
    );
    const reminderId = (reminderCandidate?.context as any)
      ?.reminderId as string;
    assert(
      await markTaskReminderFired(reminderId, scanAt),
      'reminder wake-up claimed once',
    );
    const claim = await claimInitiative({
      userId,
      chatId,
      trigger: 'task_reminder',
      anchorMessageId: String(reminderCandidate?.anchorMessageId ?? ''),
      evaluationNow: scanAt,
      dedupeScopeKey: `task_reminder:${reminderId}`,
    });
    assert(claim.ok, 'existing initiative pipeline claims the reminder');
    const duplicateClaim = await claimInitiative({
      userId,
      chatId,
      trigger: 'task_reminder',
      anchorMessageId: String(reminderCandidate?.anchorMessageId ?? ''),
      evaluationNow: scanAt,
      dedupeScopeKey: `task_reminder:${reminderId}`,
    });
    assert(
      !duplicateClaim.ok,
      'duplicate claim is deduped by the existing pipeline',
    );

    // Completion resolves lifecycle and stops the scan offering it.
    await completeTask(userId, task.id);
    const pCompleted = await packet(workspaceId, sessionId, windowNow, peerId);
    assert(
      !(pCompleted.commitments as any[]).some(
        (item) => item.source_object_id === task.id,
      ),
      'completed task leaves the live commitments section',
    );
    assert(
      (pCompleted.recent_resolutions as any[]).some(
        (item) => item.title === 'Water the plants',
      ),
      'completion surfaces as a recent resolution',
    );
    const candidatesAfter = await serverInitiativeScanCandidates(20, scanAt);
    assert(
      !candidatesAfter.some(
        (candidate) =>
          candidate.trigger === 'task_reminder' &&
          (candidate.context as any)?.taskId === task.id,
      ),
      'scan no longer offers the reminder after completion',
    );

    // ── Scenario 2: calendar awareness ──
    console.log('\n[scenario] calendar event');

    const eventStart = new Date(now.getTime() + 30 * MINUTE);
    const eventEnd = new Date(now.getTime() + 75 * MINUTE);
    const movedStart = new Date(now.getTime() + 90 * MINUTE);
    const movedEnd = new Date(now.getTime() + 135 * MINUTE);
    const provider = { events: [] as any[] };
    const fetchEvents = async () => provider.events;
    const getEvent = async () => null;
    const syncDeps = {
      timeZone: 'Europe/London',
      fetchEvents,
      getEvent,
    };

    // 1-2. Provider event exists -> ingested/referenced.
    provider.events = [
      {
        eventId: 'evt_e2e_1',
        calendarId: 'primary',
        status: 'confirmed',
        title: 'Design review',
        start: eventStart.toISOString(),
        end: eventEnd.toISOString(),
        startDate: null,
        endDate: null,
        allDay: false,
      },
    ];
    const firstSync = await syncCalendarForUser(userId, chatId, {
      ...syncDeps,
      now,
    });
    assert(
      firstSync.created === 1,
      'provider event discovered and cached (Google stays canonical)',
    );

    const pEvent = await packet(workspaceId, sessionId, now, peerId);
    const eventItem = (pEvent.events as any[]).find(
      (item) => item.source_object_id === 'evt_e2e_1',
    );
    assert(
      eventItem && eventItem.state === 'imminent',
      'event attention imminent in packet',
    );

    // 3. Timing changes -> Cortex reflects the new timing.
    provider.events = [
      {
        ...provider.events[0],
        start: movedStart.toISOString(),
        end: movedEnd.toISOString(),
      },
    ];
    const secondSync = await syncCalendarForUser(userId, chatId, {
      ...syncDeps,
      now,
    });
    assert(secondSync.updated === 1, 'reschedule detected via reconciliation');
    const pMoved = await packet(workspaceId, sessionId, now, peerId);
    const movedItem = (pMoved.events as any[]).find(
      (item) => item.source_object_id === 'evt_e2e_1',
    );
    assert(
      movedItem &&
        // Cortex emits naive-UTC ISO; compare on the UTC wall clock.
        String(movedItem.start).slice(0, 19) ===
          movedStart.toISOString().slice(0, 19) &&
        movedItem.source_version === 2,
      `packet reflects the new timing (version 2, got ${movedItem?.start} v${movedItem?.source_version})`,
    );

    // 4. Event finishes -> bounded follow-up opportunity in Cortex.
    const afterEnd = new Date(movedEnd.getTime() + 5 * MINUTE);
    const thirdSync = await syncCalendarForUser(userId, chatId, {
      ...syncDeps,
      now: afterEnd,
    });
    assert(
      thirdSync.completed === 1,
      'event completion pushed once with a bounded follow-up window',
    );
    const pAfter = await packet(workspaceId, sessionId, afterEnd, peerId);
    const callback = (pAfter.sophie_attention as any[]).find(
      (item) => item.source_object_id === 'evt_e2e_1',
    );
    assert(
      callback && callback.type === 'callback',
      'bounded post-event callback attention exists',
    );
    assert(
      (pAfter.continuity_context.continuity as any[]).some(
        (item) => item.type === 'event_followup',
      ),
      'continuity context carries the follow-up opportunity',
    );

    // 5. Bounded follow-up opportunity is offered to the initiative path once.
    const followupCandidates = await serverInitiativeScanCandidates(
      20,
      afterEnd,
    );
    const followupCandidate = followupCandidates.find(
      (candidate) =>
        candidate.trigger === 'calendar_followup' &&
        (candidate.context as any)?.eventId === 'evt_e2e_1',
    );
    assert(
      Boolean(followupCandidate),
      'initiative scan offers the bounded follow-up',
    );
    assert(
      await consumeCalendarFollowup(userId, 'evt_e2e_1', afterEnd),
      'follow-up consumed exactly once',
    );
    const followupCandidatesAgain = await serverInitiativeScanCandidates(
      20,
      afterEnd,
    );
    assert(
      !followupCandidatesAgain.some(
        (candidate) =>
          candidate.trigger === 'calendar_followup' &&
          (candidate.context as any)?.eventId === 'evt_e2e_1',
      ),
      'consumed follow-up is never re-offered',
    );

    // 6. Cancellation invalidates stale attention.
    provider.events = [];
    const cancelSync = await syncCalendarForUser(userId, chatId, {
      ...syncDeps,
      now: afterEnd,
    });
    assert(
      cancelSync.cancelled === 1,
      'cancellation detected via reconciliation',
    );
    const pCancelled = await packet(workspaceId, sessionId, afterEnd, peerId);
    assert(
      !(pCancelled.sophie_attention as any[]).some(
        (item) => item.source_object_id === 'evt_e2e_1',
      ),
      'stale callback attention removed from the packet',
    );
    assert(
      !(pCancelled.events as any[]).some(
        (item) => item.source_object_id === 'evt_e2e_1',
      ),
      'no stale event state remains',
    );
  } finally {
    await db.delete(messageTable).where(eq(messageTable.chatId, chatId));
    await db
      .delete(chatTable)
      .where(eq(chatTable.id, chatId))
      .catch(() => undefined);
    await db
      .delete(userTable)
      .where(eq(userTable.id, userId))
      .catch(() => undefined);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nend-to-end capability scenario passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
