/**
 * Cortex outbox reliability tests (pure predicates + delivery core, mocked HTTP).
 * DB-backed enqueue/sweep is exercised against production in the deploy step.
 *
 * Run: pnpm exec tsx scripts/cortex-outbox-test.ts
 */
import {
  cortexConfig,
  decideDelivery,
  deliverOnce,
  isRowDue,
  nextBackoffMs,
} from '@/lib/cortex/outbox';

process.env.SYNAPSE_CORTEX_URL = 'https://cortex.test';
process.env.SYNAPSE_CORTEX_ENABLED = 'true';
process.env.SYNAPSE_CORTEX_API_TOKEN = 'test-token';

let failures = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok: ${message}`);
  }
}

function run() {
  console.log('cortex-outbox-test');

  // ── Backoff ──
  const b1 = nextBackoffMs(1);
  const b2 = nextBackoffMs(2);
  const b10 = nextBackoffMs(10);
  assert(b1 >= 10_000 && b1 <= 13_000, `backoff(1) in [10s,13s] (got ${b1})`);
  assert(b2 >= b1 && b2 <= 26_000, `backoff(2) >= backoff(1) (got ${b2})`);
  assert(b10 <= 86_400_000, `backoff(10) capped at 24h (got ${b10})`);

  // ── Recoverable blocked (not terminal dead) on config failures ──
  assert(decideDelivery(200, null) === 'delivered', '200 -> delivered');
  assert(decideDelivery(202, null) === 'delivered', '202 -> delivered');
  assert(decideDelivery(401, null) === 'blocked', '401 -> blocked (recoverable)');
  assert(decideDelivery(403, null) === 'blocked', '403 -> blocked (recoverable)');
  assert(decideDelivery(429, null) === 'retry', '429 -> retry');
  assert(decideDelivery(500, null) === 'retry', '500 -> retry');
  assert(decideDelivery(404, null) === 'retry', '404 -> retry (indefinite)');
  assert(
    decideDelivery(null, new Error('Unauthorized')) === 'blocked',
    'auth error (no status) -> blocked',
  );
  assert(
    decideDelivery(null, new Error('fetch failed: connect')) === 'retry',
    'connectivity error -> retry',
  );

  // ── Lease reclamation after a crashed worker ──
  const now = new Date('2026-08-23T12:00:00Z');
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 60_000);
  assert(
    isRowDue({ status: 'retrying', lockedUntil: past, nextAttemptAt: past }, now),
    'stale lease (crashed worker) + due backoff -> claimable',
  );
  assert(
    !isRowDue({ status: 'retrying', lockedUntil: future, nextAttemptAt: past }, now),
    'live lease -> not claimable by overlapping worker',
  );
  assert(
    isRowDue({ status: 'retrying', lockedUntil: null, nextAttemptAt: past }, now),
    'cleared lease + due backoff -> claimable',
  );

  // ── Overlapping cron workers cannot double-process ──
  // The claim is compare-and-set on the same predicate: a row already leased by
  // worker A (lockedUntil >= now) fails worker B's claim.
  assert(
    !isRowDue({ status: 'pending', lockedUntil: now, nextAttemptAt: null }, now),
    'row leased exactly at claim time -> excluded',
  );
  assert(
    !isRowDue({ status: 'pending', lockedUntil: future, nextAttemptAt: null }, now),
    'row leased by other worker -> excluded from claim',
  );

  // ── Pending/retry survive restart/deploy ──
  assert(
    isRowDue({ status: 'pending', nextAttemptAt: null, lockedUntil: null }, now),
    'pending (after deploy) with no backoff -> processable',
  );
  assert(
    isRowDue({ status: 'retrying', nextAttemptAt: past, lockedUntil: null }, now),
    'retrying row survives restart and is due again',
  );

  // ── Idempotent duplicates ──
  assert(
    !isRowDue({ status: 'delivered', nextAttemptAt: null, lockedUntil: null }, now),
    'delivered row never re-selected',
  );
  assert(
    !isRowDue({ status: 'blocked', nextAttemptAt: null, lockedUntil: null }, now),
    'blocked row not auto-retried (must be requeued)',
  );
  assert(
    isRowDue({ status: 'pending', nextAttemptAt: null, lockedUntil: null }, now),
    'after explicit requeue (blocked->pending) row is processable again',
  );

  // ── DeliverOnce with real path semantics ──
  const row = {
    workspaceId: 'ws',
    sessionId: 's',
    honchoMessageId: 'm1',
    appMessageId: null,
    peerId: 'user',
    text: 'hello',
    timezone: 'Europe/London',
  };

  (async () => {
    const okPost = (async () => ({
      ok: true,
      status: 202,
      json: async () => ({
        context: { status: 'ok', honcho_status: 'ok' },
        extraction_backend: 'model',
      }),
    }) as Response) as typeof fetch;
    const delivered = await deliverOnce(row, { post: okPost, now });
    assert(
      delivered.action === 'delivered' && delivered.degraded === false,
      'healthy 202 -> delivered, not degraded',
    );

    const degradedPost = (async () => ({
      ok: true,
      status: 202,
      json: async () => ({
        context: { status: 'degraded', honcho_status: 'unavailable' },
        extraction_backend: 'model',
      }),
    }) as Response) as typeof fetch;
    const degraded = await deliverOnce(row, { post: degradedPost, now });
    assert(
      degraded.action === 'delivered' && degraded.degraded === true,
      '202 with degraded context -> delivered + degraded flagged',
    );

    const failingPost = (async () => {
      throw new Error('fetch failed: connection refused');
    }) as typeof fetch;
    const failed = await deliverOnce(row, { post: failingPost, now });
    assert(failed.action === 'retry' && failed.statusCode === null, 'transport -> retry');

    const authPost = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    }) as Response) as typeof fetch;
    const auth = await deliverOnce(row, { post: authPost, now });
    assert(
      auth.action === 'blocked' && auth.statusCode === 401,
      '401 -> blocked (quarantine, requeueable)',
    );

    if (failures > 0) {
      console.error(`cortex-outbox-test: ${failures} failure(s)`);
      process.exit(1);
    }
    console.log('cortex-outbox-test: all assertions passed');
    process.exit(0);
  })().catch((error) => {
    console.error('cortex-outbox-test: fatal', error);
    process.exit(1);
  });

  void cortexConfig;
}

run();