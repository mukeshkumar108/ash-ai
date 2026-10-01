import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import {
  buildCompanionRuntimeTurnInput,
  executeCompanionRuntimeTurn,
} from '@/lib/companion-runtime';

function wire(name: string) {
  return JSON.parse(
    readFileSync(`tests/runtime-wire/${name}.json`, 'utf8'),
  );
}

const base = {
  turnId: 'turn-1',
  conversationId: 'chat-1',
  selectedModelAlias: 'chat-model',
  currentText: 'hello',
  currentParts: [{ type: 'text', text: 'hello' }],
  history: [],
  userId: 'user-1',
  timeZone: 'Europe/London',
  entryContext: { chronology: { temporalSession: 'same' } },
  sessionRouting: {},
  medium: 'desktop' as const,
  transcriptReliability: null,
};

test('the turn request carries only facts and transport state', () => {
  const request = buildCompanionRuntimeTurnInput(base);
  expect(Object.keys(request.trusted_user_context).sort()).toEqual(
    ['entry_context', 'medium', 'session_routing', 'timezone', 'user_id'],
  );
  const body = JSON.stringify(request);
  for (const forbidden of [
    'handshake',
    'reentry',
    'day_packet',
    'userCorrections',
    'liveSituation',
    'director',
    'objective',
    'selected_move',
  ]) {
    expect(body).not.toContain(forbidden);
  }
});

test('the previous Runtime next_session_state is carried verbatim into the next turn', async () => {
  const originalFetch = globalThis.fetch;
  process.env.COMPANION_RUNTIME_URL = 'https://runtime.test';
  process.env.COMPANION_RUNTIME_SECRET = 'secret';
  const first = wire('completed_turn');
  const resident = {
    ...first.execution_metadata.next_session_state,
    residentWorld: { version: 'resident-world-v1', world_model: { x: 1 } },
  };
  let secondBody: Record<string, any> = {};
  globalThis.fetch = async (_url, init) => {
    secondBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(first), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const request = buildCompanionRuntimeTurnInput({
      ...base,
      sessionRouting: { ...resident, sessionMode: { active: false } },
    });
    await executeCompanionRuntimeTurn(request);
    const carried = secondBody.trusted_user_context.session_routing;
    expect(carried.residentWorld).toEqual(resident.residentWorld);
    expect(carried.lastJev).toEqual(resident.lastJev);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'tests', 'evals'].includes(name))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/u.test(name)) out.push(path);
  }
  return out;
}

test('there is one conversational intelligence path: no local fallback or retired Cortex calls', () => {
  const route = readFileSync('app/(chat)/api/chat/route.ts', 'utf8');
  for (const gone of [
    'executeDirectReply',
    'REPLY_ONLY_ENABLED',
    'companionRuntimeReplyOnlyEnabled',
    'fetchCortexContext',
    'prepareTurnMemory',
    'assessEpistemicPolicy',
    'classifyReentry',
    'decide' + 'Turn(',
    'decision_record',
    'extractBehaviorCorrection',
    'extractSophieAttentionCandidates',
  ]) {
    expect(route, gone).not.toContain(gone);
  }
  for (const file of [...walk('lib'), ...walk('app'), ...walk('components')]) {
    const text = readFileSync(file, 'utf8');
    expect(text, `${file} calls a retired Cortex endpoint`).not.toMatch(
      /cortex\/(attention-packet|handshake|handover|session-working-set|working-set)\b/u,
    );
  }
});
