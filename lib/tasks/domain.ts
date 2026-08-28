import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  task as taskTable,
  taskReminder as taskReminderTable,
  type Task,
  type TaskReminder,
} from '@/lib/db/schema';
import { postObjectState } from '@/lib/synapse-cortex';
import { evaluateCommitment } from './reminder-state';

/**
 * Canonical task/reminder domain. The app's Postgres is the single source of
 * truth; Synapse-Cortex only derives lifecycle/attention state from these
 * objects via the stable source-link contract (source system `app_task`,
 * object id = task id, version = cortexVersion).
 *
 * Every mutation bumps cortexVersion and pushes deterministically to Cortex.
 * A failed push leaves the row dirty; the cron sweep re-pushes it later, so
 * the projection is eventually consistent without a separate delivery system.
 */

export const MAX_REMINDER_WINDOWS = 3;
const CORTEX_PUSH_TIMEOUT_MS = Number(
  process.env.SYNAPSE_CORTEX_INGEST_TIMEOUT_MS ?? 20_000,
);

export type ReminderWindowInput = {
  startAt: Date;
  endAt?: Date | null;
  label?: string | null;
};

export type CreateTaskInput = {
  userId: string;
  chatId: string;
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  reminders?: ReminderWindowInput[];
  sourceMessageId?: string | null;
  source?: 'conversation' | 'api';
};

export type TaskWithReminders = Task & { reminders: TaskReminder[] };

function normalizeReminderWindows(
  reminders: ReminderWindowInput[] | undefined,
): Array<{ startAt: Date; endAt: Date | null; label: string | null }> {
  return (reminders ?? [])
    .filter(
      (window) =>
        window.startAt instanceof Date &&
        !Number.isNaN(window.startAt.getTime()),
    )
    .slice(0, MAX_REMINDER_WINDOWS)
    .map((window) => ({
      startAt: window.startAt,
      endAt: window.endAt ?? null,
      label: window.label ?? null,
    }));
}

async function pushTaskToCortex(input: {
  userId: string;
  chatId: string;
  taskId: string;
  version: number;
  action: 'created' | 'updated' | 'completed' | 'cancelled';
  title: string;
  notes: string | null;
  dueAt: Date | null;
  reminders: Array<{ startAt: Date; endAt: Date | null; label: string | null }>;
  timeZone?: string | null;
  now?: Date;
}): Promise<boolean> {
  const result = await postObjectState(
    {
      userId: input.userId,
      chatId: input.chatId,
      now: input.now,
      timeZone: input.timeZone ?? undefined,
      source: {
        system: 'app_task',
        objectId: input.taskId,
        version: input.version,
        kind: 'task',
      },
      action: input.action,
      title: input.title,
      notes: input.notes,
      dueAt: input.dueAt,
      reminderWindows: input.reminders.map((window) => ({
        start: window.startAt,
        end: window.endAt,
        label: window.label,
      })),
    },
    { timeoutMs: CORTEX_PUSH_TIMEOUT_MS },
  );
  if (!result.pushed) {
    console.warn('[tasks] cortex projection push failed (row stays dirty)', {
      taskId: input.taskId,
      action: input.action,
      error: result.error,
    });
  }
  return result.pushed;
}

export async function createTask(
  input: CreateTaskInput,
): Promise<TaskWithReminders> {
  const reminders = normalizeReminderWindows(input.reminders);
  const [created] = await db
    .insert(taskTable)
    .values({
      userId: input.userId,
      chatId: input.chatId,
      title: input.title,
      notes: input.notes ?? null,
      dueAt: input.dueAt ?? null,
      source: input.source ?? 'conversation',
      sourceMessageId: input.sourceMessageId ?? null,
      status: 'pending',
      cortexVersion: 1,
      cortexDirty: true,
    })
    .returning();
  const reminderRows = reminders.length
    ? await db
        .insert(taskReminderTable)
        .values(
          reminders.map((window) => ({
            taskId: created.id,
            userId: input.userId,
            startAt: window.startAt,
            endAt: window.endAt,
            label: window.label,
            status: 'scheduled' as const,
          })),
        )
        .returning()
    : [];

  const pushed = await pushTaskToCortex({
    userId: input.userId,
    chatId: input.chatId,
    taskId: created.id,
    version: created.cortexVersion,
    action: 'created',
    title: created.title,
    notes: created.notes,
    dueAt: created.dueAt,
    reminders,
  });
  if (pushed) {
    await markTaskSynced(created.id, created.cortexVersion);
  }
  const persisted = await getTaskWithReminders(input.userId, created.id);
  return persisted ?? { ...created, reminders: reminderRows };
}

