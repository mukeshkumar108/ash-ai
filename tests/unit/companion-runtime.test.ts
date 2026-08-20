import { expect, test } from '@playwright/test';

import {
  companionRuntimeAssistantMessageId,
  companionRuntimeReplyOnlyEnabled,
  executeCompanionRuntimeTurn,
  streamCompanionRuntimeTurn,
} from '@/lib/companion-runtime';

const input = {
  contract_version: 'v1' as const,
  turn_id: 'turn-1',
  conversation_id: 'conversation-1',
  companion_id: 'sophie' as const,
  selected_model_id: 'chat-model',
  current_sanitized_message: 'Hello',
  message_parts: [{ type: 'text', text: 'Hello' }],
  canonical_history: [],
  trusted_user_context: { user_id: 'user-1' },
  recent_provenance: {},
  capability_grant: {
    allow_read_tools: true,
    allow_live_data: true,
    allow_research: true,
    granted_scopes: ['read_tools', 'live_data', 'research'],
  },
  transcript_reliability: null,
};

const completed = {
  status: 'completed',
  turn_id: input.turn_id,
  conversation_id: input.conversation_id,
  assistant_message: 'Hello back',
  model_used: 'provider/model',
  provider_used: 'provider',
  execution_lane: 'reply_only',
  used_fallback: false,
  finish_reason: 'stop',
  execution_metadata: {},
  scene_state: {},
  epistemic_classification: {},
  honcho_memory_packet: null,
  cortex_context_packet: null,
};

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test.beforeEach(() => {
  process.env.COMPANION_RUNTIME_URL = 'https://runtime.test';
  process.env.COMPANION_RUNTIME_SECRET = 'test-secret';
});

test('configured runtime is enabled by default with an explicit disable override', () => {
  delete process.env.COMPANION_RUNTIME_REPLY_ONLY_ENABLED;
  expect(companionRuntimeReplyOnlyEnabled()).toBe(true);
  process.env.COMPANION_RUNTIME_REPLY_ONLY_ENABLED = 'false';
  expect(companionRuntimeReplyOnlyEnabled()).toBe(false);
  delete process.env.COMPANION_RUNTIME_REPLY_ONLY_ENABLED;
});

test('recovers a lost POST response from durable status without another POST', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    calls.push(url);
    if (calls.length === 1) throw new TypeError('connection reset');
    return jsonResponse({ status: 'completed', result: completed });
  };

  try {
    await expect(executeCompanionRuntimeTurn(input)).resolves.toEqual(
      completed,
    );
    expect(calls).toEqual([
      'https://runtime.test/v1/turns',
      'https://runtime.test/v1/turns/turn-1?conversation_id=conversation-1',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries only the identical turn after status reports it still executing', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    calls.push(url);
    if (calls.length === 1) throw new TypeError('connection reset');
    if (calls.length === 2)
      return jsonResponse({ status: 'executing', result: null });
    return jsonResponse(completed);
  };

  try {
    await expect(executeCompanionRuntimeTurn(input)).resolves.toEqual(
      completed,
    );
    expect(calls).toEqual([
      'https://runtime.test/v1/turns',
      'https://runtime.test/v1/turns/turn-1?conversation_id=conversation-1',
      'https://runtime.test/v1/turns',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries the identical turn after a durable failed attempt', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = String(request);
    calls.push(url);
    if (calls.length === 1) throw new TypeError('connection reset');
    if (calls.length === 2)
      return jsonResponse({
        status: 'failed',
        result: { status: 'failed', error_code: 'PROVIDER_ERROR' },
      });
    return jsonResponse(completed);
  };

  try {
    await expect(executeCompanionRuntimeTurn(input)).resolves.toEqual(
      completed,
    );
    expect(calls).toEqual([
      'https://runtime.test/v1/turns',
      'https://runtime.test/v1/turns/turn-1?conversation_id=conversation-1',
      'https://runtime.test/v1/turns',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('derives a stable UUID-shaped assistant ID from the turn ID', () => {
  const first = companionRuntimeAssistantMessageId(
    input.conversation_id,
    input.turn_id,
  );
  expect(
    companionRuntimeAssistantMessageId(input.conversation_id, input.turn_id),
  ).toBe(first);
  expect(
    companionRuntimeAssistantMessageId(input.conversation_id, 'turn-2'),
  ).not.toBe(first);
  expect(
    companionRuntimeAssistantMessageId('conversation-2', input.turn_id),
  ).not.toBe(first);
  expect(first).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
});

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    },
  );
}

test('parses split SSE frames and treats the completed result as canonical', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      ': keep-alive\r\n\r\nevent: status\r\ndata: {"contract_version":"v1","turn_id":"turn-1",',
      '"conversation_id":"conversation-1","status":"executing","phase":"context","elapsed_ms":12}\r\n\r\n',
      'event: text_delta\ndata: {"contract_version":"v1","turn_id":"turn-1","conversation_id":"conversation-1","delta":"Hello ","index":0,"elapsed_ms":40}\n\n',
      `event: completed\ndata: ${JSON.stringify({
        contract_version: 'v1',
        turn_id: input.turn_id,
        conversation_id: input.conversation_id,
        result: completed,
      })}\n\n`,
    ]);

  try {
    const events = [];
    for await (const event of streamCompanionRuntimeTurn(input)) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      'status',
      'text_delta',
      'completed',
    ]);
    expect(events[1]?.type === 'text_delta' && events[1].data.delta).toBe(
      'Hello ',
    );
    expect(
      events[2]?.type === 'completed' &&
        events[2].data.result.status === 'completed' &&
        events[2].data.result.assistant_message,
    ).toBe('Hello back');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a stream that closes without a terminal event', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      'event: text_delta\ndata: {"contract_version":"v1","turn_id":"turn-1","conversation_id":"conversation-1","delta":"partial","index":0,"elapsed_ms":40}\n\n',
    ]);

  try {
    const consume = async () => {
      for await (const _event of streamCompanionRuntimeTurn(input)) {
        // Consume the complete stream.
      }
    };
    await expect(consume()).rejects.toThrow(
      'Companion Runtime stream ended without a terminal event',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
