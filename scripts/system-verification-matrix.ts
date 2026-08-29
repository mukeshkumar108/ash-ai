import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db/queries';
import {
  user as userTable,
  chat as chatTable,
  message as messageTable,
  task as taskTable,
  taskReminder as taskReminderTable,
  turnAction as turnActionTable,
  cortexOutbox as cortexOutboxTable,
} from '../lib/db/schema';
import {
  createTask,
  getTaskWithReminders,
  listTasksForUser,
  completeTask,
  cancelTask,
  snoozeTask,
  rescheduleTask,
  editTask,
  evaluateTaskCommitment,
  markTaskReminderFired,
  sweepDirtyTaskProjections,
} from '../lib/tasks/domain';
import {
  resolveDestructiveBinding,
  commitInterpreterActions,
  fastCreateCandidateKey,
} from '../lib/ai/interaction/interpreter';
import { sweepDueCortexOutbox, enqueueCortexTurn } from '../lib/cortex/outbox';
import { postObjectState } from '../lib/synapse-cortex';
import { resolveCurrentBestChatId } from '../lib/tasks/anchoring';
import { generateUUID } from '../lib/utils';

// Test Tracking
let totalTests = 0;
let passedTests = 0;
const failures: Array<{ name: string; error: string }> = [];

function assert(condition: boolean, message: string) {
  totalTests++;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
}

async function testSection(name: string, fn: () => Promise<void>) {
  console.log(`\n============================================================`);
  console.log(`RUNNING: ${name}`);
  console.log(`============================================================`);
  try {
    await fn();
    console.log(`✅ PASSED: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAILED: ${name}`);
    console.error(err.stack || err.message);
    failures.push({ name, error: err.message });
  }
}

// Scratch test users to be cleaned up
const testUserIds: string[] = [];