async function markTaskSynced(taskId: string, version: number) {
  await db
    .update(taskTable)
    .set({
      cortexSyncedAt: new Date(),
      cortexDirty: false,
      updatedAt: new Date(),
    })
    .where(and(eq(taskTable.id, taskId), eq(taskTable.cortexVersion, version)));
}

async function loadTaskOwned(
  userId: string,
  taskId: string,
): Promise<Task | null> {
  const [row] = await db
    .select()
    .from(taskTable)
    .where(and(eq(taskTable.id, taskId), eq(taskTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getTaskWithReminders(
  userId: string,
  taskId: string,
): Promise<TaskWithReminders | null> {
  const row = await loadTaskOwned(userId, taskId);
  if (!row) return null;
  const reminders = await db
    .select()
    .from(taskReminderTable)
    .where(eq(taskReminderTable.taskId, taskId))
    .orderBy(asc(taskReminderTable.startAt));
  return { ...row, reminders };
}

export async function listTasksForUser(
  userId: string,
  options: { status?: 'pending' | 'completed' | 'cancelled' } = {},
): Promise<TaskWithReminders[]> {
  const conditions = [eq(taskTable.userId, userId)];
  if (options.status) conditions.push(eq(taskTable.status, options.status));
  const rows = await db
    .select()
    .from(taskTable)
    .where(and(...conditions))
    .orderBy(asc(taskTable.dueAt), asc(taskTable.createdAt));
  if (rows.length === 0) return [];
  const reminders = await db
    .select()
    .from(taskReminderTable)
    .where(
      inArray(
        taskReminderTable.taskId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(taskReminderTable.startAt));
  return rows.map((row) => ({
    ...row,
    reminders: reminders.filter((reminder) => reminder.taskId === row.id),
  }));
}

export type MutateOutcome = {
  ok: boolean;
  reason?: 'not_found' | 'invalid_state';
  task?: TaskWithReminders;
  evaluation?: ReturnType<typeof evaluateCommitment<TaskReminder>>;
};

export async function completeTask(
  userId: string,
  taskId: string,
  options: { now?: Date; timeZone?: string | null } = {},
): Promise<MutateOutcome> {
  const row = await loadTaskOwned(userId, taskId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'pending') return { ok: false, reason: 'invalid_state' };
  const now = options.now ?? new Date();
  const [updated] = await db
    .update(taskTable)
    .set({
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      cortexVersion: row.cortexVersion + 1,
      cortexDirty: true,
    })
    .where(and(eq(taskTable.id, taskId), eq(taskTable.status, 'pending')))
    .returning();
  await db
    .update(taskReminderTable)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(taskReminderTable.taskId, taskId),
        eq(taskReminderTable.status, 'scheduled'),
      ),
    );
  const task = await getTaskWithReminders(userId, taskId);
  const pushed = await pushTaskToCortex({
    userId,
    chatId: updated.chatId,
    taskId,
    version: updated.cortexVersion,
    action: 'completed',
    title: updated.title,
    notes: updated.notes,
    dueAt: updated.dueAt,
    reminders: [],
    timeZone: options.timeZone,
    now,
  });
  if (pushed) {
    await markTaskSynced(taskId, updated.cortexVersion);
  }
  return { ok: true, task: task ?? undefined };
}

export async function cancelTask(
  userId: string,
  taskId: string,
  options: { now?: Date; timeZone?: string | null } = {},
): Promise<MutateOutcome> {
  const row = await loadTaskOwned(userId, taskId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'pending') return { ok: false, reason: 'invalid_state' };
  const now = options.now ?? new Date();
  const [updated] = await db
    .update(taskTable)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
      cortexVersion: row.cortexVersion + 1,
      cortexDirty: true,
    })
    .where(and(eq(taskTable.id, taskId), eq(taskTable.status, 'pending')))
    .returning();
  await db
    .update(taskReminderTable)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(taskReminderTable.taskId, taskId),
        eq(taskReminderTable.status, 'scheduled'),
      ),
    );
  const task = await getTaskWithReminders(userId, taskId);
  const pushed = await pushTaskToCortex({
    userId,
    chatId: updated.chatId,
    taskId,
    version: updated.cortexVersion,
    action: 'cancelled',
    title: updated.title,
    notes: updated.notes,
    dueAt: updated.dueAt,
    reminders: [],
    timeZone: options.timeZone,
    now,
  });
  if (pushed) {
    await markTaskSynced(taskId, updated.cortexVersion);
  }
  return { ok: true, task: task ?? undefined };
}

