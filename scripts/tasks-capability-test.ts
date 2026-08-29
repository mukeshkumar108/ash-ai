/**
 * Canonical task/reminder capability integration tests.
 *
 * Exercises the app-owned Task domain end to end against the dev database:
 * creation, idempotent states, completion, cancellation, snooze, reschedule,
 * multiple reminder windows, overdue semantics, bounded reminder firing,
 * dirty-projection sweep behaviour with Cortex unreachable, and user-scoped
 * ownership. Creates a dedicated throwaway user and deletes it afterwards.
 *
 * Run: pnpm exec tsx scripts/tasks-capability-test.ts
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
import {
  cancelTask,
  completeTask,
  createTask,
  editTask,
  evaluateTaskCommitment,
  getTaskWithReminders,
  listTasksForUser,
  markTaskReminderFired,
  rescheduleTask,
  snoozeTask,
  sweepDirtyTaskProjections,
} from '@/lib/tasks/domain';
import { recordTurnAction } from '@/lib/tasks/turn-actions';
import { evaluateCommitment } from '@/lib/tasks/reminder-state';
import { serverInitiativeScanCandidates } from '@/lib/ai/relationship/store';

process.env.SYNAPSE_CORTEX_ENABLED = 'false'; // push path must fail open and stay dirty

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

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

async function main() {
  console.log('tasks-capability-test');
  const userId = randomUUID();
  const chatId = randomUUID();
  const secondChatId = randomUUID();
  const ledgerOtherUser = randomUUID();
  const reminderOtherUser = randomUUID();
  const reminderOtherChat = randomUUID();
  const now = new Date();

  await db
    .insert(userTable)
    .values({ id: userId, email: `task-capability-${userId}@test.local` });
  await db
    .insert(chatTable)
    .values({ id: chatId, userId, title: 'task test', createdAt: now });
  await db
    .insert(chatTable)
    .values({ id: secondChatId, userId, title: 'task test 2', createdAt: now });
  const [messageRow] = await db
    .insert(messageTable)
    .values({
      id: randomUUID(),
      chatId,
      role: 'user',
      parts: [{ type: 'text', text: 'remind me to call the plumber' }],
      attachments: [],
      createdAt: now,
    })
    .returning();

  try {
    // ── Pure reminder semantics ──
    const window = {
      startAt: new Date(now.getTime() - HOUR),
      endAt: new Date(now.getTime() + HOUR),
    };
    assert(
      evaluateCommitment({ dueAt: null, reminders: [window] }, now).state ===
        'reminder_due',
      'open window -> reminder_due',
    );
    assert(
      evaluateCommitment(
        { dueAt: minutesFromNow(-5), reminders: [window] },
        now,
      ).state === 'overdue',
      'past due outranks open window -> overdue',
    );
    assert(
      evaluateCommitment({ dueAt: minutesFromNow(60), reminders: [] }, now)
        .state === 'upcoming',
      'future due, no window -> upcoming',
    );
    assert(
      evaluateCommitment(
        {
          dueAt: minutesFromNow(60),
          reminders: [{ startAt: minutesFromNow(30), endAt: null }],
        },
        now,
      ).nextReminder !== null,
      'future window reported as nextReminder',
    );

    // ── Explicit creation ──
    const created = await createTask({
      userId,
      chatId,
      title: 'Call the plumber',
      notes: 'Book the morning slot',
      dueAt: new Date(now.getTime() + 48 * HOUR),
      reminders: [
        {
          startAt: new Date(now.getTime() + 24 * HOUR),
          endAt: new Date(now.getTime() + 32 * HOUR),
          label: 'the day before',
        },
        {
          startAt: new Date(now.getTime() + 47.5 * HOUR),
          endAt: null,
          label: '30 minutes before',
        },
      ],
      sourceMessageId: messageRow.id,
      source: 'conversation',
    });
    assert(Boolean(created.id), 'task created with id');
    assert(
      created.reminders.length === 2,
      'two explicit reminder windows stored',
    );
    assert(
      created.cortexVersion === 1 && created.cortexDirty,
      'new task is dirty for Cortex projection',
    );

    // Duplicate creation path: same task content re-submitted through the API
    // schema would create a second canonical task (no natural key); the
    // idempotency contract lives at the Cortex projection (version no-op) and
    // at capture time (one capture per turn).
    const reCreated = await createTask({
      userId,
      chatId,
      title: 'Call the plumber',
      dueAt: new Date(now.getTime() + 48 * HOUR),
    });
    assert(reCreated.id !== created.id, 'distinct task ids (no silent merge)');

    // ── Ownership scoping ──
    const allTasks = await listTasksForUser(userId, { status: 'pending' });
    assert(allTasks.length === 2, 'user-scoped listing returns both tasks');
    const secondChatTask = await createTask({
      userId,
      chatId: secondChatId,
      title: 'Cross-chat anchored task',
      dueAt: new Date(now.getTime() + 24 * HOUR),
    });
    assert(
      secondChatTask.chatId === secondChatId,
      'task anchored to its own chat',
    );
    assert(
      (await listTasksForUser(userId, { status: 'pending' })).some(
        (task) => task.chatId === secondChatId,
      ),
      'tasks from all owner chats are user-visible',
    );

    // ── Completion before the reminder fires ──
    const completed = await completeTask(userId, created.id);
    assert(
      completed.ok && completed.task?.status === 'completed',
      'task completed',
    );
    assert(
      completed.task?.reminders.every(
        (reminder) => reminder.status === 'cancelled',
      ),
      'scheduled reminders cancelled on completion',
    );
    assert(
      completed.task?.cortexVersion === 2,
      'completion bumps Cortex version',
    );
    const recomplete = await completeTask(userId, created.id);
    assert(
      !recomplete.ok && recomplete.reason === 'invalid_state',
      'double completion rejected',
    );

    // ── Snooze ──
    const snoozeTarget = reCreated;
    const snoozed = await snoozeTask(userId, snoozeTarget.id, {
      offsetMinutes: 60,
    });
    assert(snoozed.ok, 'snooze accepted');
    assert(
      snoozed.task?.dueAt &&
        snoozeTarget.dueAt &&
        snoozed.task.dueAt.getTime() > snoozeTarget.dueAt.getTime(),
      'snooze moves due date forward',
    );
    assert(snoozed.task?.snoozeCount === 1, 'snooze counted');
    assert(snoozed.task?.cortexVersion === 2, 'snooze bumps Cortex version');

    // ── Reschedule with replaced windows ──
    const rescheduled = await rescheduleTask(userId, snoozeTarget.id, {
      dueAt: new Date(now.getTime() + 96 * HOUR),
      reminders: [
        {
          startAt: minutesFromNow(120),
          endAt: minutesFromNow(180),
          label: 'two hours before',
        },
      ],
    });
    assert(rescheduled.ok, 'reschedule accepted');
    assert(
      rescheduled.task?.reminders.length === 1,
      'old windows superseded by the new one',
    );
    assert(
      rescheduled.task?.reminders[0].label === 'two hours before',
      'new window stored',
    );

    // ── Overdue ──
    const overdueTask = await createTask({
      userId,
      chatId,
      title: 'Overdue chore',
      dueAt: minutesFromNow(-30),
      reminders: [
        {
          startAt: minutesFromNow(-60),
          endAt: null,
          label: 'window still open',
        },
      ],
    });
    const evaluation = evaluateTaskCommitment(
      overdueTask,
      overdueTask.reminders,
      new Date(),
    );
    assert(
      evaluation.state === 'overdue',
      'past-due task evaluates overdue even with open window',
    );

    // ── Bounded reminder firing ──
    const reminderTask = await createTask({
      userId,
      chatId,
      title: 'Fires once',
      dueAt: new Date(now.getTime() + 96 * HOUR),
      reminders: [
        {
          startAt: minutesFromNow(1),
          endAt: minutesFromNow(30),
          label: 'soon',
        },
      ],
    });
    const reminderId = reminderTask.reminders[0].id;
    assert(await markTaskReminderFired(reminderId), 'first fire claimed');
    assert(
      !(await markTaskReminderFired(reminderId)),
      'reminder cannot fire twice',
    );

    // ── Cancellation ──
    const cancelled = await cancelTask(userId, reminderTask.id);
    assert(
      cancelled.ok && cancelled.task?.status === 'cancelled',
      'task cancelled',
    );
    const cancelAgain = await cancelTask(userId, reminderTask.id);
    assert(!cancelAgain.ok, 'double cancellation rejected');

    // ── Ownership enforcement ──
    const strangerId = randomUUID();
    assert(
      !(await getTaskWithReminders(strangerId, created.id)),
      'another user cannot read the task',
    );
    assert(
      !(await completeTask(strangerId, created.id)).ok,
      'another user cannot complete the task',
    );

    // ── Dirty projection sweep with Cortex unreachable: durable, fail-open ──
    const sweep = await sweepDirtyTaskProjections({ limit: 100 });
    assert(
      sweep.processed >= 4,
      `sweep picked up dirty projections (${sweep.processed})`,
    );
    assert(sweep.pushed === 0, 'pushes fail open while Cortex is unreachable');
    const stillDirty = await listTasksForUser(userId);
    assert(
      stillDirty.every((task) => task.cortexDirty),
      'rows remain dirty and will be re-pushed later (never lost)',
    );

    // ── Restart persistence: fresh reads see identical canonical state ──
    const persisted = await getTaskWithReminders(userId, snoozeTarget.id);
    assert(
      persisted?.status === 'pending' &&
        persisted.dueAt?.getTime() === rescheduled.task?.dueAt?.getTime() &&
        persisted.cortexVersion === rescheduled.task?.cortexVersion,
      'canonical state (latest mutation) persists across "restart" (fresh connection reads)',
    );

    // ── TurnAction ledger NULL-arity idempotency (DB-enforced, Fix 2) ──
    await db.insert(userTable).values({
      id: ledgerOtherUser,
      email: `ledger-other-${ledgerOtherUser}@test.local`,
    });
    const triggerMessageId = randomUUID();
    const anonymousCreate1 = await recordTurnAction({
      userId,
      messageId: triggerMessageId,
      taskId: null,
      action: 'created',
    });
    const anonymousCreate2 = await recordTurnAction({
      userId,
      messageId: triggerMessageId,
      taskId: null,
      action: 'created',
    });
    const anonymousRows = await db
      .select()
      .from(turnActionTable)
      .where(
        and(
          eq(turnActionTable.userId, userId),
          eq(turnActionTable.messageId, triggerMessageId),
          eq(turnActionTable.action, 'created'),
        ),
      );
    assert(
      Boolean(anonymousCreate1?.id),
      'anonymous create ledger row inserted',
    );
    assert(
      anonymousCreate2 === null,
      'duplicate anonymous create (NULL taskId) is deduped by the DB',
    );
    assert(
      anonymousRows.length === 1,
      'exactly one created ledger row survives for the same user/message/action with NULL taskId',
    );
    const distinctActionRow = await recordTurnAction({
      userId,
      messageId: triggerMessageId,
      taskId: null,
      action: 'completed',
    });
    assert(
      Boolean(distinctActionRow?.id),
      'a distinct action in the same message still records',
    );
    const otherUserCreate = await recordTurnAction({
      userId: ledgerOtherUser,
      messageId: triggerMessageId,
      taskId: null,
      action: 'created',
    });
    assert(
      Boolean(otherUserCreate?.id),
      'different users never collide on the same message/action',
    );
    const ledgerTask = await createTask({
      userId,
      chatId,
      title: 'Ledger manual action target',
    });
    const messageLess1 = await recordTurnAction({
      userId,
      taskId: ledgerTask.id,
      action: 'updated',
    });
    const messageLess2 = await recordTurnAction({
      userId,
      taskId: ledgerTask.id,
      action: 'updated',
    });
    assert(
      Boolean(messageLess1?.id),
      'message-less manual (UI) action records once',
    );
    assert(
      messageLess2 === null,
      'duplicate message-less manual action (NULL messageId) is deduped by the DB',
    );

    // ── Candidate materialization idempotency (Fix 3) ──
    const candidateKey = `cand_${randomUUID()}`;
    const promoted = await createTask({
      userId,
      chatId,
      title: 'Promoted task',
      materializedCandidateKey: candidateKey,
    });
    const promotedRetry = await createTask({
      userId,
      chatId: null,
      title: 'Promoted task (retry)',
      materializedCandidateKey: candidateKey,
    });
    assert(
      promotedRetry.id === promoted.id,
      're-materializing the same candidate returns the same canonical task',
    );
    const candidateOwnedTasks = (await listTasksForUser(userId)).filter(
      (task) => task.materializedCandidateKey === candidateKey,
    );
    assert(
      candidateOwnedTasks.length === 1,
      'exactly one canonical task per (user, candidate key)',
    );
    const otherOwnerPromoted = await createTask({
      userId: ledgerOtherUser,
      chatId: null,
      title: 'Their promoted task',
      materializedCandidateKey: candidateKey,
    });
    assert(
      otherOwnerPromoted.id !== promoted.id,
      'different owners never collide on the same candidate key',
    );

    // ── editTask ledger parity (Fix 4) ──
    const editTarget = await createTask({
      userId,
      chatId,
      title: 'Edit me',
    });
    const edited = await editTask(userId, editTarget.id, {
      title: 'Edited title',
    });
    assert(
      edited.ok && edited.task?.title === 'Edited title',
      'edit updates canonical title',
    );
    const editLedgerRows = await db
      .select()
      .from(turnActionTable)
      .where(
        and(
          eq(turnActionTable.userId, userId),
          eq(turnActionTable.taskId, editTarget.id),
          eq(turnActionTable.action, 'updated'),
        ),
      );
    assert(
      editLedgerRows.length >= 1,
      'edit records an updated TurnAction ledger row',
    );
    assert(
      editLedgerRows[0].messageId === null,
      'edit ledger row is message-less (manual UI provenance)',
    );

    // ── Chatless reminder delivery (Fix 1): proactive scan resolves a current chat ──
    // Give the birth chat an unambiguous most-recent message so the "current
    // best chat" resolution is deterministic for this user.
    const scanAnchorMessageId = randomUUID();
    await db.insert(messageTable).values({
      id: scanAnchorMessageId,
      chatId,
      role: 'assistant',
      parts: [{ type: 'text', text: 'latest anchor for scan' }],
      attachments: [],
      createdAt: new Date(now.getTime() + 5_000),
    });
    const chatlessReminderTask = await createTask({
      userId,
      chatId: null,
      title: 'Chatless reminder task',
      dueAt: new Date(now.getTime() + 48 * HOUR),
      reminders: [
        {
          startAt: new Date(now.getTime() - 5 * 60_000),
          endAt: null,
          label: 'due now',
        },
      ],
    });
    const scanCandidates: Array<Record<string, any>> =
      await serverInitiativeScanCandidates(100, new Date());
    const scanTaskReminders = scanCandidates.filter(
      (candidate) =>
        String(candidate.userId) === userId &&
        candidate.trigger === 'task_reminder',
    );
    const chatlessScan = scanTaskReminders.filter(
      (candidate) =>
        String(candidate.context?.taskId) === chatlessReminderTask.id,
    );
    assert(
      chatlessScan.length === 1,
      'chatless task + due reminder produced a proactive task_reminder candidate',
    );
    const chatlessChatId: unknown = chatlessScan[0]?.chatId;
    assert(
      typeof chatlessChatId === 'string' && String(chatlessChatId).length > 0,
      'chatless reminder candidate has a resolved delivery chat (not a "null" string)',
    );
    if (typeof chatlessChatId === 'string') {
      const [candidateChat] = await db
        .select()
        .from(chatTable)
        .where(eq(chatTable.id, chatlessChatId));
      assert(
        Boolean(candidateChat) && candidateChat.userId === userId,
        'resolved delivery chat belongs to the user',
      );
    }
    assert(
      !chatlessReminderTask.chatId,
      'the current-best chat is NOT persisted back onto Task (provenance stays null)',
    );

    // Anchored reminders keep birth-chat anchoring (existing behavior).
    await db.insert(userTable).values({
      id: reminderOtherUser,
      email: `reminder-own-${reminderOtherUser}@test.local`,
    });
    await db.insert(chatTable).values({
      id: reminderOtherChat,
      userId: reminderOtherUser,
      title: 'birth chat',
      createdAt: now,
    });
    await db.insert(messageTable).values({
      id: randomUUID(),
      chatId: reminderOtherChat,
      role: 'assistant',
      parts: [{ type: 'text', text: 'anchor' }],
      attachments: [],
      createdAt: now,
    });
    const anchoredReminderTask = await createTask({
      userId: reminderOtherUser,
      chatId: reminderOtherChat,
      title: 'Anchored reminder task',
      dueAt: new Date(now.getTime() + 48 * HOUR),
      reminders: [
        {
          startAt: new Date(now.getTime() - 5 * 60_000),
          endAt: null,
          label: 'due now too',
        },
      ],
    });
    const anchoredScan = (
      await serverInitiativeScanCandidates(100, new Date())
    ).filter(
      (candidate) =>
        String(candidate.userId) === reminderOtherUser &&
        candidate.trigger === 'task_reminder',
    );
    assert(
      anchoredScan.length === 1 &&
        String(anchoredScan[0].context?.taskId) === anchoredReminderTask.id,
      'anchored-task reminder still produces a candidate',
    );
    assert(
      String(anchoredScan[0].chatId) === reminderOtherChat,
      'anchored reminder still anchored to its birth chat',
    );
  } finally {
    // Cleanup ordering: the live schema's legacy FKs for Message_v2→Chat and
    // Chat→User are NO ACTION, so children first: messages → chats → users
    // (the user delete cascades Task/TaskReminder/TurnAction).
    await db.delete(messageTable).where(eq(messageTable.chatId, chatId));
    await db.delete(messageTable).where(eq(messageTable.chatId, secondChatId));
    await db
      .delete(messageTable)
      .where(eq(messageTable.chatId, reminderOtherChat));
    await db
      .delete(chatTable)
      .where(eq(chatTable.id, secondChatId))
      .catch(() => undefined);
    await db
      .delete(chatTable)
      .where(eq(chatTable.id, chatId))
      .catch(() => undefined);
    await db
      .delete(chatTable)
      .where(eq(chatTable.id, reminderOtherChat))
      .catch(() => undefined);
    await db.delete(userTable).where(eq(userTable.id, userId));
    await db.delete(userTable).where(eq(userTable.id, ledgerOtherUser));
    await db.delete(userTable).where(eq(userTable.id, reminderOtherUser));
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall task capability tests passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