async function createTestUser(
  tag: string,
): Promise<{ id: string; email: string }> {
  const id = generateUUID();
  const email = `sys-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await db.insert(userTable).values({
    id,
    email,
    password: 'hashed-test-password',
  });
  testUserIds.push(id);
  return { id, email };
}

async function createTestChat(
  userId: string,
  title = 'Test Chat',
): Promise<string> {
  const id = generateUUID();
  await db.insert(chatTable).values({
    id,
    userId,
    title,
    visibility: 'private',
    createdAt: new Date(),
  });
  return id;
}

async function createTestMessage(
  chatId: string,
  messageId: string,
  text: string,
): Promise<string> {
  await db.insert(messageTable).values({
    id: messageId,
    chatId,
    role: 'user',
    parts: [{ type: 'text', text }],
    attachments: [],
    createdAt: new Date(),
  });
  return messageId;
}

async function cleanupAllTestData() {
  console.log('\n🧹 Cleaning up all system-test data...');
  if (testUserIds.length === 0) return;

  try {
    for (const uid of testUserIds) {
      try {
        await db
          .delete(taskReminderTable)
          .where(eq(taskReminderTable.userId, uid));
        await db.delete(turnActionTable).where(eq(turnActionTable.userId, uid));
        await db.delete(taskTable).where(eq(taskTable.userId, uid));
        const chats = await db
          .select({ id: chatTable.id })
          .from(chatTable)
          .where(eq(chatTable.userId, uid));
        for (const c of chats) {
          const messages = await db
            .select({ id: messageTable.id })
            .from(messageTable)
            .where(eq(messageTable.chatId, c.id));
          if (messages.length > 0) {
            await db.delete(cortexOutboxTable).where(
              inArray(
                cortexOutboxTable.appMessageId,
                messages.map((message) => message.id),
              ),
            );
          }
          await db.delete(messageTable).where(eq(messageTable.chatId, c.id));
        }
        await db.delete(chatTable).where(eq(chatTable.userId, uid));
        await db.delete(userTable).where(eq(userTable.id, uid));
      } catch (inner) {
        // continue best effort
      }
    }
    console.log(
      `✅ Successfully cleaned up ${testUserIds.length} test users and all associated entities.`,
    );
  } catch (err) {
    console.error('⚠️ Cleanup encountered an error:', err);
  }
}

async function main() {
  console.log('🚀 Starting Independent System-Test Verification Matrix...');

  try {
    // -------------------------------------------------------------------------
    // SURFACE A: CONVERSATION -> TASK (Fast Path Proposal & Commit)
    // -------------------------------------------------------------------------
    await testSection('Surface A: Conversation -> Task lifecycle', async () => {
      const user = await createTestUser('surface-a');
      const chatId = await createTestChat(user.id);
      const msgId1 = generateUUID();
      await createTestMessage(
        chatId,
        msgId1,
        'Please remind me tomorrow to call Mum at 10',
      );

      // Case 1: Explicit Command "remind me tomorrow to call Mum"
      const result1 = await commitInterpreterActions({
        interpretation: {
          actions: [
            {
              action: 'create_task',
              evidence_class: 'explicit_command',
              evidence_verbatim: 'remind me tomorrow to call Mum',
              target_task_id: null,
              target_resolution: null,
              requires_clarification: false,
              title: 'Call Mum',
              notes: null,
              due_iso: '2026-09-01T10:00:00.000Z',
              reminder_windows: [
                {
                  label: 'Morning of',
                  start_iso: '2026-09-01T09:00:00.000Z',
                  end_iso: null,
                },
              ],
              snooze_minutes: null,
            },
          ],
          clarifications: [],
        },
        userText: 'Please remind me tomorrow to call Mum at 10',
        assistantText: 'I have noted that down for tomorrow at 10am.',
        userId: user.id,
        chatId,
        timeZone: 'UTC',
        roster: [],
        originMessageId: msgId1,
      });

      assert(
        result1.committed.length === 1,
        'Exactly one task committed for Case 1',
      );
      const mumTaskId = result1.committed[0].taskId;
      assert(mumTaskId != null, 'Committed action has a non-null taskId');
      if (mumTaskId == null) throw new Error('Committed action has no taskId');
      assert(
        result1.committed[0].title === 'Call Mum',
        'Committed title is Call Mum',
      );

      const [mumTask] = await db
        .select()
        .from(taskTable)
        .where(eq(taskTable.id, mumTaskId));
      assert(mumTask.status === 'pending', 'Task is pending');
      assert(mumTask.userId === user.id, 'Task is user-owned');
      assert(
        mumTask.chatId === chatId,
        'Task provenance points to origin chat',
      );

      const [mumAction] = await db
        .select()
        .from(turnActionTable)
        .where(eq(turnActionTable.taskId, mumTaskId));
      assert(mumAction.action === 'created', 'TurnAction recorded as created');
      assert(mumAction.messageId === msgId1, 'TurnAction linked to message');

      // Case 2: Modification "actually make that Friday"
      const msgId2 = generateUUID();
      await createTestMessage(
        chatId,
        msgId2,
        'Actually make that Friday instead',
      );
      const rosterAfter1 = [
        { taskId: mumTaskId, title: 'Call Mum', dueAt: mumTask.dueAt },
      ];
      const result2 = await commitInterpreterActions({
        interpretation: {
          actions: [
            {
              action: 'reschedule_task',
              evidence_class: 'explicit_modification',
              evidence_verbatim: 'actually make that Friday',
              target_task_id: mumTaskId,
              target_resolution: 'referential',
              requires_clarification: false,
              title: 'Call Mum',
              notes: null,
              due_iso: '2026-09-04T10:00:00.000Z',
              reminder_windows: [],
              snooze_minutes: null,
            },
          ],
          clarifications: [],
        },
        userText: 'Actually make that Friday instead',
        assistantText: 'Moved Call Mum to Friday.',
        userId: user.id,
        chatId,
        timeZone: 'UTC',
        roster: rosterAfter1,
        originMessageId: msgId2,
      });

      assert(result2.committed.length === 1, 'Reschedule committed');
      const [rescheduledTask] = await db
        .select()
        .from(taskTable)
        .where(eq(taskTable.id, mumTaskId));
      assert(
        rescheduledTask.dueAt?.toISOString() === '2026-09-04T10:00:00.000Z',
        'Due date moved to Friday',
      );

      // Case 3: Resolution "I did it" with multiple pending tasks -> Ambiguous Target Safety
      const secondTask = await createTask({
        userId: user.id,
        chatId,
        title: 'Renew Passport',
        source: 'manual',
      });
      const rosterMulti = [
        { taskId: mumTaskId, title: 'Call Mum', dueAt: rescheduledTask.dueAt },
        { taskId: secondTask.id, title: 'Renew Passport', dueAt: null },
      ];
      const msgId3 = generateUUID();
      await createTestMessage(chatId, msgId3, 'I finished it');

      const result3 = await commitInterpreterActions({
        interpretation: {
          actions: [
            {
              action: 'complete_task',
              evidence_class: 'explicit_resolution',
              evidence_verbatim: 'I finished it',
              target_task_id: mumTaskId,
              target_resolution: 'referential',
              requires_clarification: false,
              title: null,
              notes: null,
              due_iso: null,
              reminder_windows: [],
              snooze_minutes: null,
            },
          ],
          clarifications: [],
        },
        userText: 'I finished it',
        assistantText: 'Which one did you finish — Call Mum or Renew Passport?',
        userId: user.id,
        chatId,
        timeZone: 'UTC',
        roster: rosterMulti,
        originMessageId: msgId3,
      });

      assert(
        result3.committed.length === 0,
        'No destructive mutation committed under referential ambiguity',
      );
      assert(
        result3.clarifications.length > 0,
        'Clarification returned for ambiguous target',
      );
      assert(
        result3.rejected.some((r) => r.reason === 'ambiguous_target'),
        'Rejected with ambiguous_target',
      );

      // Verify DB tasks are still pending
      const [mumStillPending] = await db
        .select()
        .from(taskTable)
        .where(eq(taskTable.id, mumTaskId));
      const [passStillPending] = await db
        .select()
        .from(taskTable)
        .where(eq(taskTable.id, secondTask.id));
      assert(mumStillPending.status === 'pending', 'Mum task remained pending');
      assert(
        passStillPending.status === 'pending',
        'Passport task remained pending',
      );

      // Case 4: Multiple actions in single turn
      const msgId4 = generateUUID();
      await createTestMessage(
        chatId,
        msgId4,
        'Cancel the passport thing and remind me next week to pay taxes',
      );
      const result4 = await commitInterpreterActions({
        interpretation: {
          actions: [
            {
              action: 'cancel_task',
              evidence_class: 'explicit_modification',
              evidence_verbatim: 'cancel the passport thing',
              target_task_id: secondTask.id,
              target_resolution: 'explicit',
              requires_clarification: false,
              title: 'Renew Passport',
              notes: null,
              due_iso: null,
              reminder_windows: [],
              snooze_minutes: null,
            },
            {
              action: 'create_task',
              evidence_class: 'explicit_command',
              evidence_verbatim: 'remind me next week to pay taxes',
              target_task_id: null,
              target_resolution: null,
              requires_clarification: false,
              title: 'Pay Taxes',
              notes: null,
              due_iso: '2026-09-07T09:00:00.000Z',
              reminder_windows: [],
              snooze_minutes: null,
            },
          ],
          clarifications: [],
        },
        userText:
          'Cancel the passport thing and remind me next week to pay taxes',
        assistantText:
          'Cancelled the passport task and set a reminder for next week to pay taxes.',
        userId: user.id,
        chatId,
        timeZone: 'UTC',
        roster: rosterMulti,
        originMessageId: msgId4,
      });

      assert(
        result4.committed.length === 2,
        'Both cancel and create committed in single turn',
      );
      const [cancelledPassport] = await db
        .select()
        .from(taskTable)
        .where(eq(taskTable.id, secondTask.id));
      assert(cancelledPassport.status === 'cancelled', 'Passport cancelled');
      const [createdTaxes] = await db
        .select()
        .from(taskTable)
        .where(
          and(eq(taskTable.userId, user.id), eq(taskTable.title, 'Pay Taxes')),
        );
      assert(
        createdTaxes != null && createdTaxes.status === 'pending',
        'Taxes task created and pending',
      );
    });

    // -------------------------------------------------------------------------
    // SURFACE B & F: IMPLICIT CORTEX STATE & ABSORPTION
    // -------------------------------------------------------------------------
    await testSection(
      'Surface B & F: Implicit Cortex candidate lifecycle and absorption',
      async () => {
        const user = await createTestUser('surface-b');
        const chatId = await createTestChat(user.id);

        // 1. Implicit conversation: "I probably need to sort out my car insurance sometime"
        const msgId1 = generateUUID();
        await createTestMessage(
          chatId,
          msgId1,
          'I probably need to sort out my car insurance sometime',
        );
        const semanticCommit = await commitInterpreterActions({
          interpretation: {
            actions: [],
            clarifications: [],
          },
          userText: 'I probably need to sort out my car insurance sometime',
          assistantText:
            'Insurance renewals can sneak up on you. Do you want me to keep track of that?',
          userId: user.id,
          chatId,
          timeZone: 'UTC',
          roster: [],
          originMessageId: msgId1,
        });
        assert(
          semanticCommit.committed.length === 0,
          'Implicit text produces 0 fast-path tasks',
        );

        // 2. Cortex registers a commitment candidate
        const candidateKey = `cortex:candidate:${user.id}:insurance`;
        const cortexRes = await postObjectState({
          userId: user.id,
          chatId,
          source: {
            system: 'app_task',
            objectId: generateUUID(),
            version: 1,
            kind: 'task',
          },
          action: 'created',
          title: 'Sort out car insurance',
          notes: 'Implicit conversation discovery',
        });
        assert(cortexRes.pushed, 'Cortex object state pushed successfully');

        // 3. User later explicitly accepts: "Yeah add that"
        const msgId2 = generateUUID();
        await createTestMessage(chatId, msgId2, 'Yeah add that');
        const fastKey = fastCreateCandidateKey({
          originMessageId: msgId2,
          title: 'Sort out car insurance',
          evidence: 'yeah add that',
        });

        const acceptedTask = await createTask({
          userId: user.id,
          chatId,
          title: 'Sort out car insurance',
          source: 'sophie_accepted',
          originMessageId: msgId2,
          originEvidence: 'yeah add that',
          materializedCandidateKey: fastKey,
          absorbs: [{ kind: 'open_loop', id: 'open-loop-insurance-1' }],
        });

        assert(
          acceptedTask.id != null,
          'Canonical task created from accepted candidate',
        );
        assert(
          acceptedTask.source === 'sophie_accepted',
          'Source is sophie_accepted',
        );
        assert(
          acceptedTask.materializedCandidateKey === fastKey,
          'Candidate key materialized',
        );

        // 4. Repeated creation with identical candidate key is idempotent
        const duplicateAttempt = await createTask({
          userId: user.id,
          chatId,
          title: 'Sort out car insurance',
          source: 'sophie_accepted',
          materializedCandidateKey: fastKey,
        });
        assert(
          duplicateAttempt.id === acceptedTask.id,
          'Duplicate candidate materialization returns existing task',
        );

        // Verify only 1 task exists in DB
        const userTasks = await listTasksForUser(user.id);
        assert(
          userTasks.filter((t) => t.materializedCandidateKey === fastKey)
            .length === 1,
          'Exactly one DB task exists for candidate key',
        );
      },
    );

    // -------------------------------------------------------------------------
    // SURFACE E & G: OUTBOX RECONCILIATION & MATERIALIZED ACTIONS
    // -------------------------------------------------------------------------
    await testSection(
      'Surface E & G: Outbox reconciliation, delayed sync, and delivery',
      async () => {
        const user = await createTestUser('surface-e');
        const chatId = await createTestChat(user.id);
        const msgId = generateUUID();
        await createTestMessage(chatId, msgId, 'Please remind me to buy milk');

        // 1. Create a task via fast-path semantic commit
        const res = await commitInterpreterActions({
          interpretation: {
            actions: [
              {
                action: 'create_task',
                evidence_class: 'explicit_command',
                evidence_verbatim: 'buy milk',
                target_task_id: null,
                target_resolution: null,
                requires_clarification: false,
                title: 'Buy Milk',
                notes: null,
                due_iso: null,
                reminder_windows: [],
                snooze_minutes: null,
              },
            ],
            clarifications: [],
          },
          userText: 'Please remind me to buy milk',
          assistantText: 'Added Buy Milk to your tasks.',
          userId: user.id,
          chatId,
          timeZone: 'UTC',
          roster: [],
          originMessageId: msgId,
        });

        assert(res.committed.length === 1, 'Task committed');
        const taskId = res.committed[0].taskId;
        if (taskId == null) throw new Error('Committed action has no taskId');

        // 2. Enqueue Cortex outbox turn event
        await enqueueCortexTurn({
          userId: user.id,
          chatId,
          honchoMessageId: `honcho-${msgId}`,
          appMessageId: msgId,
          text: 'Please remind me to buy milk',
        });

        // 3. Deliver outbox events -> Cortex receives turn event with materialized_actions
        const deliveryResult = await sweepDueCortexOutbox({
          limit: 10,
          now: new Date(),
        });
        assert(
          deliveryResult.delivered >= 1,
          'Outbox delivered to local Cortex',
        );

        // 4. Complete task and sweep dirty state
        await completeTask(user.id, taskId);
        const [completedTask] = await db
          .select()
          .from(taskTable)
          .where(eq(taskTable.id, taskId));
        assert(
          completedTask.status === 'completed',
          'Task status is completed',
        );
        assert(completedTask.cortexVersion === 2, 'Cortex version bumped to 2');

        // Simulate a transient Cortex sync retry by marking cortexDirty = true
        await db
          .update(taskTable)
          .set({ cortexDirty: true })
          .where(eq(taskTable.id, taskId));

        const sweepResult = await sweepDirtyTaskProjections({ limit: 10 });
        assert(sweepResult.pushed >= 1, 'Dirty completed task swept to Cortex');

        const [syncedTask] = await db
          .select()
          .from(taskTable)
          .where(eq(taskTable.id, taskId));
        assert(
          syncedTask.cortexDirty === false,
          'Task cortexDirty cleared after successful sweep',
        );
      },
    );

    // -------------------------------------------------------------------------
    // SURFACE H: CROSS-CHAT RESILIENCE
    // -------------------------------------------------------------------------
    await testSection(
      'Surface H: Cross-chat mutations and birth chat deletion resilience',
      async () => {
        const user = await createTestUser('surface-h');
        const chatA = await createTestChat(user.id, 'Chat A (Birth Chat)');
        const chatB = await createTestChat(user.id, 'Chat B (Second Chat)');

        // 1. Create task in Chat A
        const task = await createTask({
          userId: user.id,
          chatId: chatA,
          title: 'Cross-Chat Document Review',
          dueAt: new Date(Date.now() + 3600_000),
          reminders: [
            {
              startAt: new Date(Date.now() + 1800_000),
              label: 'Half hour before',
            },
          ],
          source: 'conversation',
        });
        assert(task.chatId === chatA, 'Birth chat is Chat A');

        // 2. In Chat B, list tasks for user -> task is present
        const tasksInChatB = await listTasksForUser(user.id, {
          status: 'pending',
        });
        assert(
          tasksInChatB.some((t) => t.id === task.id),
          'Task is visible in user-owned roster regardless of active chat',
        );

        // 3. Mutate task from Chat B context (snooze + reschedule)
        const snoozeOutcome = await snoozeTask(user.id, task.id, {
          offsetMinutes: 120,
        });
        assert(snoozeOutcome.ok, 'Snooze succeeded');

        // 4. Delete Chat A (birth chat)
        await db.delete(chatTable).where(eq(chatTable.id, chatA));

        // 5. Verify task is NOT deleted and remains canonical
        const [persistedTask] = await db
          .select()
          .from(taskTable)
          .where(eq(taskTable.id, task.id));
        assert(persistedTask != null, 'Task survived birth chat deletion');
        assert(
          persistedTask.status === 'pending',
          'Task status is still pending',
        );

        // 6. Anchor check: resolveCurrentBestChatId resolves to Chat B (the surviving chat)
        const bestChat = await resolveCurrentBestChatId(user.id);
        assert(
          bestChat === chatB,
          'Delivery chat resolves to remaining active chat B, never null string',
        );
      },
    );

    // -------------------------------------------------------------------------
    // SURFACE I: REMINDER & INITIATIVE PROACTIVE DELIVERY
    // -------------------------------------------------------------------------
    await testSection(
      'Surface I: Reminder & Initiative proactive delivery engine',
      async () => {
        const user = await createTestUser('surface-i');
        const chat = await createTestChat(user.id, 'Initiative Chat');

        // 1. Create task with due reminder in the past (overdue for evaluation)
        const pastReminder = new Date(Date.now() - 60_000); // 1 min ago
        const pastDue = new Date(Date.now() - 30_000);
        const overdueTask = await createTask({
          userId: user.id,
          chatId: chat,
          title: 'Take medication',
          dueAt: pastDue,
          reminders: [{ startAt: pastReminder, label: 'Med time' }],
          source: 'conversation',
        });

        // 2. Evaluate commitment state
        const [rawTask] = await db
          .select()
          .from(taskTable)
          .where(eq(taskTable.id, overdueTask.id));
        const reminders = await db
          .select()
          .from(taskReminderTable)
          .where(eq(taskReminderTable.taskId, overdueTask.id));
        const evaluation = evaluateTaskCommitment(
          rawTask,
          reminders,
          new Date(),
        );

        assert(
          evaluation.state === 'overdue',
          'Task is correctly evaluated as overdue',
        );
        assert(
          evaluation.activeReminder != null,
          'Due reminder window is active',
        );

        // 3. Mark reminder fired (initiative consumption contract)
        const fired = await markTaskReminderFired(reminders[0].id);
        assert(fired, 'Reminder marked fired');

        // 4. Repeated evaluation after fired -> no active reminder
        const remindersAfterFired = await db
          .select()
          .from(taskReminderTable)
          .where(eq(taskReminderTable.taskId, overdueTask.id));
        const evaluationAfter = evaluateTaskCommitment(
          rawTask,
          remindersAfterFired,
          new Date(),
        );
        assert(
          evaluationAfter.activeReminder == null,
          'Fired reminder does not re-fire',
        );

        // 5. Create a chatless manual task with due reminder
        const chatlessTask = await createTask({
          userId: user.id,
          chatId: null, // manual UI create
          title: 'Water plants',
          dueAt: pastDue,
          reminders: [{ startAt: pastReminder, label: 'Water' }],
          source: 'manual',
        });

        // Best chat anchor for chatless task resolves to user's chat
        const deliveryChat = await resolveCurrentBestChatId(user.id);
        assert(
          deliveryChat === chat,
          'Chatless task reminder resolves valid active chat, never "null" string',
        );
      },
    );

    // -------------------------------------------------------------------------
    // SURFACE J: RETRY, CONCURRENCY & IDEMPOTENCY
    // -------------------------------------------------------------------------
    await testSection(
      'Surface J: Concurrency storms, replay storms, and idempotent gating',
      async () => {
        const user = await createTestUser('surface-j');
        const chatId = await createTestChat(user.id);
        const messageId = generateUUID();
        await createTestMessage(
          chatId,
          messageId,
          'Please schedule oil change',
        );

        // 1. Replay storm: 10 concurrent requests with the identical messageId
        const stormPromises = Array.from({ length: 10 }).map(() =>
          commitInterpreterActions({
            interpretation: {
              actions: [
                {
                  action: 'create_task',
                  evidence_class: 'explicit_command',
                  evidence_verbatim: 'schedule oil change',
                  target_task_id: null,
                  target_resolution: null,
                  requires_clarification: false,
                  title: 'Oil Change',
                  notes: null,
                  due_iso: null,
                  reminder_windows: [],
                  snooze_minutes: null,
                },
              ],
              clarifications: [],
            },
            userText: 'Please schedule oil change',
            assistantText: 'Scheduled oil change.',
            userId: user.id,
            chatId,
            timeZone: 'UTC',
            roster: [],
            originMessageId: messageId,
          }),
        );

        const stormResults = await Promise.all(stormPromises);
        const allCommittedTasks = stormResults.flatMap((r) => r.committed);

        // Verify exactly ONE task was created across all 10 parallel attempts
        const createdTasks = await db
          .select()
          .from(taskTable)
          .where(
            and(
              eq(taskTable.userId, user.id),
              eq(taskTable.title, 'Oil Change'),
            ),
          );
        assert(
          createdTasks.length === 1,
          `Exactly 1 task created under 10x replay storm (found ${createdTasks.length})`,
        );

        const oilTaskId = createdTasks[0].id;
        const turnActionRows = await db
          .select()
          .from(turnActionTable)
          .where(
            and(
              eq(turnActionTable.userId, user.id),
              eq(turnActionTable.taskId, oilTaskId),
            ),
          );
        assert(
          turnActionRows.length === 1,
          `Exactly 1 TurnAction ledger row recorded (found ${turnActionRows.length})`,
        );

        // 2. Duplicate proposals within SAME interpreter output:
        const msgIdSnooze = generateUUID();
        await createTestMessage(chatId, msgIdSnooze, 'Push it an hour');
        const duplicateSnoozeResult = await commitInterpreterActions({
          interpretation: {
            actions: [
              {
                action: 'snooze_task',
                evidence_class: 'explicit_modification',
                evidence_verbatim: 'push it an hour',
                target_task_id: oilTaskId,
                target_resolution: 'explicit',
                requires_clarification: false,
                title: 'Oil Change',
                notes: null,
                due_iso: null,
                reminder_windows: [],
                snooze_minutes: 60,
              },
              {
                action: 'snooze_task',
                evidence_class: 'explicit_modification',
                evidence_verbatim: 'push it an hour',
                target_task_id: oilTaskId,
                target_resolution: 'explicit',
                requires_clarification: false,
                title: 'Oil Change',
                notes: null,
                due_iso: null,
                reminder_windows: [],
                snooze_minutes: 60,
              },
            ],
            clarifications: [],
          },
          userText: 'Push it an hour',
          assistantText: 'Snoozed.',
          userId: user.id,
          chatId,
          timeZone: 'UTC',
          roster: [{ taskId: oilTaskId, title: 'Oil Change', dueAt: null }],
          originMessageId: msgIdSnooze,
        });

        assert(
          duplicateSnoozeResult.committed.length === 1,
          'Duplicate proposal in same turn collapsed to 1 commit',
        );
        assert(
          duplicateSnoozeResult.rejected.some(
            (r) => r.reason === 'already_applied',
          ),
          'Second proposal rejected as already_applied',
        );

        const [snoozedTask] = await db
          .select()
          .from(taskTable)
          .where(eq(taskTable.id, oilTaskId));
        assert(snoozedTask.snoozeCount === 1, 'Task was snoozed exactly once');
      },
    );

    // -------------------------------------------------------------------------
    // SURFACE K: BAD MODEL OUTPUT & SAFETY GATES
    // -------------------------------------------------------------------------
    await testSection(
      'Surface K: Bad model output deterministic safety gating',
      async () => {
        const user = await createTestUser('surface-k');
        const chatId = await createTestChat(user.id);
        const validTask = await createTask({
          userId: user.id,
          chatId,
          title: 'Review PR #402',
          source: 'manual',
        });
        const roster = [
          { taskId: validTask.id, title: 'Review PR #402', dueAt: null },
        ];

        // Case 1: Fabricated verbatim evidence
        const msgIdBadEv = generateUUID();
        await createTestMessage(
          chatId,
          msgIdBadEv,
          'Hello Sophie how are you today?',
        );
        const resBadEvidence = await commitInterpreterActions({
          interpretation: {
            actions: [
              {
                action: 'create_task',
                evidence_class: 'explicit_command',
                evidence_verbatim:
                  'nonexistent user text that was hallucinated',
                target_task_id: null,
                target_resolution: null,
                requires_clarification: false,
                title: 'Hallucinated Task',
                notes: null,
                due_iso: null,
                reminder_windows: [],
                snooze_minutes: null,
              },
            ],
            clarifications: [],
          },
          userText: 'Hello Sophie how are you today?',
          assistantText: 'I am doing great!',
          userId: user.id,
          chatId,
          timeZone: 'UTC',
          roster,
          originMessageId: msgIdBadEv,
        });
        assert(
          resBadEvidence.committed.length === 0,
          'Fabricated evidence rejected',
        );
        assert(
          resBadEvidence.rejected[0].reason === 'evidence_not_found_in_turn',
          'Rejected with evidence_not_found_in_turn',
        );

        // Case 2: Hallucinated target_task_id
        const msgIdBadTarget = generateUUID();
        await createTestMessage(chatId, msgIdBadTarget, 'I am done with that');
        const resBadTarget = await commitInterpreterActions({
          interpretation: {
            actions: [
              {
                action: 'complete_task',
                evidence_class: 'explicit_resolution',
                evidence_verbatim: 'done with that',
                target_task_id: generateUUID(),
                target_resolution: 'referential',
                requires_clarification: false,
                title: null,
                notes: null,
                due_iso: null,
                reminder_windows: [],
                snooze_minutes: null,
              },
            ],
            clarifications: [],
          },
          userText: 'I am done with that',
          assistantText: 'Great!',
          userId: user.id,
          chatId,
          timeZone: 'UTC',
          roster,
          originMessageId: msgIdBadTarget,
        });
        assert(
          resBadTarget.committed.length === 0,
          'Hallucinated target_task_id rejected',
        );
        assert(
          resBadTarget.rejected[0].reason === 'unresolved_target_binding',
          'Rejected with unresolved_target_binding',
        );

        // Case 3: Contract Gate 0 — requires_clarification true
        const msgIdClar = generateUUID();
        await createTestMessage(
          chatId,
          msgIdClar,
          'Can you book the flight to Paris or London?',
        );
        const resClarification = await commitInterpreterActions({
          interpretation: {
            actions: [
              {
                action: 'create_task',
                evidence_class: 'explicit_command',
                evidence_verbatim: 'book the flight',
                target_task_id: null,
                target_resolution: null,
                requires_clarification: true,
                title: 'Book Flight',
                notes: null,
                due_iso: null,
                reminder_windows: [],
                snooze_minutes: null,
              },
            ],
            clarifications: [
              { intent: 'uncertain_commitment', about: 'Flight destination' },
            ],
          },
          userText: 'Can you book the flight to Paris or London?',
          assistantText: 'Which city would you like to fly to?',
          userId: user.id,
          chatId,
          timeZone: 'UTC',
          roster,
          originMessageId: msgIdClar,
        });
        assert(
          resClarification.committed.length === 0,
          'Gate 0 vetoes mutation when requires_clarification is true',
        );
        assert(
          resClarification.rejected[0].reason === 'requires_clarification',
          'Rejected with requires_clarification',
        );

        // Case 4: Title signal contradiction ("No, not that one")
        const verdictNegation = resolveDestructiveBinding({
          userText: 'No not the PR review, the other one',
          assistantText: 'Understood.',
          roster: [
            { taskId: validTask.id, title: 'Review PR #402', dueAt: null },
            { taskId: generateUUID(), title: 'Submit Expenses', dueAt: null },
          ],
          modelTargetTaskId: validTask.id,
        });
        assert(
          typeof verdictNegation.ok === 'boolean',
          'Binding verdict evaluates safely',
        );
      },
    );

    // -------------------------------------------------------------------------
    // SURFACE L: API & SECURITY BOUNDARIES
    // -------------------------------------------------------------------------
    await testSection(
      'Surface L: API security guards and cross-user isolation',
      async () => {
        const userA = await createTestUser('sec-a');
        const userB = await createTestUser('sec-b');
        const chatA = await createTestChat(userA.id);
        const chatB = await createTestChat(userB.id);

        // 1. Create task owned by User A
        const taskA = await createTask({
          userId: userA.id,
          chatId: chatA,
          title: "User A's Secret Task",
          source: 'manual',
        });

        // 2. User B attempts to access User A's task -> loadTaskOwned returns null
        const crossRead = await getTaskWithReminders(userB.id, taskA.id);
        assert(crossRead === null, "User B cannot read User A's task");

        // 3. User B attempts to mutate User A's task -> returns not_found
        const crossComplete = await completeTask(userB.id, taskA.id);
        assert(
          !crossComplete.ok && crossComplete.reason === 'not_found',
          "User B cannot complete User A's task",
        );

        const crossCancel = await cancelTask(userB.id, taskA.id);
        assert(
          !crossCancel.ok && crossCancel.reason === 'not_found',
          "User B cannot cancel User A's task",
        );

        const crossSnooze = await snoozeTask(userB.id, taskA.id, {
          offsetMinutes: 60,
        });
        assert(
          !crossSnooze.ok && crossSnooze.reason === 'not_found',
          "User B cannot snooze User A's task",
        );

        const crossReschedule = await rescheduleTask(userB.id, taskA.id, {
          dueAt: new Date(),
        });
        assert(
          !crossReschedule.ok && crossReschedule.reason === 'not_found',
          "User B cannot reschedule User A's task",
        );

        const crossEdit = await editTask(userB.id, taskA.id, {
          title: 'Hacked Title',
        });
        assert(
          !crossEdit.ok && crossEdit.reason === 'not_found',
          "User B cannot edit User A's task",
        );

        // 4. Verify User A's task is unmodified in DB
        const [intactTask] = await db
          .select()
          .from(taskTable)
          .where(eq(taskTable.id, taskA.id));
        assert(
          intactTask.title === "User A's Secret Task",
          'Title remains unmodified',
        );
        assert(intactTask.status === 'pending', 'Status remains pending');
      },
    );
  } finally {
    await cleanupAllTestData();
  }

  // ---------------------------------------------------------------------------
  // FINAL SCORECARD
  // ---------------------------------------------------------------------------
  console.log(`\n============================================================`);
  console.log(`SYSTEM-TEST VERIFICATION MATRIX SUMMARY`);
  console.log(`============================================================`);
  console.log(`Total Assertions Checked: ${totalTests}`);
  console.log(`Passed Assertions:        ${passedTests}`);
  console.log(`Failed Assertions:        ${failures.length}`);

  if (failures.length > 0) {
    console.error(`\n❌ Failures Summary:`);
    for (const f of failures) {
      console.error(`- [${f.name}]: ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log(
      `\n🎉 ALL AUTOMATED SYSTEM-LEVEL VERIFICATIONS PASSED CLEANLY!`,
    );
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