/** Move the due date and shift every scheduled reminder by the same offset. */
export async function snoozeTask(
  userId: string,
  taskId: string,
  input: { offsetMinutes?: number; until?: Date; timeZone?: string | null },
): Promise<MutateOutcome> {
  const row = await loadTaskOwned(userId, taskId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'pending') return { ok: false, reason: 'invalid_state' };
  const now = new Date();
  let nextDue: Date | null = row.dueAt;
  if (input.until) {
    nextDue = input.until;
  } else if (row.dueAt) {
    const offsetMs = (input.offsetMinutes ?? 60) * 60_000;
    nextDue = new Date(row.dueAt.getTime() + offsetMs);
  }
  const reminders = await db
    .select()
    .from(taskReminderTable)
    .where(
      and(
        eq(taskReminderTable.taskId, taskId),
        eq(taskReminderTable.status, 'scheduled'),
      ),
    )
    .orderBy(asc(taskReminderTable.startAt));
  // Shift the reminder set with the due date when one exists; without a due
  // date, snoozing shifts reminders relative to now so they stay meaningful.
  const shiftMs =
    nextDue && row.dueAt ? nextDue.getTime() - row.dueAt.getTime() : null;
  const updatedReminders: Array<{
    startAt: Date;
    endAt: Date | null;
    label: string | null;
  }> = [];
  for (const reminder of reminders) {
    const startAt = shiftMs
      ? new Date(reminder.startAt.getTime() + shiftMs)
      : new Date(now.getTime() + (input.offsetMinutes ?? 60) * 60_000);
    const endAt = shiftMs
      ? reminder.endAt
        ? new Date(reminder.endAt.getTime() + shiftMs)
        : null
      : null;
    await db
      .update(taskReminderTable)
      .set({ startAt, endAt, updatedAt: now })
      .where(eq(taskReminderTable.id, reminder.id));
    updatedReminders.push({ startAt, endAt, label: reminder.label });
  }
  const [updated] = await db
    .update(taskTable)
    .set({
      dueAt: nextDue,
      snoozeCount: row.snoozeCount + 1,
      updatedAt: now,
      cortexVersion: row.cortexVersion + 1,
      cortexDirty: true,
    })
    .where(eq(taskTable.id, taskId))
    .returning();
  const task = await getTaskWithReminders(userId, taskId);
  const pushed = await pushTaskToCortex({
    userId,
    chatId: updated.chatId,
    taskId,
    version: updated.cortexVersion,
    action: 'updated',
    title: updated.title,
    notes: updated.notes,
    dueAt: updated.dueAt,
    reminders: updatedReminders,
    timeZone: input.timeZone,
    now,
  });
  if (pushed) {
    await markTaskSynced(taskId, updated.cortexVersion);
  }
  return { ok: true, task: task ?? undefined };
}

