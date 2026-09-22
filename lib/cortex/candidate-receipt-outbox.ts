import 'server-only';

import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db/queries';
import {
  cortexCandidateReceiptOutbox,
  type CortexCandidateReceiptOutboxRow,
} from '@/lib/db/schema';
import { cortexConfig, nextBackoffMs } from '@/lib/cortex/outbox';
import { honchoIds } from '@/lib/honcho';

const LEASE_MS = 120_000;
const DEFAULT_LIMIT = 25;

export type RuntimeCandidateReference = {
  candidate_id: string;
  candidate_version: string;
  source: string;
};

export type CandidateDeliveryInput = {
  userId: string;
  chatId: string;
  assistantMessageId: string;
  decisionId: string;
  turnId: string;
  occurredAt: Date;
  candidateRefs: RuntimeCandidateReference[];
};

function deliveryReceiptId(input: {
  decisionId: string;
  candidateId: string;
}): string {
  const digest = createHash('sha256')
    .update(`${input.decisionId}\u0000${input.candidateId}\u0000delivered`)
    .digest('hex')
    .slice(0, 32);
  return `receipt_${digest}`;
}

/**
 * Enqueue only after the assistant message is canonically persisted. Reads,
 * prompt inclusion, and Runtime selection alone are not product delivery.
 */
export async function enqueueCandidateDeliveryReceipts(
  input: CandidateDeliveryInput,
  opts: { database?: Pick<typeof db, 'insert'> } = {},
) {
  if (input.candidateRefs.length === 0) {
    return { queued: false as const, inserted: 0 };
  }
  const config = cortexConfig();
  if (!config.enabled || !config.baseURL) {
    return { queued: false as const, inserted: 0 };
  }
  const ids = honchoIds(input.userId, input.chatId);
  const rows = input.candidateRefs.map((candidate) => ({
    receiptId: deliveryReceiptId({
      decisionId: input.decisionId,
      candidateId: candidate.candidate_id,
    }),
    decisionId: input.decisionId,
    turnId: input.turnId,
    candidateId: candidate.candidate_id,
    candidateVersion: candidate.candidate_version,
    workspaceId: ids.workspaceId,
    ownerPeerId: ids.userPeerId,
    assistantMessageId: input.assistantMessageId,
    occurredAt: input.occurredAt,
  }));
  const database = opts.database ?? db;
  const inserted = await database
    .insert(cortexCandidateReceiptOutbox)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: cortexCandidateReceiptOutbox.id });
  return { queued: true as const, inserted: inserted.length };
}

type DueRow = {
  status?: string;
  nextAttemptAt?: Date | null;
  lockedUntil?: Date | null;
};

export function isCandidateReceiptDue(row: DueRow, now: Date): boolean {
  if (row.status !== 'pending' && row.status !== 'retrying') return false;
  if (row.nextAttemptAt != null && row.nextAttemptAt > now) return false;
  if (row.lockedUntil != null && row.lockedUntil >= now) return false;
  return true;
}

export function decideCandidateReceiptDelivery(
  statusCode: number | null,
  error: unknown,
) {
  if (statusCode === 200 || statusCode === 202) return 'delivered' as const;
  // Authentication, validation, ownership/version conflicts and missing
  // candidates cannot heal through automatic retries. Quarantine them for
  // explicit inspection/requeue instead of hammering Cortex forever.
  if (
    statusCode === 400 ||
    statusCode === 401 ||
    statusCode === 403 ||
    statusCode === 404 ||
    statusCode === 409 ||
    statusCode === 410 ||
    statusCode === 422
  ) {
    return 'blocked' as const;
  }
  if (
    error instanceof Error &&
    (/unauthor/i.test(error.message) || /forbidden/i.test(error.message))
  ) {
    return 'blocked' as const;
  }
  return 'retry' as const;
}

function dueSqlCondition(now: Date) {
  return and(
    inArray(cortexCandidateReceiptOutbox.status, ['pending', 'retrying']),
    or(
      isNull(cortexCandidateReceiptOutbox.nextAttemptAt),
      lte(cortexCandidateReceiptOutbox.nextAttemptAt, now),
    ),
    or(
      isNull(cortexCandidateReceiptOutbox.lockedUntil),
      lt(cortexCandidateReceiptOutbox.lockedUntil, now),
    ),
  );
}

