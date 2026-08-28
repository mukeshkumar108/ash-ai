/**
 * Checkpoint 3 — fast/slow Cortex reconciliation acceptance harness.
 *
 * Proves, through the real production outbox path (enqueue → durable row →
 * deliverOnce → materialized_actions payload), that the fast path's committed
 * actions reconcile with the delayed slow Cortex pass.
 *
 * Run: pnpm exec tsx scripts/tasks-reconciliation-test.ts
 */
import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.SYNAPSE_CORTEX_URL = 'https://cortex.test';
process.env.SYNAPSE_CORTEX_ENABLED = 'true';
process.env.SYNAPSE_CORTEX_API_TOKEN = 'test-token';

import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import {
  chat as chatTable,
  cortexOutbox as cortexOutboxTable,
  message as messageTable,
  user as userTable,
} from '@/lib/db/schema';
import {
  createTask,
  getTaskWithReminders,
  listTasksForUser,
} from '@/lib/tasks/domain';
import { recordTurnAction } from '@/lib/tasks/turn-actions';
import { deliverOnce, enqueueCortexTurn } from '@/lib/cortex/outbox';

let failures = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok: ${message}`);
  }
}

function capturingPost(captured: Array<{ url: string; body: unknown }>) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return {
      ok: true,
      status: 202,
      json: async () => ({ context: { status: 'ok' }, extraction_backend: 'model' }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

async function main() {
  const userId = randomUUID();
  const chatId = randomUUID();
  await db.insert(userTable).values({ id: userId, email: `recon-${userId}@test.local` });
  await db.insert(chatTable).values({ id: chatId, userId, title: 'recon chat', createdAt: new Date() });
  const outboxIds: string[] = [];

  try {
    // 1+5. fast create + delayed slow pass -> one commitment; app message id
    // travels through the production outbox row AND resolves the committed
    // actions at delivery time.
    const appMessageId = randomUUID();
    await db.insert(messageTable).values({
      id: appMessageId, chatId, role: 'user',
      parts: [{ type: 'text', text: 'remind me tomorrow to call Mum' }],
      attachments: [], createdAt: new Date(),
    });
    const task = await createTask({
      userId, chatId, title: 'Call Mum', dueAt: new Date(Date.now() + 24 * 3_600_000),
      originMessageId: appMessageId, originEvidence: 'remind me tomorrow to call Mum',
    });
    const enqueued = await enqueueCortexTurn({
      userId, chatId, honchoMessageId: `honcho-${appMessageId}`,
      appMessageId, text: 'remind me tomorrow to call Mum',
    });
    assert(enqueued.queued === true && enqueued.inserted === true, 'turn enqueued');
    const [outboxRow] = await db
      .select()
      .from(cortexOutboxTable)
      .where(eq(cortexOutboxTable.honchoMessageId, `honcho-${appMessageId}`));
    outboxIds.push(outboxRow.id);
    assert(outboxRow.appMessageId === appMessageId, 'app_message_id stored on the durable outbox row');

    // Duplicate enqueue of the same honcho message is a no-op (idempotent).
    const dup = await enqueueCortexTurn({
      userId, chatId, honchoMessageId: `honcho-${appMessageId}`,
      appMessageId, text: 'remind me tomorrow to call Mum',
    });
    assert(dup.queued === true && dup.inserted === false, 'duplicate enqueue is idempotent (no second row)');
    const rowCount = await db
      .select()
      .from(cortexOutboxTable)
      .where(eq(cortexOutboxTable.honchoMessageId, `honcho-${appMessageId}`));
    assert(rowCount.length === 1, 'exactly one outbox row for the message');

    // Delivery happens later (the fast path committed above). The payload must
    // carry the created action as materialized_actions with app_task object id
    // and the verbatim evidence, so the slow watcher suppresses its own dup.
    const captured: Array<{ url: string; body: unknown }> = [];
    const first = await deliverOnce(outboxRow, { post: capturingPost(captured) });
    assert(first.action === 'delivered', 'delivery delivered');
    const payload = captured[0]?.body as {
      materialized_actions: Array<{
        action: string;
        source_system: string;
        object_id: string;
        evidence_span: string | null;
      }>;
    };
    assert(
      payload.materialized_actions.length === 1 &&
        payload.materialized_actions[0].action === 'created' &&
        payload.materialized_actions[0].source_system === 'app_task' &&
        payload.materialized_actions[0].object_id === task.id &&
        payload.materialized_actions[0].evidence_span === 'remind me tomorrow to call Mum',
      'delayed slow pass receives the fast commit (created/object_id/evidence)',
    );

    // 4. retry of delivery converges: repeat delivery yields the SAME actions.
    const captured2: Array<{ url: string; body: unknown }> = [];
    await deliverOnce(outboxRow, { post: capturingPost(captured2) });
    const payload2 = captured2[0]?.body as {
      materialized_actions: unknown[];
    };
    assert(
      payload2.materialized_actions.length === 1 &&
        JSON.stringify(payload2.materialized_actions) ===
          JSON.stringify(payload.materialized_actions),
      'retried delivery converges to the same materialized actions (no duplication)',
    );

    // 2. fast completion + delayed slow pass -> completed action suppressed.
    const appMessageId2 = randomUUID();
    const task2 = await createTask({ userId, chatId, title: 'Send the form', dueAt: new Date(Date.now() + 48 * 3_600_000) });
    await recordTurnAction({
      userId, messageId: appMessageId2, taskId: task2.id, action: 'completed',
      evidenceText: 'I sent the form',
    });
    await enqueueCortexTurn({
      userId, chatId, honchoMessageId: `honcho-${appMessageId2}`,
      appMessageId: appMessageId2, text: 'I sent the form',
    });
    const [outboxRow2] = await db
      .select()
      .from(cortexOutboxTable)
      .where(eq(cortexOutboxTable.honchoMessageId, `honcho-${appMessageId2}`));
    outboxIds.push(outboxRow2.id);
    const captured3: Array<{ url: string; body: unknown }> = [];
    await deliverOnce(outboxRow2, { post: capturingPost(captured3) });
    const payload3 = captured3[0]?.body as { materialized_actions: Array<{ action: string; object_id: string }> };
    assert(
      payload3.materialized_actions.some(
        (a) => a.action === 'completed' && a.object_id === task2.id,
      ),
      'completed fast action reported so the slow pass reflects resolved state',
    );
    assert(
      task2 && (await getTaskWithReminders(userId, task2.id))?.status === 'pending',
      'completed report is reconciliation metadata, not a canonical re-mutation',
    );

    // 3. promoted Cortex candidate -> exactly one canonical Task (idempotent).
    const candidateKey = `recon_candidate_${randomUUID()}`;
    const promoted = await createTask({ userId, chatId, title: 'Renew passport', materializedCandidateKey: candidateKey });
    const promotedRetry = await createTask({ userId, chatId: null, title: 'Renew passport', materializedCandidateKey: candidateKey });
    const candidateTasks = (await listTasksForUser(userId)).filter(
      (t) => t.materializedCandidateKey === candidateKey,
    );
    assert(promoted.id === promotedRetry.id, 'candidate promotion returns the same Task');
    assert(candidateTasks.length === 1, 'promoted Cortex candidate -> exactly one Task');
  } finally {
    await db
      .delete(cortexOutboxTable)
      .where(eq(cortexOutboxTable.id, outboxIds[0]))
      .catch(() => undefined);
    await db
      .delete(cortexOutboxTable)
      .where(eq(cortexOutboxTable.id, outboxIds[1]))
      .catch(() => undefined);
    for (const id of outboxIds) {
      await db.delete(cortexOutboxTable).where(eq(cortexOutboxTable.id, id)).catch(() => undefined);
    }
    await db.delete(messageTable).where(eq(messageTable.chatId, chatId)).catch(() => undefined);
    await db.delete(chatTable).where(eq(chatTable.id, chatId)).catch(() => undefined);
    await db.delete(userTable).where(eq(userTable.id, userId)).catch(() => undefined);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nall reconciliation acceptance tests passed');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});