import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

import {
  buildCompanionRuntimeTurnInput,
  executeCompanionRuntimeTurn,
} from '@/lib/companion-runtime';

// Deployed smoke: Sophie's real client against the deployed Runtime. Call
// shape comes from the Runtime's execution_metadata plus the Cortex access log
// on the VPS (SMOKE_SSH). Skipped unless DEPLOYED_RUNTIME_URL is set.
const url = process.env.DEPLOYED_RUNTIME_URL;
const secret = process.env.DEPLOYED_RUNTIME_SECRET ?? '';
const ssh = process.env.SMOKE_SSH;
test.skip(!url || !secret, 'DEPLOYED_RUNTIME_URL/SECRET not set');
test.describe.configure({ mode: 'serial' });

const chatId = crypto.randomUUID();
const userId = `deployed-smoke-${chatId.slice(0, 8)}`;
const history: any[] = [];
let state: Record<string, unknown> = {};
let clock = new Date();

function cortexCalls(sinceIso: string): string[] {
  if (!ssh) return [];
  const out = execSync(
    `ssh ${ssh} "docker logs --since ${sinceIso} synapse-cortex 2>&1 | grep -E 'POST|GET' | grep -v health || true"`,
    { encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((l) => /"(?:POST|GET) ([^ ?"]+)/.exec(l)?.[1])
    .filter(Boolean) as string[];
}

async function turn(text: string) {
  clock = new Date(clock.getTime() + 60_000);
  const id = crypto.randomUUID();
  const input = buildCompanionRuntimeTurnInput({
    turnId: id,
    conversationId: chatId,
    selectedModelAlias: 'chat-model',
    currentText: text,
    currentParts: [{ type: 'text', text }],
    history: [...history],
    userId,
    timeZone: 'Europe/London',
    entryContext: {
      chronology: {
        temporalSession: history.length === 0 ? 'new' : 'same',
        sessionStartedAt: new Date(clock.getTime() - 60_000).toISOString(),
        firstContactToday: history.length === 0,
      },
    },
    sessionRouting: state,
    medium: 'desktop',
    transcriptReliability: null,
  });
  const since = new Date(Date.now() - 1500).toISOString();
  const result = await executeCompanionRuntimeTurn(input);
  await new Promise((r) => setTimeout(r, 3000));
  const cortex = cortexCalls(since);
  const meta = (
    result.status === 'completed' ? result.execution_metadata : {}
  ) as any;
  state = (
    result.status === 'completed'
      ? result.execution_metadata.next_session_state
      : result.next_session_state
  ) as Record<string, unknown>;
  history.push({ id, role: 'user', parts: [{ type: 'text', text }], metadata: { createdAt: clock.toISOString() } });
  if (result.status === 'completed') {
    history.push({ id: `${id}-a`, role: 'assistant', parts: [{ type: 'text', text: result.assistant_message }], metadata: { createdAt: new Date(clock.getTime() + 5000).toISOString() } });
  }
  const shape = {
    text,
    status: result.status,
    lane: result.execution_lane,
    jev_model: meta.jev?.model,
    foreground_model: meta.foreground_model,
    foreground_provider: meta.foreground_provider,
    runtime_cortex_calls: meta.cortex_calls,
    cortex_http_observed: cortex,
    depth: meta.depth?.source,
    other_inference: meta.exceptional_operations,
    beats: result.status === 'completed' ? result.beats?.length : null,
    beat_delivery: result.status === 'completed' ? result.beat_delivery : null,
  };
  console.log('[deployed-smoke]', JSON.stringify(shape));
  return { result, shape };
}

test('Sophie text: slim result parses, one hydration, then zero Cortex/Honcho', async () => {
  const first = await turn('morning. slept badly, ugh.');
  expect(first.shape.status).toBe('completed');
  expect(first.shape.jev_model).toMatch(/typesafe/);
  expect(first.shape.runtime_cortex_calls).toBe(2);
  for (const text of ['haha yeah. coffee first.', 'anyway, tell me something funny']) {
    const next = await turn(text);
    expect(next.shape.status).toBe('completed');
    expect(next.shape.runtime_cortex_calls).toBe(0);
    expect(next.shape.depth).toBe('none');
    expect(next.shape.other_inference).toEqual([]);
    expect(
      next.shape.cortex_http_observed.filter((p) =>
        /world-model|attention-state|turn-working-set|projection|attention-packet|handshake/.test(p),
      ),
    ).toEqual([]);
  }
});

test('a signed-in data request is deferred to the product tool lane', async () => {
  const { shape } = await turn('can you check my gmail for flight confirmations?');
  expect(shape.status).toBe('deferred');
  expect(shape.lane).toBe('read_tools');
});
