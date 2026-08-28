/**
 * Checkpoint 6 — realistic messy scenarios through the actual production path.
 *
 * One user across two chats, chained like a real conversation, driven through
 * commitTurnSemantics (real roster loading + deterministic gates + domain
 * mutations + TurnAction ledger) and the real initiative scan / outbox. The
 * only injected part is the model output (the interpreter's documented seam).
 *
 * Run: pnpm exec tsx scripts/sophie-tasks-e2e-test.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.SYNAPSE_CORTEX_URL = 'https://cortex.e2e.invalid';
process.env.SYNAPSE_CORTEX_ENABLED = 'true';

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  chat as chatTable,
  cortexOutbox as cortexOutboxTable,
  message as messageTable,
  turnAction as turnActionTable,
  user as userTable,
} from '@/lib/db/schema';
import { createTask, getTaskWithReminders, listTasksForUser } from '@/lib/tasks/domain';
import { commitTurnSemantics } from '@/lib/ai/interaction/commit-turn';
import type { InterpreterAction } from '@/lib/ai/interaction/interpreter';
import { serverInitiativeScanCandidates } from '@/lib/ai/relationship/store';
import { enqueueCortexTurn } from '@/lib/cortex/outbox';

let failures = 0;
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
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
function generateReturning(actions: InterpreterAction[]) {
  return async () => ({ actions, clarifications: [] });
}
function localTimeString(now: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(now);
}

type TurnOptions = {
  userId: string;
  chatId: string;
  messageId: string;
  userText: string;
  assistantText: string;
  recentContext: string;
  actions: InterpreterAction[];
};

async function turn(options: TurnOptions) {
  // The real flow persists the user message BEFORE the after() hook runs the
  // fast path — provenance (sourceMessageId) links to that row.
  await db
    .insert(messageTable)
    .values({
      id: options.messageId,
      chatId: options.chatId,
      role: 'user',
      parts: [{ type: 'text', text: options.userText }],
      attachments: [],
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return commitTurnSemantics({
    userId: options.userId,
    chatId: options.chatId,
    messageId: options.messageId,
    userText: options.userText,
    assistantText: options.assistantText,
    localTime: localTimeString(new Date()),
    timeZone: 'Europe/London',
    recentContext: options.recentContext,
    generate: generateReturning(options.actions),
  });
}

async function countTurnActions(messageId: string) {
  const rows = await db
    .select()
    .from(turnActionTable)
    .where(eq(turnActionTable.messageId, messageId));
  return rows.length;
}

async function main() {
  const userId = randomUUID();
  const chatA = randomUUID();
  const chatB = randomUUID();
  const now = new Date();
  await db.insert(userTable).values({ id: userId, email: `e2e-${userId}@test.local` });
  await db.insert(chatTable).values([
    { id: chatA, userId, title: 'main chat', createdAt: now },
    { id: chatB, userId, title: 'other chat', createdAt: now },
  ]);
  await db.insert(messageTable).values([
    { id: randomUUID(), chatId: chatA, role: 'assistant', parts: [{ type: 'text', text: 'Hey Zoe' }], attachments: [], createdAt: now },
    { id: randomUUID(), chatId: chatA, role: 'user', parts: [{ type: 'text', text: 'hi' }], attachments: [], createdAt: new Date(now.getTime() + 60_000) },
  ]);
  const outboxIds: string[] = [];

  try {
    // ── Turn 1: explicit reminder → one canonical Task + one reminder window ──
    const m1 = randomUUID();
    const dueMum = new Date(Date.now() + 18 * HOUR);
    await turn({
      userId, chatId: chatA, messageId: m1,
      userText: 'remind me tomorrow morning to call Mum',
      assistantText: "I'll remind you to call Mum tomorrow morning.",
      recentContext: 'user: hi\nassistant: Hey Zoe',
      actions: [{
        action: 'create_task', evidence_class: 'explicit_command',
        evidence_verbatim: 'remind me tomorrow morning to call Mum',
        target_task_id: null, title: 'Call Mum', notes: null,
        due_iso: dueMum.toISOString(),
        reminder_windows: [{ label: 'morning', start_iso: dueMum.toISOString(), end_iso: null }],
        snooze_minutes: null,
      }],
    });
    const mum = (await listTasksForUser(userId, { status: 'pending' })).find(
      (t) => t.title === 'Call Mum',
    );
    assert(Boolean(mum), 'Turn1: explicit reminder produced one Task');
    assert(mum!.reminders.length === 1 && mum!.dueAt !== null, 'Turn1: reminder window stored');
    assert((await countTurnActions(m1)) === 1, 'Turn1: one ledger row');

    // ── Turn 2: "actually make that Friday" → same Task rescheduled, no dup ──
    const m2 = randomUUID();
    const friday = new Date(Date.now() + 7 * 24 * HOUR);
    await turn({
      userId, chatId: chatA, messageId: m2,
      userText: 'actually make that Friday instead',
      assistantText: 'Moved — calling Mum is now Friday morning.',
      recentContext: "user: remind me tomorrow morning to call Mum\nassistant: I'll remind you to call Mum tomorrow morning.",
      actions: [{
        action: 'reschedule_task', evidence_class: 'explicit_modification',
        evidence_verbatim: 'make that Friday',
        target_task_id: mum!.id, title: null, notes: null,
        due_iso: friday.toISOString(), reminder_windows: [], snooze_minutes: null,
      }],
    });
    const mumAfter = await getTaskWithReminders(userId, mum!.id);
    const pending = await listTasksForUser(userId, { status: 'pending' });
    assert(mumAfter?.dueAt?.getTime() === friday.getTime(), 'Turn2: due moved to Friday on the SAME task');
    assert(pending.length === 1, 'Turn2: no duplicate was created');

    // ── Turn 3: cross-chat completion ("I spoke to her, done") from chat B ──
    const m3 = randomUUID();
    await turn({
      userId, chatId: chatB, messageId: m3,
      userText: 'I spoke to her, done',
      assistantText: 'Nice — marking that done.',
      recentContext: "user: actually make that Friday\nassistant: Moved — calling Mum is now Friday.",
      actions: [{
        action: 'complete_task', evidence_class: 'explicit_resolution',
        evidence_verbatim: 'I spoke to her, done',
        target_task_id: mum!.id, title: null, notes: null,
        due_iso: null, reminder_windows: [], snooze_minutes: null,
      }],
    });
    const mumDone = await getTaskWithReminders(userId, mum!.id);
    assert(mumDone?.status === 'completed', 'Turn3: completed cross-chat from chat B');

    // ── Turn 4: Sophie-suggested task + "yeah add that" → sophie_accepted ──
    const m4 = randomUUID();
    await turn({
      userId, chatId: chatA, messageId: m4,
      userText: 'yeah add that',
      assistantText: 'I can add a weekly grocery run if you want!',
      recentContext: 'assistant: Want me to add a weekly grocery run?\nuser: yeah add that',
      actions: [{
        action: 'create_task', evidence_class: 'explicit_acceptance',
        evidence_verbatim: 'yeah add that',
        target_task_id: null, title: 'Weekly grocery run', notes: null,
        due_iso: null, reminder_windows: [], snooze_minutes: null,
      }],
    });
    const grocery = (await listTasksForUser(userId, { status: 'pending' })).find(
      (t) => t.title === 'Weekly grocery run',
    );
    assert(Boolean(grocery), 'Turn4: accepted suggestion created a Task');
    assert(grocery!.source === 'sophie_accepted', 'Turn4: accepted suggestion is sourced sophie_accepted');

    // ── Turn 5: implicit passport — interpreter refuses, slow path still sees ──
    const m5 = randomUUID();
    const refused = await turn({
      userId, chatId: chatA, messageId: m5,
      userText: 'shit, I need to renew my passport someday',
      assistantText: 'Sounds worth sorting soon — happy to help when you want.',
      recentContext: "user: yeah add that\nassistant: I've added a weekly grocery run.",
      actions: [],
    });
    assert(refused.committed.length === 0, 'Turn5: implicit passport refused by the fast path');
    const passportTasks = (await listTasksForUser(userId)).filter((t) =>
      t.title.toLowerCase().includes('passport'),
    );
    assert(passportTasks.length === 0, 'Turn5: no canonical Task from an implicit remark');
    // The same turn still flows to the slow Cortex pass (outbox enqueue).
    const enqueued = await enqueueCortexTurn({
      userId, chatId: chatA, honchoMessageId: `honcho-${m5}`,
      appMessageId: m5, text: 'shit, I need to renew my passport someday',
    });
    outboxIds.push(`honcho-${m5}`);
    assert(enqueued.queued === true, 'Turn5: turn still flows to the slow Cortex pass');

    // ── Turn 6: pronominal cancel grounded by recent context ──
    const m6 = randomUUID();
    await turn({
      userId, chatId: chatA, messageId: m6,
      userText: 'actually cancel that one too',
      assistantText: 'Dropping the grocery run.',
      recentContext: 'assistant: Want me to add a weekly grocery run?\nuser: yeah add that\nassistant: I’ve added a weekly grocery run.',
      actions: [{
        action: 'cancel_task', evidence_class: 'explicit_modification',
        evidence_verbatim: 'cancel that one too',
        target_task_id: grocery!.id, title: null, notes: null,
        due_iso: null, reminder_windows: [], snooze_minutes: null,
      }],
    });
    const groceryAfter = await getTaskWithReminders(userId, grocery!.id);
    assert(groceryAfter?.status === 'cancelled', 'Turn6: pronominal cancel resolved to the right task');

    // ── Turn 7: deleting the birth chat leaves the Task intact (chatless) ──
    const gardener = await createTask({ userId, chatId: chatB, title: 'Pay the gardener', dueAt: hoursFromNow(120) });
    await db.delete(messageTable).where(eq(messageTable.chatId, chatB));
    await db.delete(chatTable).where(eq(chatTable.id, chatB));
    const gardenerAfter = await getTaskWithReminders(userId, gardener.id);
    assert(Boolean(gardenerAfter), 'Turn7: task survives birth-chat deletion');
    assert(gardenerAfter!.chatId === null, 'Turn7: origin chat provenance set to null (SET NULL)');
    assert(
      (await listTasksForUser(userId)).some((t) => t.id === gardener.id),
      'Turn7: orphaned-forecast task stays user-visible',
    );

    // ── Turn 8: active-chat reminder delivery for a chatless task ──
    await db.insert(messageTable).values({
      id: randomUUID(), chatId: chatA, role: 'assistant',
      parts: [{ type: 'text', text: 'All caught up for now.' }],
      attachments: [], createdAt: new Date(Date.now() + 2_000),
    });
    const chatlessReminder = await createTask({
      userId, chatId: null, title: 'Renew passport', dueAt: hoursFromNow(200),
      reminders: [{ startAt: new Date(Date.now() - 60_000), endAt: null, label: 'due now' }],
    });
    const scanRows: Array<Record<string, any>> = await serverInitiativeScanCandidates(100, new Date());
    const reminderCandidates = scanRows.filter(
      (c) => String(c.userId) === userId && c.trigger === 'task_reminder' && String(c.context?.taskId) === chatlessReminder.id,
    );
    assert(reminderCandidates.length === 1, 'Turn8: chatless reminder produced an initiative candidate');
    assert(
      typeof reminderCandidates[0]?.chatId === 'string' && String(reminderCandidates[0].chatId) === chatA,
      'Turn8: candidate anchored to the user’s current active chat (chatA), not the deleted chat',
    );
    const [anchored] = await db
      .select()
      .from(chatTable)
      .where(eq(chatTable.id, reminderCandidates[0]?.chatId));
    assert(Boolean(anchored) && anchored.userId === userId, 'Turn8: delivery chat belongs to the user');

    // ── Turn 9: retry of a committed create never duplicates Task/TurnAction ──
    // A retry re-processes the SAME app message (same message id), so the
    // create's fast candidate key re-resolves to the original Task and the
    // ledger pre-check suppresses a re-commit.
    const retryActions: InterpreterAction[] = [{
      action: 'create_task', evidence_class: 'explicit_command',
      evidence_verbatim: 'remind me tomorrow morning to call Mum',
      target_task_id: null, title: 'Call Mum', notes: null,
      due_iso: dueMum.toISOString(),
      reminder_windows: [{ label: 'morning', start_iso: dueMum.toISOString(), end_iso: null }],
      snooze_minutes: null,
    }];
    await turn({
      userId, chatId: chatA, messageId: m1,
      userText: 'remind me tomorrow morning to call Mum',
      assistantText: "I'll remind you.",
      recentContext: '',
      actions: retryActions,
    });
    const calls = (await listTasksForUser(userId)).filter((t) => t.title === 'Call Mum');
    assert(calls.length === 1, 'Turn9: retried create produced exactly one canonical Task');
    assert((await countTurnActions(m1)) === 1, 'Turn9: retried create recorded exactly one ledger row');
  } finally {
    for (const honchoId of outboxIds) {
      await db.delete(cortexOutboxTable).where(eq(cortexOutboxTable.honchoMessageId, honchoId)).catch(() => undefined);
    }
    await db.delete(messageTable).where(eq(messageTable.chatId, chatA)).catch(() => undefined);
    await db.delete(chatTable).where(eq(chatTable.id, chatA)).catch(() => undefined);
    await db.delete(userTable).where(eq(userTable.id, userId)).catch(() => undefined);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall Sophie E2E messy-scenario assertions passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});