export async function deliverCandidateReceiptOnce(
  row: Pick<
    CortexCandidateReceiptOutboxRow,
    | 'receiptId'
    | 'decisionId'
    | 'turnId'
    | 'candidateId'
    | 'candidateVersion'
    | 'workspaceId'
    | 'ownerPeerId'
    | 'assistantMessageId'
    | 'occurredAt'
  >,
  opts: { post?: typeof fetch } = {},
) {
  const config = cortexConfig();
  if (!config.enabled || !config.baseURL) {
    return {
      action: 'blocked' as const,
      statusCode: null,
      error: 'cortex_disabled',
    };
  }
  const post = opts.post ?? fetch;
  let statusCode: number | null = null;
  try {
    const response = await post(
      `${config.baseURL}/v1/cortex/candidate-receipts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify({
          contract_version: 'candidate-receipts-v1',
          workspace_id: row.workspaceId,
          owner_peer_id: row.ownerPeerId,
          receipts: [
            {
              receipt_id: row.receiptId,
              decision_id: row.decisionId,
              turn_id: row.turnId,
              candidate_id: row.candidateId,
              candidate_version: row.candidateVersion,
              stage: 'delivered',
              channel: 'inbound',
              occurred_at: row.occurredAt.toISOString(),
              assistant_message_id: row.assistantMessageId,
              // Delivery alone does not prove that Sophie asked a question.
              effect: null,
            },
          ],
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
        cache: 'no-store',
      },
    );
    statusCode = response.status;
    return {
      action: decideCandidateReceiptDelivery(statusCode, null),
      statusCode,
      error: null,
    };
  } catch (error) {
    return {
      action: decideCandidateReceiptDelivery(null, error),
      statusCode,
      error,
    };
  }
}

export async function sweepDueCandidateReceiptOutbox(
  opts: {
    limit?: number;
    post?: typeof fetch;
    now?: Date;
  } = {},
) {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await db
    .select()
    .from(cortexCandidateReceiptOutbox)
    .where(dueSqlCondition(now))
    .orderBy(asc(cortexCandidateReceiptOutbox.createdAt))
    .limit(limit);
  const summary = { processed: 0, delivered: 0, retried: 0, blocked: 0 };

  for (const row of rows) {
    const attempts = row.attempts + 1;
    const claimed = await db
      .update(cortexCandidateReceiptOutbox)
      .set({
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        attempts,
        lastAttemptAt: now,
      })
      .where(
        and(eq(cortexCandidateReceiptOutbox.id, row.id), dueSqlCondition(now)),
      )
      .returning({ id: cortexCandidateReceiptOutbox.id });
    if (claimed.length === 0) continue;
    summary.processed += 1;
    const observation = await deliverCandidateReceiptOnce(row, {
      post: opts.post,
    });
    if (observation.action === 'delivered') {
      await db
        .update(cortexCandidateReceiptOutbox)
        .set({
          status: 'delivered',
          deliveredAt: now,
          lastStatusCode: observation.statusCode,
          lockedUntil: null,
        })
        .where(eq(cortexCandidateReceiptOutbox.id, row.id));
      summary.delivered += 1;
    } else if (observation.action === 'blocked') {
      await db
        .update(cortexCandidateReceiptOutbox)
        .set({
          status: 'blocked',
          lockedUntil: null,
          nextAttemptAt: null,
          lastStatusCode: observation.statusCode,
          lastError: observation.error
            ? String(observation.error)
            : 'cortex_configuration_failure',
        })
        .where(eq(cortexCandidateReceiptOutbox.id, row.id));
      summary.blocked += 1;
    } else {
      await db
        .update(cortexCandidateReceiptOutbox)
        .set({
          status: 'retrying',
          lockedUntil: null,
          nextAttemptAt: new Date(now.getTime() + nextBackoffMs(attempts)),
          lastStatusCode: observation.statusCode,
          lastError: observation.error ? String(observation.error) : null,
        })
        .where(eq(cortexCandidateReceiptOutbox.id, row.id));
      summary.retried += 1;
    }
  }
  return summary;
}

export async function requeueBlockedCandidateReceiptOutbox() {
  const rows = await db
    .select({ id: cortexCandidateReceiptOutbox.id })
    .from(cortexCandidateReceiptOutbox)
    .where(eq(cortexCandidateReceiptOutbox.status, 'blocked'));
  if (rows.length === 0) return { requeued: 0 };
  const result = await db
    .update(cortexCandidateReceiptOutbox)
    .set({
      status: 'pending',
      attempts: 0,
      lockedUntil: null,
      nextAttemptAt: null,
      lastError: null,
      lastStatusCode: null,
    })
    .where(
      inArray(
        cortexCandidateReceiptOutbox.id,
        rows.map((row) => row.id),
      ),
    )
    .returning({ id: cortexCandidateReceiptOutbox.id });
  return { requeued: result.length };
}