/** Reschedule the due date and/or replace the explicit reminder windows. */
export async function rescheduleTask(
  userId: string,
  taskId: string,
  input: {
    dueAt?: Date | null;
    reminders?: ReminderWindowInput[];
    timeZone?: string | null;
  },
): Promise<MutateOutcome> {
  const row = await loadTaskOwned(userId, taskId);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'pending') return { ok: false, reason: 'invalid_state' };
  const now = new Date();
  const replaceReminders = input.reminders !== undefined;
  const reminders = normalizeReminderWindows(input.reminders);
  const [updated] = await db
    .update(taskTable)
    .set({
      dueAt: input.dueAt !== undefined ? input.dueAt : row.dueAt,
      updatedAt: now,
      cortexVersion: row.cortexVersion + 1,
      cortexDirty: true,
    })
    .where(eq(taskTable.id, taskId))
    .returning();
  if (replaceReminders) {
    await db
      .update(taskReminderTable)
      .set({ status: 'cancelled', updatedAt: now })
      .where(
        and(
          eq(taskReminderTable.taskId, taskId),
          eq(taskReminderTable.status, 'scheduled'),
        ),
      );
    if (reminders.length) {
      await db.insert(taskReminderTable).values(
        reminders.map((window) => ({
          taskId,
          userId,
          startAt: window.startAt,
          endAt: window.endAt,
          label: window.label,
          status: 'scheduled' as const,
        })),
      );
    }
  }
  const task = await getTaskWithReminders(userId, taskId);
  if (!task) return { ok: false, reason: 'not_found' };
  const activeReminders = task.reminders
    .filter((reminder) => reminder.status === 'scheduled')
    .map((reminder) => ({
      startAt: reminder.startAt,
      endAt: reminder.endAt,
      label: reminder.label,
    }));
  const pushed = await pushTaskToCortex({
    userId,
    chatId: updated.chatId,
    taskId,
    version: updated.cortexVersion,
    action: 'updated',
    title: updated.title,
    notes: updated.notes,
    dueAt: updated.dueAt,
    reminders: replaceReminders ? reminders : activeReminders,
    timeZone: input.timeZone,
    now,
  });
  if (pushed) {
    await markTaskSynced(taskId, updated.cortexVersion);
  }
  return { ok: true, task };
}

export function evaluateTaskCommitment(
  taskRow: Task,
  reminders: TaskReminder[],
  now: Date = new Date(),
) {
  return evaluateCommitment(
    {
      dueAt: taskRow.dueAt,
      reminders: reminders.filter(
        (reminder) => reminder.status === 'scheduled',
      ),
    },
    now,
  );
}

/**
 * Initiative-side consumption: a reminder wake-up fires at most once. When
 * the initiative scan claims it, the reminder is marked fired regardless of
 * the editorial outcome — the continuity packet still surfaces the task
 * reactively, but the deterministic proactive wake-up never re-offers.
 */
export async function markTaskReminderFired(
  reminderId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db
    .update(taskReminderTable)
    .set({ status: 'fired', firedAt: now, updatedAt: now })
    .where(
      and(
        eq(taskReminderTable.id, reminderId),
        eq(taskReminderTable.status, 'scheduled'),
      ),
    )
    .returning({ id: taskReminderTable.id });
  return result.length > 0;
}

/**
 * Cron-side projection sweep: re-push tasks whose Cortex projection is dirty
 * (failed direct push, or pushes from before a Cortex outage). Idempotent by
 * construction — Cortex treats same-version delivery as a no-op.
 */
export async function sweepDirtyTaskProjections(
  options: { limit?: number; now?: Date } = {},
): Promise<{ processed: number; pushed: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const dirty = await db
    .select()
    .from(taskTable)
    .where(eq(taskTable.cortexDirty, true))
    .orderBy(asc(taskTable.updatedAt))
    .limit(limit);
  let pushed = 0;
  for (const row of dirty) {
    const reminders = await db
      .select()
      .from(taskReminderTable)
      .where(
        and(
          eq(taskReminderTable.taskId, row.id),
          eq(taskReminderTable.status, 'scheduled'),
        ),
      )
      .orderBy(asc(taskReminderTable.startAt));
    const outcome = await pushTaskToCortex({
      userId: row.userId,
      chatId: row.chatId,
      taskId: row.id,
      version: row.cortexVersion,
      action:
        row.status === 'completed'
          ? 'completed'
          : row.status === 'cancelled'
            ? 'cancelled'
            : row.cortexVersion === 1
              ? 'created'
              : 'updated',
      title: row.title,
      notes: row.notes,
      dueAt: row.dueAt,
      reminders:
        row.status === 'pending'
          ? reminders.map((reminder) => ({
              startAt: reminder.startAt,
              endAt: reminder.endAt,
              label: reminder.label,
            }))
          : [],
    });
    if (outcome) {
      await markTaskSynced(row.id, row.cortexVersion);
      pushed += 1;
    }
  }
  return { processed: dirty.length, pushed };
}
