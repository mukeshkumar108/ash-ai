/**
 * Checkpoint 2 — fast-path semantic ownership acceptance harness.
 *
 * Exercises the REAL production path (commitTurnSemantics → runCommitmentInterpreter
 * [generate seam] → debug deterministic gates → domain mutations → TurnAction ledger)
 * against the local dev database. The only injected part is the model output,
 * which is the documented, deliberately testable seam of the interpreter.
 *
 * Run: pnpm exec tsx scripts/tasks-fast-path-test.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  chat as chatTable,
  message as messageTable,
  turnAction as turnActionTable,
  user as userTable,
} from '@/lib/db/schema';
import { createTask, getTaskWithReminders, listTasksForUser } from '@/lib/tasks/domain';
import { commitTurnSemantics } from '@/lib/ai/interaction/commit-turn';
import type { InterpreterAction } from '@/lib/ai/interaction/interpreter';

process.env.SYNAPSE_CORTEX_ENABLED = 'false';

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
function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * HOUR);
}

type Interpretation = { actions: InterpreterAction[]; clarifications: unknown[] };

function generateReturning(interpretation: Interpretation) {
  return async () => interpretation;
}

async function cleanup(userId: string, chatIds: string[]) {
  for (const chatId of chatIds) {
    await db.delete(messageTable).where(eq(messageTable.chatId, chatId));
  }
  for (const chatId of chatIds) {
    await db.delete(chatTable).where(eq(chatTable.id, chatId));
  }
  await db.delete(userTable).where(eq(userTable.id, userId));
}

async function countTurnActions(messageId: string, action?: string) {
  const rows = await db
    .select()
    .from(turnActionTable)
    .where(
      and(
        eq(turnActionTable.messageId, messageId),
        action ? eq(turnActionTable.action, action) : undefined,
      ),
    );
  return rows.length;
}

function localTimeString(now: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);
}

async function main() {
  // 1. "remind me tomorrow to call Mum" -> exactly one canonical Task/reminder
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'remind me tomorrow to call Mum' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const due = hoursFromNow(26);
      const meeting = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'remind me tomorrow to call Mum',
        assistantText: "Of course — I'll remind you to call Mum tomorrow.",
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        generate: generateReturning({
          actions: [{
            action: 'create_task',
            evidence_class: 'explicit_command',
            evidence_verbatim: 'remind me tomorrow to call Mum',
            target_task_id: null,
            title: 'Call Mum',
            notes: null,
            due_iso: due.toISOString(),
            reminder_windows: [{ label: 'the day before', start_iso: due.toISOString(), end_iso: null }],
            snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const pending = await listTasksForUser(userId, { status: 'pending' });
      assert(meeting.committed.length === 1, 'one create committed');
      assert(pending.length === 1 && pending[0].title === 'Call Mum', 'exactly one canonical Task/reminder');
      assert(pending[0].source === 'conversation', 'create source is conversation');
      assert(pending[0].sourceMessageId === messageId, 'app message provenance stored');
      assert(pending[0].reminders.length === 1, 'reminder window persisted');
      assert((await countTurnActions(messageId, 'created')) === 1, 'one created ledger row');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 2. "actually make that Friday" -> same Task rescheduled, not a duplicate
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'actually make that Friday' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const mum = await createTask({ userId, chatId, title: 'Call Mum', dueAt: hoursFromNow(30) });
      await createTask({ userId, chatId, title: 'Send the report', dueAt: hoursFromNow(50) });
      const friday = new Date(Date.now() + 7 * 24 * HOUR);
      const result = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'actually make that Friday',
        assistantText: 'Moved it — calling Mum is now Friday.',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        recentContext: "user: remind me tomorrow to call Mum\nassistant: I'll remind you to call Mum tomorrow.",
        generate: generateReturning({
          actions: [{
            action: 'reschedule_task',
            evidence_class: 'explicit_modification',
            evidence_verbatim: 'actually make that Friday',
            target_task_id: mum.id,
            title: null,
            notes: null,
            due_iso: friday.toISOString(),
            reminder_windows: [],
            snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const refreshed = await getTaskWithReminders(userId, mum.id);
      const all = await listTasksForUser(userId, { status: 'pending' });
      assert(result.committed.length === 1 && result.committed[0].taskId === mum.id, 'reschedule committed on the same task');
      assert(all.length === 2, 'still two tasks (no duplicate created)');
      assert(refreshed?.dueAt?.getTime() === friday.getTime(), 'due moved to Friday on the SAME task');
      assert((await countTurnActions(messageId, 'updated')) === 1, 'one updated ledger row');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 3. "I did it" unambiguous (single roster) -> correct task completed
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'I did it' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const task = await createTask({ userId, chatId, title: 'File expenses', dueAt: hoursFromNow(10) });
      const result = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'I did it',
        assistantText: 'Nice — marking that done.',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        generate: generateReturning({
          actions: [{
            action: 'complete_task',
            evidence_class: 'explicit_resolution',
            evidence_verbatim: 'I did it',
            target_task_id: task.id,
            title: null, notes: null, due_iso: null,
            reminder_windows: [], snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const refreshed = await getTaskWithReminders(userId, task.id);
      assert(result.committed.length === 1, 'complete committed (roster was unique)');
      assert(refreshed?.status === 'completed', 'correct task completed when unambiguous');
      assert((await countTurnActions(messageId, 'completed')) === 1, 'one completed ledger row');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 4. "I did it" with two equally plausible tasks -> no mutation + clarification
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'I did it' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const dentist = await createTask({ userId, chatId, title: 'Call the dentist', dueAt: hoursFromNow(10) });
      await createTask({ userId, chatId, title: 'Pay the rent', dueAt: hoursFromNow(20) });
      const result = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'I did it',
        assistantText: 'Which of these did you mean?',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        recentContext: '',
        generate: generateReturning({
          actions: [{
            action: 'complete_task',
            evidence_class: 'explicit_resolution',
            evidence_verbatim: 'I did it',
            target_task_id: dentist.id,
            title: null, notes: null, due_iso: null,
            reminder_windows: [], snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const all = await listTasksForUser(userId, { status: 'pending' });
      assert(result.committed.length === 0, 'no mutation on ambiguous reference');
      assert(result.clarifications.some((c) => c.intent === 'ambiguous_target'), 'narrow clarification surfaced');
      assert(all.length === 2 && all.every((t) => t.status === 'pending'), 'no task was completed');
      assert((await countTurnActions(messageId, 'completed')) === 0, 'no ledger row for the rejected ambiguity');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 5. "cancel that" resolved through recent context
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'cancel that' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const dentist = await createTask({ userId, chatId, title: 'Book the dentist', dueAt: hoursFromNow(40) });
      await createTask({ userId, chatId, title: 'Buy a gift', dueAt: hoursFromNow(30) });
      const result = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'cancel that',
        assistantText: 'I’ll drop the dentist booking reminder.',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        recentContext: "user: book the dentist for next week\nassistant: I'll remind you to book the dentist.",
        generate: generateReturning({
          actions: [{
            action: 'cancel_task',
            evidence_class: 'explicit_modification',
            evidence_verbatim: 'cancel that',
            target_task_id: dentist.id,
            title: null, notes: null, due_iso: null,
            reminder_windows: [], snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const refreshed = await getTaskWithReminders(userId, dentist.id);
      assert(result.committed.length === 1 && result.committed[0].taskId === dentist.id, 'cancel committed on context-grounded target');
      assert(refreshed?.status === 'cancelled', 'correct task cancelled');
      assert((await countTurnActions(messageId, 'cancelled')) === 1, 'one cancelled ledger row');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 6. "remind me tomorrow to call Mum and Friday to send the form" -> two actions, no dupes
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'remind me tomorrow to call Mum and Friday to send the form' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const mumDue = hoursFromNow(24);
      const formDue = hoursFromNow(72);
      const result = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'remind me tomorrow to call Mum and Friday to send the form',
        assistantText: 'Two reminders set!',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        generate: generateReturning({
          actions: [
            {
              action: 'create_task',
              evidence_class: 'explicit_command',
              evidence_verbatim: 'remind me tomorrow to call Mum',
              target_task_id: null,
              title: 'Call Mum', notes: null,
              due_iso: mumDue.toISOString(),
              reminder_windows: [], snooze_minutes: null,
            },
            {
              action: 'create_task',
              evidence_class: 'explicit_command',
              evidence_verbatim: 'Friday to send the form',
              target_task_id: null,
              title: 'Send the form', notes: null,
              due_iso: formDue.toISOString(),
              reminder_windows: [], snooze_minutes: null,
            },
          ],
          clarifications: [],
        }),
      });
      const all = await listTasksForUser(userId, { status: 'pending' });
      assert(result.committed.length === 2, 'two actions committed');
      assert(all.length === 2, 'two canonical tasks, no duplicates');
      assert(all.some((t) => t.title === 'Call Mum') && all.some((t) => t.title === 'Send the form'), 'both titles present');
      assert((await countTurnActions(messageId, 'created')) === 2, 'two created ledger rows');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 7. cross-chat completion still works
  {
    const userId = randomUUID();
    const chatA = randomUUID();
    const chatB = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values([
      { id: chatA, userId, title: 'chat A', createdAt: new Date() },
      { id: chatB, userId, title: 'chat B', createdAt: new Date() },
    ]);
    await db.insert(messageTable).values({
      id: messageId, chatId: chatA, role: 'user',
      parts: [{ type: 'text', text: "the report's done" }],
      attachments: [], createdAt: new Date(),
    });
    try {
      // Task born in chat B; completed from chat A's fast path.
      const task = await createTask({ userId, chatId: chatB, title: 'Write the report', dueAt: hoursFromNow(20) });
const result = await commitTurnSemantics({
        userId, chatId: chatA, messageId,
        userText: "the report's done",
        assistantText: 'Done — both crossed off.',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        generate: generateReturning({
          actions: [{
            action: 'complete_task',
            evidence_class: 'explicit_resolution',
            evidence_verbatim: 'report',
            target_task_id: task.id,
            title: null, notes: null, due_iso: null,
            reminder_windows: [], snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const refreshed = await getTaskWithReminders(userId, task.id);
      assert(result.committed.length === 1, 'cross-chat complete committed');
      assert(refreshed?.status === 'completed', 'task born in another chat completed from this chat');
    } finally {
      await cleanup(userId, [chatA, chatB]);
    }
  }

  // 8. chatless/manual task remains working and completable via fast path
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'renewal done' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const manual = await createTask({ userId, chatId: null, title: 'Renew passport', dueAt: hoursFromNow(120) });
      assert(manual.chatId === null, 'manual task survives chatless (provenance null)');
      const result = await commitTurnSemantics({
        userId, chatId, messageId,
        userText: 'renewal done',
        assistantText: 'Passport renewal — done.',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
        generate: generateReturning({
          actions: [{
            action: 'complete_task',
            evidence_class: 'explicit_resolution',
            evidence_verbatim: 'renewal done',
            target_task_id: manual.id,
            title: null, notes: null, due_iso: null,
            reminder_windows: [], snooze_minutes: null,
          }],
          clarifications: [],
        }),
      });
      const refreshed = await getTaskWithReminders(userId, manual.id);
      assert(result.committed.length === 1, 'chatless manual task completed via fast path');
      assert(refreshed?.status === 'completed', 'chatless/manual task behaviour intact');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  // 9. retry of the same action does not duplicate Task/TurnAction
  {
    const userId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    await db.insert(userTable).values({ id: userId, email: `fp-${userId}@test.local` });
    await db.insert(chatTable).values({ id: chatId, userId, title: 'fp chat', createdAt: new Date() });
    await db.insert(messageTable).values({
      id: messageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'renew my passport' }],
      attachments: [], createdAt: new Date(),
    });
    try {
      const interpret = () => generateReturning({
        actions: [{
          action: 'create_task',
          evidence_class: 'explicit_command',
          evidence_verbatim: 'renew my passport',
          target_task_id: null,
          title: 'Renew passport', notes: null,
          due_iso: null,
          reminder_windows: [], snooze_minutes: null,
        }],
        clarifications: [],
      });
      const base = {
        userId, chatId, messageId,
        userText: 'renew my passport',
        assistantText: 'I’ve noted the passport renewal.',
        localTime: localTimeString(new Date()),
        timeZone: 'Europe/London',
      } as const;
      const first = await commitTurnSemantics({ ...base, generate: interpret() });
      const second = await commitTurnSemantics({ ...base, generate: interpret() });
      const all = await listTasksForUser(userId, { status: 'pending' });
      assert(first.committed.length === 1, 'first attempt committed');
      assert(second.committed.length === 0, 'retry produced no new commit');
      assert(all.length === 1 && all[0].title === 'Renew passport', 'exactly one canonical Task after retry');
      assert((await countTurnActions(messageId, 'created')) === 1, 'exactly one created ledger row after retry');
    } finally {
      await cleanup(userId, [chatId]);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall fast-path acceptance tests passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});