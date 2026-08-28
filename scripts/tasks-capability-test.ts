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

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  chat as chatTable,
  message as messageTable,
  user as userTable,
} from '@/lib/db/schema';
import {
  cancelTask,
  completeTask,
  createTask,
  evaluateTaskCommitment,
  getTaskWithReminders,
  listTasksForUser,
  markTaskReminderFired,
  rescheduleTask,
  snoozeTask,
  sweepDirtyTaskProjections,
} from '@/lib/tasks/domain';
import { evaluateCommitment } from '@/lib/tasks/reminder-state';

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
  } finally {
    // Explicit cleanup order: the live schema's legacy FKs are NO ACTION for
    // User→Chat, so children go first.
    await db.delete(messageTable).where(eq(messageTable.chatId, chatId));
    await db.delete(messageTable).where(eq(messageTable.chatId, secondChatId));
    await db
      .delete(userTable)
      .where(eq(userTable.id, userId))
      .catch(() => undefined);
    await db
      .delete(chatTable)
      .where(eq(chatTable.id, secondChatId))
      .catch(() => undefined);
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
  console.log('\nall task capability tests passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
