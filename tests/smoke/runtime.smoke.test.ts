import { expect, test } from '@playwright/test';

import {
  buildCompanionRuntimeTurnInput,
  executeCompanionRuntimeTurn,
} from '@/lib/companion-runtime';

// Live cross-repo smoke: Sophie's real client against an instrumented Runtime
// (evals/consumer_smoke/serve.py in companion-runtime). Skipped unless
// SMOKE_RUNTIME_URL is set.
const url = process.env.SMOKE_RUNTIME_URL;
const secret = process.env.SMOKE_RUNTIME_SECRET ?? 'smoke-secret';
test.skip(!url, 'SMOKE_RUNTIME_URL not set');
test.describe.configure({ mode: 'serial' });

async function observed() {
  const response = await fetch(`${url}/_observed`, {
    headers: { 'X-Companion-Runtime-Key': secret },
  });
  return (await response.json()) as {
    jev_calls: number;
    other_inference: Array<{ kind: string }>;
    foreground_calls: number;
    foreground_models: string[];
    cortex_http: string[];
    honcho_calls: string[];
    prompt_blocks: string[];
  };
}

const chatId = crypto.randomUUID();
const history: Array<{ id: string; role: string; parts: any[]; metadata: any }> = [];
let state: Record<string, unknown> = {};
let clock = new Date();

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
    userId: `sophie-smoke-${chatId.slice(0, 8)}`,
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
  await observed();
  const result = await executeCompanionRuntimeTurn(input);
  await new Promise((r) => setTimeout(r, 1000));
  const seen = await observed();
  const next =
    result.status === 'completed'
      ? result.execution_metadata.next_session_state
      : result.next_session_state;
  state = next as Record<string, unknown>;
  history.push({
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: { createdAt: clock.toISOString() },
  });
  if (result.status === 'completed') {
    history.push({
      id: `${id}-a`,
      role: 'assistant',
      parts: [{ type: 'text', text: result.assistant_message }],
      metadata: { createdAt: new Date(clock.getTime() + 5_000).toISOString() },
    });
  }
  return { result, seen };
}

test('Sophie text sequence: Jev + foreground, one hydration, then zero Cortex/Honcho', async () => {
  const first = await turn('morning. slept badly, ugh.');
  expect(first.result.status).toBe('completed');
  expect(first.seen.jev_calls).toBe(1);
  expect(first.seen.foreground_calls).toBe(1);
  expect(first.seen.honcho_calls).toEqual([]);
  expect(first.seen.cortex_http.filter((p) => /world-model|attention-state/.test(p))).toHaveLength(2);
  expect(first.seen.prompt_blocks.join(' ')).not.toMatch(/SESSION|DIRECTOR|HOLD|LEAD/);
  for (const text of ['haha yeah. coffee first.', 'anyway, tell me something funny']) {
    const next = await turn(text);
    expect(next.result.status).toBe('completed');
    expect(next.seen.jev_calls).toBe(1);
    expect(next.seen.foreground_calls).toBe(1);
    expect(next.seen.cortex_http).toEqual([]);
    expect(next.seen.honcho_calls).toEqual([]);
    expect(next.seen.other_inference).toEqual([]);
    console.log('[smoke] sophie ordinary', JSON.stringify(next.seen.foreground_models));
  }
});

test('a signed-in data request is routed to the product tool lane, not answered by the Runtime', async () => {
  const { result, seen } = await turn('can you check my gmail for any flight confirmations?');
  console.log('[smoke] sophie lane', result.status, JSON.stringify(seen.foreground_models));
  expect(result.status).toBe('deferred');
  expect(seen.jev_calls).toBe(1);
  expect(seen.foreground_calls).toBe(0);
  if (result.status === 'deferred') expect(result.execution_lane).toBe('read_tools');
});
