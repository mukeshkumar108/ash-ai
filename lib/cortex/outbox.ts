import 'server-only';

import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { db } from '@/lib/db/queries';
import { cortexOutbox, type CortexOutboxRow } from '@/lib/db/schema';
import { honchoIds } from '@/lib/honcho';

/**
 * Durable app-side outbox for delivering user turns to the Synapse-Cortex
 * sidecar. Enqueue is a single idempotent INSERT; delivery is drained by an
 * asynchronous worker (Vercel cron) with exponential backoff, lease-based
 * concurrency safety (compare-and-set claim), and never drops a turn before it
 * is delivered.
 *
 * Recoverability invariant: a canonical conversation event, once enqueued, is
 * its responsibility to process. Temporary infrastructure/configuration
 * failure (auth, disabled Cortex) shelves the row in a *blocked* quarantine
 * that is observable and explicitly requeueable after configuration repair —
 * it is never terminal dead state.
 */

const BACKOFF_BASE_MS = 10_000;
const BACKOFF_CAP_MS = 86_400_000; // 24h
const BACKOFF_JITTER = 0.3;
const LEASE_MS = 120_000;
const DEFAULT_LIMIT = 25;

export type OutboxEnqueueInput = {
  userId: string;
  chatId: string;
  honchoMessageId: string;
  text: string;
  timezone?: string;
};

export function cortexConfig() {
  const baseURL = process.env.SYNAPSE_CORTEX_URL?.trim().replace(/\/$/u, '');
  return {
    enabled:
      Boolean(baseURL) && process.env.SYNAPSE_CORTEX_ENABLED !== 'false',
    baseURL,
    token: process.env.SYNAPSE_CORTEX_API_TOKEN?.trim(),
    timeoutMs: Number(process.env.SYNAPSE_CORTEX_INGEST_TIMEOUT_MS ?? 20_000),
  };
}

// ── Pure policy (unit-testable without DB/fetch) ────────────────────────────

export function nextBackoffMs(attempts: number): number {
  const exp = Math.min(
    BACKOFF_CAP_MS,
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
  );
  return Math.round(exp * (1 + Math.random() * BACKOFF_JITTER));
}

export type DeliveryAction = 'delivered' | 'retry' | 'blocked';

export function decideDelivery(
  statusCode: number | null,
  error: unknown,
): DeliveryAction {
  if (typeof statusCode === 'number') {
    if (statusCode === 200 || statusCode === 202) return 'delivered';
    // Recoverable configuration failure: shelve, do not hammer. Not terminal.
    if (statusCode === 401 || statusCode === 403) return 'blocked';
    return 'retry';
  }
  if (error instanceof Error) {
    if (/unauthor/i.test(error.message) || /forbidden/i.test(error.message)) {
      return 'blocked';
    }
  }
  return 'retry';
}

type DueRow = {
  status?: string;
  nextAttemptAt?: Date | null;
  lockedUntil?: Date | null;
};

/**
 * Single predicate governing both the pick query and the compare-and-set claim.
 * A row is due when it is pending/retrying, its backoff deadline has passed,
 * and no live worker lease is held. Delivered and blocked rows are never due.
 */
export function isRowDue(row: DueRow, now: Date): boolean {
  if (row.status !== 'pending' && row.status !== 'retrying') return false;
  if (row.nextAttemptAt != null && row.nextAttemptAt > now) return false;
  if (row.lockedUntil != null && row.lockedUntil >= now) return false;
  return true;
}

function dueSqlCondition(now: Date) {
  return and(
    inArray(cortexOutbox.status, ['pending', 'retrying']),
    or(isNull(cortexOutbox.nextAttemptAt), lte(cortexOutbox.nextAttemptAt, now)),
    or(isNull(cortexOutbox.lockedUntil), lt(cortexOutbox.lockedUntil, now)),
  );
}

// ── Enqueue (fast, idempotent) ──────────────────────────────────────────────

export async function enqueueCortexTurn(input: OutboxEnqueueInput) {
  const config = cortexConfig();
  if (!config.enabled || !config.baseURL) {
    return { queued: false as const, reason: 'disabled' as const };
  }
  const ids = honchoIds(input.userId, input.chatId);
  const inserted = await db
    .insert(cortexOutbox)
    .values({
      workspaceId: ids.workspaceId,
      sessionId: ids.sessionId,
      honchoMessageId: input.honchoMessageId,
      peerId: ids.userPeerId,
      text: input.text,
      timezone: input.timezone ?? process.env.ASH_TIME_ZONE ?? 'Europe/London',
    })
    .onConflictDoNothing({ target: cortexOutbox.honchoMessageId })
    .returning({ id: cortexOutbox.id });
  return { queued: true as const, inserted: inserted.length === 1 };
}

// ── Delivery core (real HTTP, injectable for tests) ────────────────────────

