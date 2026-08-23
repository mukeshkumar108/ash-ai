/**
 * Cross-repo integration test: app -> Cortex handshake chronology.
 *
 * Drives the REAL production request builder (fetchCortexContext) with the REAL
 * canonical chronology (computeUserChronology). Only the HTTP layer is mocked.
 *
 * We are NOT reconstructing TemporalSession here; we consume the canonical
 * UserChronology and assert the exact payload Cortex receives.
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.test.json scripts/cortex-chronology-integration-test.ts
 */
import { computeUserChronology } from '@/lib/agent/chronology';
import { fetchCortexContext } from '@/lib/synapse-cortex';

process.env.SYNAPSE_CORTEX_URL = 'https://cortex.test';
process.env.SYNAPSE_CORTEX_ENABLED = 'true';
process.env.SYNAPSE_CORTEX_CONTEXT_ENABLED = 'true';

let failures = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  ok: ${message}`);
  }
}

type CapturedRequest = {
  url: string;
  method: string;
  body: Record<string, unknown>;
};

const captured: CapturedRequest[] = [];

function installFetchMock(nowIso: string) {
  captured.length = 0;
  (globalThis as { fetch: unknown }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    captured.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body });
    if (url.includes('/v1/cortex/handshake')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          orientation: 'unknown',
          daypart: 'morning',
          sitting: null,
          first_contact_today: false,
          live_threads: [],
          avoid_surface: [],
          relevant_memory_refs: [],
        }),
      } as Response;
    }
    if (url.includes('/v1/cortex/attention-packet')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          continuity_context: {
            now: {
              local_time: nowIso,
              timezone: 'Europe/London',
              daypart: 'morning',
            },
            continuity: [],
            open_threads: [],
            sophie_attention: [],
            recent_resolutions: [],
            avoid_repeating: [],
            relevant_honcho_message_ids: [],
          },
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
}

function handshakeCall(): CapturedRequest {
  const call = captured.find((item) =>
    item.url.includes('/v1/cortex/handshake'),
  );
  if (!call) throw new Error('handshake request was not made');
  return call;
}

const timeZone = 'Europe/London';

async function run() {
  console.log('cortex-chronology-integration-test');

  // Scenario 1: first morning contact (no prior interactions).
  {
    installFetchMock('2026-08-21T09:05:00Z');
    const chronology = computeUserChronology({
      interactionTimes: [],
      now: new Date('2026-08-21T09:05:00Z'),
      timeZone,
    });
    const context = await fetchCortexContext({
      userId: 'user1',
      chatId: 'chat1',
      timeZone,
      now: new Date('2026-08-21T09:05:00Z'),
      chronology,
    });
    assert(context !== null, 'scenario1: context returned');
    const body = handshakeCall().body as {
      chronology?: Record<string, unknown>;
    };
    assert(
      body.chronology?.temporalSession === 'new',
      'scenario1: first contact sends temporalSession=new',
    );
    assert(
      body.chronology?.firstContactUserDay === true,
      'scenario1: first contact sends firstContactUserDay=true',
    );
  }

  // Scenario 2: new sitting same day (09:05 -> ~55m gap -> 10:00 return).
  {
    installFetchMock('2026-08-21T10:00:00Z');
    const chronology = computeUserChronology({
      interactionTimes: [{ createdAt: new Date('2026-08-21T09:05:00Z') }],
      now: new Date('2026-08-21T10:00:00Z'),
      timeZone,
    });
    assert(
      chronology.newTemporalSession === true,
      'scenario2: canonical says new session',
    );
    assert(
      chronology.isFirstContactUserDay === false,
      'scenario2: canonical says not first contact',
    );
    await fetchCortexContext({
      userId: 'user1',
      chatId: 'chat1',
      timeZone,
      now: new Date('2026-08-21T10:00:00Z'),
      chronology,
    });
    const body = handshakeCall().body as {
      chronology?: Record<string, unknown>;
    };
    assert(
      body.chronology?.temporalSession === 'new' &&
        body.chronology?.firstContactUserDay === false,
      'scenario2: sends temporalSession=new, firstContactUserDay=false',
    );
    assert(
      body.chronology &&
        typeof body.chronology.gapMinutes === 'number' &&
        body.chronology.gapMinutes >= 30,
      `scenario2: gapMinutes=${body.chronology?.gapMinutes} sent`,
    );
  }

  // Scenario 3: same sitting (< 30 min gap).
  {
    installFetchMock('2026-08-21T10:00:00Z');
    const chronology = computeUserChronology({
      interactionTimes: [{ createdAt: new Date('2026-08-21T09:55:00Z') }],
      now: new Date('2026-08-21T10:00:00Z'),
      timeZone,
    });
    assert(
      chronology.sameTemporalSession === true,
      'scenario3: canonical says same session',
    );
    await fetchCortexContext({
      userId: 'user1',
      chatId: 'chat1',
      timeZone,
      now: new Date('2026-08-21T10:00:00Z'),
      chronology,
    });
    const body = handshakeCall().body as {
      chronology?: Record<string, unknown>;
    };
    assert(
      body.chronology?.temporalSession === 'same',
      'scenario3: sends temporalSession=same',
    );
  }

  if (failures > 0) {
    console.error(`cortex-chronology-integration-test: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('cortex-chronology-integration-test: all assertions passed');
  process.exit(0);
}

run().catch((error) => {
  console.error('cortex-chronology-integration-test: fatal', error);
  process.exit(1);
});
