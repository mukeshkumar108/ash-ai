/**
 * Cortex outbox unit tests (pure policy + delivery core with mocked HTTP).
 * DB-backed enqueue/sweep is exercised in staging.
 *
 * Run: pnpm exec tsx scripts/cortex-outbox-test.ts
 */
import {
  cortexConfig,
  decideDelivery,
  deliverOnce,
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

  // ── nextBackoffMs ──
  const b1 = nextBackoffMs(1);
  const b2 = nextBackoffMs(2);
  const b10 = nextBackoffMs(10);
  assert(b1 >= 10_000 && b1 <= 13_000, `backoff(1) in [10s,13s] (got ${b1})`);
  assert(b2 >= b1 && b2 <= 26_000, `backoff(2) >= backoff(1) (got ${b2})`);
  assert(b10 <= 86_400_000, `backoff(10) capped at 24h (got ${b10})`);

  // ── decideDelivery ──
  assert(decideDelivery(200, null) === 'delivered', '200 -> delivered');
  assert(decideDelivery(202, null) === 'delivered', '202 -> delivered');
  assert(decideDelivery(401, null) === 'dead', '401 -> dead (config)');
  assert(decideDelivery(403, null) === 'dead', '403 -> dead (config)');
  assert(decideDelivery(429, null) === 'retry', '429 -> retry');
  assert(decideDelivery(500, null) === 'retry', '500 -> retry');
  assert(decideDelivery(404, null) === 'retry', '404 -> retry (indefinite)');
  assert(
    decideDelivery(null, new Error('Unauthorized')) === 'dead',
    'timeout/auth error -> dead on unauthorized',
  );
  assert(
    decideDelivery(null, new Error('fetch failed: connect')) === 'retry',
    'connectivity error -> retry',
  );

  // ── deliverOnce with mocked fetch ──
  const row = {
    workspaceId: 'ws',
    sessionId: 's',
    honchoMessageId: 'm1',
    peerId: 'user',
    text: 'hello',
    timezone: 'Europe/London',
  };

  (async () => {
    const okPost = (() => {
      const seen: string[] = [];
      const fn = (async (url: unknown, init?: RequestInit) => {
        seen.push(String(url));
        assert(
          String(url).endsWith('/v1/events/turn'),
          'delivers to /v1/events/turn',
        );
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert(
          body.honcho_message_id === 'm1',
          'payload carries honcho_message_id',
        );
        assert(
          Boolean(init?.headers && 'Authorization' in (init.headers as object)),
          'sends bearer auth',
        );
        return {
          ok: true,
          status: 202,
          json: async () => ({
            context: { status: 'ok', honcho_status: 'ok' },
            extraction_backend: 'model',
          }),
        } as Response;
      }) as typeof fetch;
      return { fn, seen };
    })();

    const delivered = await deliverOnce(row, {
      post: okPost.fn,
      now: new Date(),
    });
    assert(
      delivered.action === 'delivered' && delivered.degraded === false,
      'healthy 202 -> delivered, not degraded',
    );

    const degradedPost = (async () =>
      ({
        ok: true,
        status: 202,
        json: async () => ({
          context: { status: 'degraded', honcho_status: 'unavailable' },
          extraction_backend: 'model',
        }),
      }) as Response) as typeof fetch;
    const degraded = await deliverOnce(row, {
      post: degradedPost,
      now: new Date(),
    });
    assert(
      degraded.action === 'delivered' && degraded.degraded === true,
      '202 with degraded context -> delivered + degraded flagged',
    );

    const failingPost = (async () => {
      throw new Error('fetch failed: connection refused');
    }) as typeof fetch;
    const failed = await deliverOnce(row, {
      post: failingPost,
      now: new Date(),
    });
    assert(
      failed.action === 'retry' && failed.statusCode === null,
      'transport failure -> retry',
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
