import 'server-only';

import { and, desc, eq, inArray, isNull, lte, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db/queries';
import { cortexOutbox, type CortexOutboxRow } from '@/lib/db/schema';
import { honchoIds } from '@/lib/honcho';

/**
 * Durable app-side outbox for delivering user turns to the Synapse-Cortex
 * sidecar. Enqueue is a single idempotent INSERT; delivery is drained by an
 * asynchronous worker (Vercel cron) with exponential backoff, leases for
 * concurrency safety, and never drops a turn before it is delivered.
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
    enabled: Boolean(baseURL) && process.env.SYNAPSE_CORTEX_ENABLED !== 'false',
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

export type DeliveryAction = 'delivered' | 'retry' | 'dead';

export function decideDelivery(
  statusCode: number | null,
  error: unknown,
): DeliveryAction {
  if (typeof statusCode === 'number') {
    if (statusCode === 200 || statusCode === 202) return 'delivered';
    if (statusCode === 401 || statusCode === 403) return 'dead'; // config
    return 'retry';
  }
  // Transport-level failure (timeout, refused, DNS) or thrown error.
  if (error instanceof Error) {
    if (/unauthor/i.test(error.message) || /forbidden/i.test(error.message)) {
      return 'dead';
    }
  }
  return 'retry';
}

// ── Enqueue (fast, idempotent) ──────────────────────────────────────────────

export async function enqueueCortexTurn(input: OutboxEnqueueInput) {
  const config = cortexConfig();
  if (!config.enabled || !config.baseURL) {
    return { queued: false as const, reason: 'disabled' as const };
  }
  const ids = honchoIds(input.userId, input.chatId);
  await db
    .insert(cortexOutbox)
    .values({
      workspaceId: ids.workspaceId,
      sessionId: ids.sessionId,
      honchoMessageId: input.honchoMessageId,
      peerId: ids.userPeerId,
      text: input.text,
      timezone: input.timezone ?? process.env.ASH_TIME_ZONE ?? 'Europe/London',
    })
    .onConflictDoNothing({ target: cortexOutbox.honchoMessageId });
  return { queued: true as const };
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
    | 'workspaceId'
    | 'sessionId'
    | 'honchoMessageId'
    | 'peerId'
    | 'text'
    | 'timezone'
  >,
  opts: { post?: typeof fetch; now?: Date } = {},
): Promise<DeliveryObservation> {
  const config = cortexConfig();
  if (!config.enabled || !config.baseURL) {
    return {
      action: 'dead',
      statusCode: null,
      degraded: false,
      error: 'disabled',
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
    return {
      action: decideDelivery(null, error),
      statusCode,
      degraded: false,
      error,
    };
  }
  const action = decideDelivery(statusCode, null);
  const degraded =
    (payload?.context as Record<string, unknown> | undefined)?.status ===
      'degraded' || payload?.extraction_backend === 'failed';
  return { action, statusCode, degraded, error: null };
}

function dueFilter(now: Date) {
  return and(
    inArray(cortexOutbox.status, ['pending', 'retrying']),
    or(
      isNull(cortexOutbox.nextAttemptAt),
      lte(cortexOutbox.nextAttemptAt, now),
    ),
    or(isNull(cortexOutbox.lockedUntil), lt(cortexOutbox.lockedUntil, now)),
  );
}

// ── Worker sweep ────────────────────────────────────────────────────────────

export async function sweepDueCortexOutbox(
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
    .from(cortexOutbox)
    .where(dueFilter(now))
    .orderBy(desc(cortexOutbox.createdAt))
    .limit(limit)
    .for('update');

  const summary = { processed: 0, delivered: 0, retried: 0, dead: 0 };

  for (const row of rows) {
    summary.processed += 1;
    const attempts = row.attempts + 1;
    await db
      .update(cortexOutbox)
      .set({
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        attempts,
        lastAttemptAt: now,
      })
      .where(eq(cortexOutbox.id, row.id));

    const observation = await deliverOnce(row, { post: opts.post, now });

    if (observation.action === 'delivered' || observation.action === 'dead') {
      await db
        .update(cortexOutbox)
        .set(
          observation.action === 'delivered'
            ? {
                status: 'delivered',
                deliveredAt: now,
                lastStatusCode: observation.statusCode,
                degradedDelivery: observation.degraded,
                lockedUntil: null,
              }
            : {
                status: 'dead',
                lockedUntil: null,
                lastStatusCode: observation.statusCode,
                lastError: observation.error
                  ? String(observation.error)
                  : 'permanent_delivery_failure',
              },
        )
        .where(eq(cortexOutbox.id, row.id));
      if (observation.action === 'delivered') summary.delivered += 1;
      else summary.dead += 1;
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
