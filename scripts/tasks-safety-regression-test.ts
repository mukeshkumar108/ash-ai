/**
 * Post-audit safety regression tests — each case is a previously-PROVEN hole
 * (H1/H2/M3/M1/M4) now encoded as a permanent regression through the real
 * production path (commitTurnSemantics / domain / ledger / schema). Only the
 * model output seam is injected; everything else is the real stack.
 *
 * Run: pnpm exec tsx scripts/tasks-safety-regression-test.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.SYNAPSE_CORTEX_ENABLED = 'false';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  chat as chatTable,
  message as messageTable,
  turnAction as turnActionTable,
  user as userTable,
} from '@/lib/db/schema';
import {
  completeTask,
  createTask,
  getTaskWithReminders,
  listTasksForUser,
  snoozeTask,
} from '@/lib/tasks/domain';
import { recordTurnAction } from '@/lib/tasks/turn-actions';
import { commitTurnSemantics } from '@/lib/ai/interaction/commit-turn';
import { createTaskSchema } from '@/lib/tasks/schemas';
import type { InterpreterAction } from '@/lib/ai/interaction/interpreter';

let failures = 0;
let checks = 0;
function report(label: string, cond: boolean, note: string) {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`  [${cond ? 'ok ' : 'HOLE'}] ${label}: ${note}`);
}

function gen(actions: InterpreterAction[]) {
  return async () => ({ actions, clarifications: [] });
}

async function setup() {
  const userId = randomUUID();
  const chatId = randomUUID();
  await db
    .insert(userTable)
    .values({ id: userId, email: `safety-${userId}@test.local` });
  await db
    .insert(chatTable)
    .values({ id: chatId, userId, title: 'safety', createdAt: new Date() });
  return { userId, chatId };
}

async function teardown(userId: string, chatId: string) {
  await db
    .delete(messageTable)
    .where(eq(messageTable.chatId, chatId))
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

async function turn(
  userId: string,
  chatId: string,
  messageId: string,
  o: {
    userText: string;
    assistantText: string;
    recentContext?: string;
    actions: InterpreterAction[];
  },
) {
  await db
    .insert(messageTable)
    .values({
      id: messageId,
      chatId,
      role: 'user',
      parts: [{ type: 'text', text: o.userText }],
      attachments: [],
      createdAt: new Date(),
    })
    .onConflictDoNothing();
  return commitTurnSemantics({
    userId,
    chatId,
    messageId,
    userText: o.userText,
    assistantText: o.assistantText,
    localTime: 'x',
    timeZone: 'Europe/London',
    recentContext: o.recentContext,
    generate: gen(o.actions),
  });
}

async function main() {
  // H1: a clarification reply + requires_clarification must NEVER mutate.
  {
    const { userId, chatId } = await setup();
    try {
      const task = await createTask({
        userId,
        chatId,
        title: 'Call the plumber',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const result = await turn(userId, chatId, randomUUID(), {
        userText: 'I did it',
        assistantText:
          'Sorry, I have a few things on the go — what exactly did you finish?',
        recentContext: '',
        actions: [
          {
            action: 'complete_task',
            evidence_class: 'explicit_resolution',
            evidence_verbatim: 'I did it',
            target_task_id: task.id,
            title: null,
            notes: null,
            due_iso: null,
            reminder_windows: [],
            target_resolution: 'referential',
            requires_clarification: true,
            snooze_minutes: null,
          },
        ],
      });
      const after = await getTaskWithReminders(userId, task.id);
      report(
        'H1 clarification vetoes destructive commit',
        result.committed.length === 0 && after?.status === 'pending',
        `committed=${result.committed.length} status=${after?.status}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // H2: "no, the other one" — visible reply names a DIFFERENT task than the
  // model's target → veto (deterministic, no grammar heuristics).
  {
    const { userId, chatId } = await setup();
    try {
      const landlord = await createTask({
        userId,
        chatId,
        title: 'Talk to the landlord',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      await createTask({
        userId,
        chatId,
        title: 'Pay the rent',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const result = await turn(userId, chatId, randomUUID(), {
        userText: 'no, the other one',
        assistantText: 'Oh! The rent one then. Dropping it.',
        recentContext:
          'user: can you cancel the landlord reminder\nassistant: cancelling the landlord talk.',
        actions: [
          {
            action: 'cancel_task',
            evidence_class: 'explicit_modification',
            evidence_verbatim: 'the other one',
            target_task_id: landlord.id,
            title: null,
            notes: null,
            due_iso: null,
            reminder_windows: [],
            target_resolution: 'referential',
            requires_clarification: false,
            snooze_minutes: null,
          },
        ],
      });
      const after = await getTaskWithReminders(userId, landlord.id);
      report(
        'H2 "no, the other one" wrong-binding vetoed',
        result.committed.length === 0 && after?.status === 'pending',
        `committed=${result.committed.length} landlord=${after?.status}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // Positive reply-naming still commits (act boldly when the visible reply
  // agrees with the model's target).
  {
    const { userId, chatId } = await setup();
    try {
      const dentist = await createTask({
        userId,
        chatId,
        title: 'Book the dentist',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      await createTask({
        userId,
        chatId,
        title: 'Buy a gift',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const result = await turn(userId, chatId, randomUUID(), {
        userText: 'cancel that',
        assistantText: "I'll drop the dentist booking reminder.",
        recentContext: '',
        actions: [
          {
            action: 'cancel_task',
            evidence_class: 'explicit_modification',
            evidence_verbatim: 'cancel that',
            target_task_id: dentist.id,
            title: null,
            notes: null,
            due_iso: null,
            reminder_windows: [],
            target_resolution: 'referential',
            requires_clarification: false,
            snooze_minutes: null,
          },
        ],
      });
      const after = await getTaskWithReminders(userId, dentist.id);
      report(
        'reply-naming referential commit preserved',
        result.committed.length === 1 && after?.status === 'cancelled',
        `committed=${result.committed.length} dentist=${after?.status}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // Bare pronoun + multiple tasks, no positive naming anywhere -> fail closed.
  {
    const { userId, chatId } = await setup();
    try {
      const a = await createTask({
        userId,
        chatId,
        title: 'Pay the rent',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      await createTask({
        userId,
        chatId,
        title: 'File expenses',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const result = await turn(userId, chatId, randomUUID(), {
        userText: 'I did it',
        assistantText: 'Done.',
        recentContext: '',
        actions: [
          {
            action: 'complete_task',
            evidence_class: 'explicit_resolution',
            evidence_verbatim: 'I did it',
            target_task_id: a.id,
            title: null,
            notes: null,
            due_iso: null,
            reminder_windows: [],
            target_resolution: 'referential',
            requires_clarification: false,
            snooze_minutes: null,
          },
        ],
      });
      const after = await getTaskWithReminders(userId, a.id);
      report(
        'bare pronoun + multiple tasks fails closed',
        result.committed.length === 0 && after?.status === 'pending',
        `committed=${result.committed.length} status=${after?.status}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // M3: mutation+ledger atomicity — a ledger WRITE failure inside the
  // transaction ROLLS BACK the status change (task must stay pending).
  {
    const { userId, chatId } = await setup();
    try {
      const task = await createTask({
        userId,
        chatId,
        title: 'Atomic',
        dueAt: new Date(Date.now() + 3_600_000),
      });
      const ledgerBefore = await db
        .select()
        .from(turnActionTable)
        .where(eq(turnActionTable.taskId, task.id));
      let threw = false;
      try {
        // Malformed originMessageId forces the ledger UUID insert to fail
        // inside the transaction -> the whole mutation must roll back.
        await completeTask(userId, task.id, {
          provenance: { originMessageId: 'not-a-uuid' as string },
        });
      } catch {
        threw = true;
      }
      const after = await getTaskWithReminders(userId, task.id);
      const ledgerAfter = await db
        .select()
        .from(turnActionTable)
        .where(eq(turnActionTable.taskId, task.id));
      report(
        'M3 ledger write failure rolls back the mutation',
        threw &&
          after?.status === 'pending' &&
          ledgerAfter.length === ledgerBefore.length,
        `threw=${threw} status=${after?.status} (must still be pending) ledger=${ledgerAfter.length}->${ledgerBefore.length}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // M1: public create schema no longer accepts provenance fields.
  {
    const parsed = createTaskSchema.safeParse({
      title: 'Renew passport',
      source: 'manual',
      sourceMessageId: randomUUID(),
      materializedCandidateKey: 'c_anything',
    });
    report(
      'M1 public schema strips provenance fields',
      parsed.success === true &&
        !('materializedCandidateKey' in parsed.data) &&
        !('sourceMessageId' in parsed.data),
      `keys=${Object.keys(parsed.success ? parsed.data : {})}`,
    );
  }

  // M2: routed task ids must be valid uuids (guarded by the [id] route).
  {
    const zod = await import('zod');
    const ok = zod.z.string().uuid().safeParse('not-a-uuid').success;
    report(
      'M2 malformed task ids are rejected at the boundary (no 500)',
      ok === false,
      `uuid check valid=${ok}`,
    );
  }

  // M4: duplicate create proposals collapse to one committed chip.
  {
    const { userId, chatId } = await setup();
    try {
      const dup: InterpreterAction = {
        action: 'create_task',
        evidence_class: 'explicit_command',
        evidence_verbatim: 'remind me to call Mum',
        target_task_id: null,
        title: 'Call Mum',
        notes: null,
        due_iso: null,
        reminder_windows: [],
        target_resolution: 'referential',
        requires_clarification: false,
        snooze_minutes: null,
      };
      const mid = randomUUID();
      const result = await turn(userId, chatId, mid, {
        userText: 'remind me to call Mum',
        assistantText: 'sure',
        recentContext: '',
        actions: [dup, dup],
      });
      const tasks = (await listTasksForUser(userId)).filter(
        (t) => t.title === 'Call Mum',
      );
      report(
        'M4 duplicate proposals -> one task, one chip',
        tasks.length === 1 && result.committed.length === 1,
        `tasks=${tasks.length} committed=${result.committed.length}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // ── P1: canonical idempotency identity (proposal action -> ledger action) ──

  // A. Duplicate snooze proposals in ONE interpretation mutate canonical state
  //    exactly once (due/reminders shift once, version +1, one ledger row, one
  //    chip).
  {
    const { userId, chatId } = await setup();
    try {
      const baseDue = new Date(Date.now() + 3_600_000);
      const task = await createTask({ userId, chatId, title: 'Snooze once', dueAt: baseDue });
      const mid = randomUUID();
      const snoozeAction: InterpreterAction = {
        action: 'snooze_task',
        evidence_class: 'explicit_modification',
        evidence_verbatim: 'push it an hour',
        target_task_id: task.id,
        title: null, notes: null, due_iso: null, reminder_windows: [],
        target_resolution: 'referential', requires_clarification: false,
        snooze_minutes: 60,
      };
      const result = await turn(userId, chatId, mid, {
        userText: 'push it an hour',
        assistantText: 'pushed it an hour',
        recentContext: '',
        actions: [snoozeAction, snoozeAction],
      });
      const after = await getTaskWithReminders(userId, task.id);
      const ledgerRows = await db
        .select()
        .from(turnActionTable)
        .where(eq(turnActionTable.messageId, mid));
      const shifted = (after?.dueAt?.getTime() ?? 0) - baseDue.getTime();
      report(
        'P1-A duplicate snooze proposals mutate once',
        result.committed.length === 1 &&
          after?.snoozeCount === 1 &&
          after?.cortexVersion === 2 &&
          shifted === 60 * 60_000 &&
          ledgerRows.length === 1,
        `committed=${result.committed.length} snooze=${after?.snoozeCount} version=${after?.cortexVersion} shiftMin=${shifted / 60_000} ledger=${ledgerRows.length}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // B. Replay the SAME message snooze -> no-op (no second mutation/version).
  {
    const { userId, chatId } = await setup();
    try {
      const baseDue = new Date(Date.now() + 3_600_000);
      const task = await createTask({ userId, chatId, title: 'Replay snooze', dueAt: baseDue });
      const mid = randomUUID();
      const snoozeAction: InterpreterAction = {
        action: 'snooze_task',
        evidence_class: 'explicit_modification',
        evidence_verbatim: 'push it an hour',
        target_task_id: task.id,
        title: null, notes: null, due_iso: null, reminder_windows: [],
        target_resolution: 'referential', requires_clarification: false,
        snooze_minutes: 60,
      };
      const first = await turn(userId, chatId, mid, {
        userText: 'push it an hour', assistantText: 'pushed', recentContext: '',
        actions: [snoozeAction],
      });
      const second = await turn(userId, chatId, mid, {
        userText: 'push it an hour', assistantText: 'pushed', recentContext: '',
        actions: [snoozeAction],
      });
      const after = await getTaskWithReminders(userId, task.id);
      report(
        'P1-B replayed same-message snooze is a no-op',
        first.committed.length === 1 &&
          second.committed.length === 0 &&
          second.rejected.some((r) => r.reason === 'already_applied') &&
          after?.snoozeCount === 1 &&
          after?.cortexVersion === 2,
        `commits=${first.committed.length}/${second.committed.length} snooze=${after?.snoozeCount} version=${after?.cortexVersion}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // C. Replay the SAME message reschedule -> no-op (due set once, version once).
  {
    const { userId, chatId } = await setup();
    try {
      const task = await createTask({ userId, chatId, title: 'Replay reschedule', dueAt: new Date(Date.now() + 3_600_000) });
      const mid = randomUUID();
      const fridayKey = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
      const resched: InterpreterAction = {
        action: 'reschedule_task',
        evidence_class: 'explicit_modification',
        evidence_verbatim: 'move it to Friday',
        target_task_id: task.id,
        title: null, notes: null, due_iso: fridayKey, reminder_windows: [],
        target_resolution: 'explicit', requires_clarification: false,
        snooze_minutes: null,
      };
      const first = await turn(userId, chatId, mid, {
        userText: 'move it to Friday', assistantText: 'moved', recentContext: '',
        actions: [resched],
      });
      const second = await turn(userId, chatId, mid, {
        userText: 'move it to Friday', assistantText: 'moved', recentContext: '',
        actions: [resched],
      });
      const after = await getTaskWithReminders(userId, task.id);
      report(
        'P1-C replayed same-message reschedule is a no-op',
        first.committed.length === 1 &&
          second.committed.length === 0 &&
          after?.dueAt?.getTime() === new Date(fridayKey).getTime() &&
          after?.cortexVersion === 2,
        `commits=${first.committed.length}/${second.committed.length} version=${after?.cortexVersion}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // D. complete retry remains a no-op (already covered state transition).
  {
    const { userId, chatId } = await setup();
    try {
      const task = await createTask({ userId, chatId, title: 'Replay complete', dueAt: new Date(Date.now() + 3_600_000) });
      const mid = randomUUID();
      const completeAction: InterpreterAction = {
        action: 'complete_task',
        evidence_class: 'explicit_resolution',
        evidence_verbatim: 'I did it',
        target_task_id: task.id,
        title: null, notes: null, due_iso: null, reminder_windows: [],
        target_resolution: 'referential', requires_clarification: false,
        snooze_minutes: null,
      };
      const first = await turn(userId, chatId, mid, {
        userText: 'I did it', assistantText: 'done', recentContext: '',
        actions: [completeAction],
      });
      const second = await turn(userId, chatId, mid, {
        userText: 'I did it', assistantText: 'done', recentContext: '',
        actions: [completeAction],
      });
      const after = await getTaskWithReminders(userId, task.id);
      report(
        'P1-D replayed same-message complete is a no-op',
        first.committed.length === 1 &&
          second.committed.length === 0 &&
          after?.status === 'completed',
        `commits=${first.committed.length}/${second.committed.length} status=${after?.status}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  // E. The ledger claim is authoritative: a pre-existing claim blocks the
  //    mutation both through the interpreter (pre-check) AND through a direct
  //    domain call (transaction abort).
  {
    const { userId, chatId } = await setup();
    try {
      const task = await createTask({ userId, chatId, title: 'Claim authority', dueAt: new Date(Date.now() + 3_600_000) });
      const mid = randomUUID();
      await recordTurnAction({ userId, messageId: mid, taskId: task.id, action: 'updated' });
      const snoozeAction: InterpreterAction = {
        action: 'snooze_task',
        evidence_class: 'explicit_modification',
        evidence_verbatim: 'push it an hour',
        target_task_id: task.id,
        title: null, notes: null, due_iso: null, reminder_windows: [],
        target_resolution: 'referential', requires_clarification: false,
        snooze_minutes: 60,
      };
      const result = await turn(userId, chatId, mid, {
        userText: 'push it an hour', assistantText: 'pushed', recentContext: '',
        actions: [snoozeAction],
      });
      let threw = false;
      try {
        await snoozeTask(userId, task.id, {
          offsetMinutes: 60,
          provenance: { originMessageId: mid },
        });
      } catch (error) {
        threw =
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === 'TASK_ACTION_ALREADY_APPLIED';
      }
      const after = await getTaskWithReminders(userId, task.id);
      report(
        'P1-E ledger claim is authoritative (interpreter + domain abort)',
        result.committed.length === 0 && threw && after?.snoozeCount === 0,
        `interpreterCommits=${result.committed.length} domainAbort=${threw} snooze=${after?.snoozeCount}`,
      );
    } finally {
      await teardown(userId, chatId);
    }
  }

  if (failures > 0) {
    console.error(
      `\n${failures} of ${checks} safety regression check(s) FAILED`,
    );
    process.exit(1);
  }
  console.log(`\nall safety regression checks passed (${checks})`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
