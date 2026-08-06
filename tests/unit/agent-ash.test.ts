import { test, expect } from '@playwright/test';
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatResult } from '@langchain/core/outputs';
import { StateBackend } from 'deepagents';

import {
  assertPrivateTracingPolicy,
  createAshAgent,
} from '@/lib/agent/ash-agent';

const TEST_BASE_URL = 'http://workspace-connect.test';
const TEST_SECRET = 'test-only-signing-secret-at-least-32-bytes!!';
const TEST_APPLICATION_ID = 'ash-test';
const TEST_RETURN_URL = 'http://localhost:3000/settings/integrations';

const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encodedPayload = token.split('.')[1];
  return JSON.parse(
    Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'),
  );
}

function bearerToken(init: RequestInit): string {
  const headers = (init.headers as Record<string, string>) ?? {};
  const authorization = headers.authorization ?? '';
  expect(authorization.startsWith('Bearer ')).toBe(true);
  return authorization.slice('Bearer '.length);
}

function mustFind(
  calls: Array<{ url: string; init: RequestInit }>,
  predicate: (call: { url: string; init: RequestInit }) => boolean,
): { url: string; init: RequestInit } {
  const call = calls.find(predicate);

  if (!call) {
    throw new Error('expected fetch call not found');
  }

  return call;
}

type Turn =
  | { type: 'tool'; name: string; args: Record<string, unknown>; id: string }
  | { type: 'text'; text: string };

class ScriptedChatModel extends BaseChatModel {
  readonly state: { calls: number; toolNames: string[] };

  constructor(
    private turns: Turn[],
    state?: { calls: number; toolNames: string[] },
  ) {
    super({});
    this.state = state ?? { calls: 0, toolNames: [] };
  }

  _llmType(): string {
    return 'scripted-chat-model';
  }

  override bindTools(tools: Array<{ name?: string }>): ScriptedChatModel {
    const next = new ScriptedChatModel(this.turns, this.state);
    for (const tool of tools) {
      if (tool.name && !this.state.toolNames.includes(tool.name)) {
        this.state.toolNames.push(tool.name);
      }
    }
    return next;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const index = this.state.calls;
    this.state.calls += 1;
    const turn = this.turns[Math.min(index, this.turns.length - 1)];

    if (turn.type === 'tool') {
      return {
        generations: [
          {
            text: '',
            message: new AIMessage({
              content: '',
              tool_calls: [{ name: turn.name, args: turn.args, id: turn.id }],
            }),
          },
        ],
      };
    }

    return {
      generations: [
        { text: turn.text, message: new AIMessage({ content: turn.text }) },
      ],
    };
  }
}

test.beforeEach(() => {
  process.env.WORKSPACE_CONNECT_BASE_URL = TEST_BASE_URL;
  process.env.WORKSPACE_CONNECT_SIGNING_SECRET = TEST_SECRET;
  process.env.WORKSPACE_CONNECT_APPLICATION_ID = TEST_APPLICATION_ID;
  process.env.WORKSPACE_CONNECT_RETURN_URL = TEST_RETURN_URL;
});

test.afterEach(() => {
  process.env.WORKSPACE_CONNECT_BASE_URL = '';
  process.env.WORKSPACE_CONNECT_SIGNING_SECRET = '';
  process.env.WORKSPACE_CONNECT_APPLICATION_ID = '';
  process.env.WORKSPACE_CONNECT_RETURN_URL = '';
  process.env.LANGSMITH_TRACING = '';
  process.env.ASH_ALLOW_PRIVATE_LANGSMITH_TRACING = '';
  globalThis.fetch = originalFetch;
});

test('private external tracing requires a separate explicit opt-in', () => {
  process.env.LANGSMITH_TRACING = 'true';
  expect(() => assertPrivateTracingPolicy()).toThrow(
    'disabled for private Ash chat data',
  );

  process.env.ASH_ALLOW_PRIVATE_LANGSMITH_TRACING = 'true';
  expect(() => assertPrivateTracingPolicy()).not.toThrow();
});

test('default DeepAgents filesystem is isolated state, not the host filesystem', () => {
  const first = new StateBackend({ state: { files: {} } } as never);
  const second = new StateBackend({ state: { files: {} } } as never);

  const written = first.write('/notes/private.txt', 'request-local');
  expect(written).toMatchObject({ path: '/notes/private.txt' });
  expect(second.read('/notes/private.txt')).toMatchObject({
    error: expect.stringContaining('not found'),
  });
  expect(first.read('/etc/passwd')).toMatchObject({
    error: expect.stringContaining('not found'),
  });
});

test('agent invokes gmail_list_messages for an unread-email request and answers', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      messages: [
        {
          message_id: 'msg-1',
          thread_id: 'thread-1',
          sender: 'Morgan <morgan@example.com>',
          recipients: ['ash@example.com'],
          subject: 'The report',
          date: '2026-08-05T10:00:00.000Z',
          snippet: 'Here is the report you asked for.',
          label_ids: ['INBOX', 'UNREAD'],
          is_unread: true,
        },
      ],
    }),
  );

  try {
    const model = new ScriptedChatModel([
      {
        type: 'tool',
        name: 'gmail_list_messages',
        args: { query: 'is:unread', limit: 10 },
        id: 'call_1',
      },
      {
        type: 'text',
        text: 'You have 1 unread email from Morgan titled "The report".',
      },
    ]);

    const agent = createAshAgent({
      userId: 'user-42',
      modelId: 'chat-model',
      model,
    });

    const result = await agent.invoke({
      messages: [new HumanMessage('Show me my unread emails')],
    });

    expect(model.state).toBeDefined();
    expect(model.state.calls).toBeGreaterThanOrEqual(2);
    expect(model.state.toolNames).toEqual([
      'gmail_list_messages',
      'gmail_read_thread',
      'calendar_list_events',
      'calendar_get_event',
      'ls',
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'task',
    ]);

    const finalText = [...result.messages]
      .reverse()
      .find((m) => m.getType() === 'ai');
    expect(String(finalText?.content ?? '')).toContain('unread email');

    const gmailCall = mustFind(calls, (c) => c.url.includes('/gmail/messages'));
    expect(gmailCall).toBeDefined();
    expect(gmailCall.url).toBe(
      `${TEST_BASE_URL}/gmail/messages?limit=10&query=is%3Aunread`,
    );
    expect(decodeJwtPayload(bearerToken(gmailCall.init)).external_user_id).toBe(
      'user-42',
    );
  } finally {
    restore();
  }
});