export type DeliveryObservation = {
  action: DeliveryAction;
  statusCode: number | null;
  degraded: boolean;
  error?: unknown;
};

export async function deliverOnce(
  row: Pick<
    CortexOutboxRow,
    'workspaceId' | 'sessionId' | 'honchoMessageId' | 'peerId' | 'text' | 'timezone'
  >,
  opts: { post?: typeof fetch; now?: Date } = {},
): Promise<DeliveryObservation> {
  const config = cortexConfig();
  if (!config.enabled || !config.baseURL) {
    return {
      action: 'blocked',
      statusCode: null,
      degraded: false,
      error: 'cortex_disabled',
    };
  }
  const post = opts.post ?? fetch;
  const body = JSON.stringify({
    workspace_id: row.workspaceId,
    session_id: row.sessionId,
    honcho_message_id: row.honchoMessageId,
    peer_id: row.peerId,
    text: row.text,
    now: (opts.now ?? new Date()).toISOString(),
    timezone: row.timezone,
  });
  let statusCode: number | null = null;
  let payload: Record<string, unknown> | null = null;
  try {
    const response = await post(`${config.baseURL}/v1/events/turn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: 'no-store',
    });
    statusCode = response.status;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  } catch (error) {
    return { action: decideDelivery(null, error), statusCode, degraded: false, error };
  }
  const action = decideDelivery(statusCode, null);
  const degraded =
    (payload?.context as Record<string, unknown> | undefined)?.status ===
      'degraded' ||
    payload?.extraction_backend === 'failed';
  return { action, statusCode, degraded, error: null };
}

// ── Worker sweep ────────────────────────────────────────────────────────────

export async function sweepDueCortexOutbox(opts: {
  limit?: number;
  post?: typeof fetch;
  now?: Date;
} = {}) {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const rows = await db
    .select()
    .from(cortexOutbox)
    .where(dueSqlCondition(now))
    .orderBy(asc(cortexOutbox.createdAt))
    .limit(limit);

  const summary = { processed: 0, delivered: 0, retried: 0, blocked: 0 };

  for (const row of rows) {
    // Compare-and-set claim: only a row that is still pending/retrying and has
    // no live lease is claimed (atomic per-row in Postgres), so overlapping
    // cron workers cannot double-claim the same row.
    const attempts = row.attempts + 1;
    const claimed = await db
      .update(cortexOutbox)
      .set({
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        attempts,
        lastAttemptAt: now,
      })
      .where(and(eq(cortexOutbox.id, row.id), dueSqlCondition(now)))
      .returning({ id: cortexOutbox.id });
    if (claimed.length === 0) continue;
    summary.processed += 1;

    const observation = await deliverOnce(row, { post: opts.post, now });

    if (observation.action === 'delivered') {
      await db
        .update(cortexOutbox)
        .set({
          status: 'delivered',
          deliveredAt: now,
          lastStatusCode: observation.statusCode,
          degradedDelivery: observation.degraded,
          lockedUntil: null,
        })
        .where(eq(cortexOutbox.id, row.id));
      summary.delivered += 1;
    } else if (observation.action === 'blocked') {
      // Recoverable quarantine: not retried automatically, observable, and
      // explicitly requeued once Cortex configuration is repaired.
      await db
        .update(cortexOutbox)
        .set({
          status: 'blocked',
          lockedUntil: null,
          nextAttemptAt: null,
          lastStatusCode: observation.statusCode,
          lastError: observation.error
            ? String(observation.error)
            : 'cortex_configuration_failure',
        })
        .where(eq(cortexOutbox.id, row.id));
      summary.blocked += 1;
    } else {
      const nextAttempt = new Date(now.getTime() + nextBackoffMs(attempts));
      await db
        .update(cortexOutbox)
        .set({
          status: 'retrying',
          lockedUntil: null,
          nextAttemptAt: nextAttempt,
          lastStatusCode: observation.statusCode,
          lastError: observation.error ? String(observation.error) : null,
        })
        .where(eq(cortexOutbox.id, row.id));
      summary.retried += 1;
    }
  }

  return summary;
}

// ── Blocked quarantine recovery ─────────────────────────────────────────────

export async function requeueBlockedCortexOutbox() {
  const rows = await db
    .select()
    .from(cortexOutbox)
    .where(eq(cortexOutbox.status, 'blocked'));
  if (rows.length === 0) {
    return { requeued: 0 };
  }
  const ids = rows.map((row) => row.id);
  const result = await db
    .update(cortexOutbox)
    .set({
      status: 'pending',
      attempts: 0,
      lockedUntil: null,
      nextAttemptAt: null,
      lastError: null,
      lastStatusCode: null,
    })
    .where(inArray(cortexOutbox.id, ids))
    .returning({ id: cortexOutbox.id });
  return { requeued: result.length };
}