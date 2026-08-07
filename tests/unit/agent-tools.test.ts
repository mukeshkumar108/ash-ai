import { test, expect } from '@playwright/test';

import { buildAshAgentTools, buildAshModelTools } from '@/lib/agent/ash-agent';

const TEST_BASE_URL = 'http://workspace-connect.test';
const TEST_SECRET = 'test-only-signing-secret-at-least-32-bytes!!';
const TEST_APPLICATION_ID = 'ash-test';
const TEST_RETURN_URL = 'http://localhost:3000/settings/integrations';

const originalFetch = globalThis.fetch;

interface FetchCall {
  url: string;
  init: RequestInit;
}

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: FetchCall[] = [];

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

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers as Record<string, string> | undefined) ?? {};
}

function bearerToken(init: RequestInit): string {
  const authorization = headersOf(init).authorization ?? '';
  expect(authorization.startsWith('Bearer ')).toBe(true);
  return authorization.slice('Bearer '.length);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encodedPayload = token.split('.')[1];
  return JSON.parse(
    Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'),
  );
}

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
}

function mustFind(
  calls: FetchCall[],
  predicate: (call: FetchCall) => boolean,
): FetchCall {
  const call = calls.find(predicate);

  if (!call) {
    throw new Error('expected fetch call not found');
  }

  return call;
}

function toolByName(name: string) {
  const tool = buildAshAgentTools('user-42').find(
    (t) => (t as { name?: string }).name === name,
  );
  expect(tool).toBeDefined();
  return tool as { invoke: (args: unknown) => Promise<unknown> };
}

const draftCreateResponse = {
  draft_id: 'draft-1',
  message_id: 'msg-1',
  thread_id: 'thread-1',
  recipients: ['alice@example.com'],
  subject: 'Hello',
  created: true,
};

const eventResponse = {
  event_id: 'evt-1',
  calendar_id: 'primary',
  status: 'confirmed',
  title: 'Meeting',
  description: null,
  location: null,
  start: '2026-08-07T09:00:00.000Z',
  end: '2026-08-07T09:30:00.000Z',
  start_date: null,
  end_date: null,
  time_zone: 'UTC',
  all_day: false,
  html_link: null,
};

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
  globalThis.fetch = originalFetch;
});

test('the model-visible Google tool surface is read-only until approvals exist', () => {
  const tools = buildAshModelTools('user-42');
  const names = tools.map((t) => (t as { name?: string }).name ?? '');

  expect(
    names.filter(
      (name) => name.startsWith('gmail_') || name.startsWith('calendar_'),
    ),
  ).toEqual([
    'gmail_list_messages',
    'gmail_read_thread',
    'calendar_list_events',
    'calendar_get_event',
  ]);

  expect(names.some((name) => /send/i.test(name))).toBe(false);
});

test('gmail_list_messages is bounded, forwards the query, and binds the user identity', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ messages: [] }));

  try {
    const list = toolByName('gmail_list_messages');

    await expect(list.invoke({ limit: 21 })).rejects.toThrow();

    const result = (await list.invoke({
      limit: 5,
      query: 'is:unread from:morgan@example.com',
    })) as { messages: unknown[] };

    expect(result.messages).toEqual([]);

    const gmailCall = mustFind(calls, (c) => c.url.includes('/gmail/messages'));
    expect(gmailCall).toBeDefined();

    const url = new URL(gmailCall?.url ?? '');
    expect(url.origin + url.pathname).toBe(`${TEST_BASE_URL}/gmail/messages`);
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('query')).toBe(
      'is:unread from:morgan@example.com',
    );
    expect(decodeJwtPayload(bearerToken(gmailCall.init)).external_user_id).toBe(
      'user-42',
    );
  } finally {
    restore();
  }
});

test('two users get separately bound tools with different identities', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ messages: [] }));

  try {
    const toolsA = buildAshAgentTools('user-a');
    const toolsB = buildAshAgentTools('user-b');

    const listA = toolsA.find(
      (t) => (t as { name?: string }).name === 'gmail_list_messages',
    ) as { invoke: (args: unknown) => Promise<unknown> };
    const listB = toolsB.find(
      (t) => (t as { name?: string }).name === 'gmail_list_messages',
    ) as { invoke: (args: unknown) => Promise<unknown> };

    await listA.invoke({});
    await listB.invoke({});

    const tokens = calls.map((c) => decodeJwtPayload(bearerToken(c.init)));
    expect(tokens[0].external_user_id).toBe('user-a');
    expect(tokens[1].external_user_id).toBe('user-b');
    expect(tokens[0].external_user_id).not.toBe(tokens[1].external_user_id);
    expect(tokens[0].jti).not.toBe(tokens[1].jti);
  } finally {
    restore();
  }
});

test('gmail_read_thread validates the thread id and omits raw HTML', async () => {
  const invalid = await toolByName('gmail_read_thread').invoke({
    threadId: '../../etc/passwd',
  });
  expect((invalid as { error?: string }).error).toBeTruthy();

  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      thread_id: 'thread-1',
      messages: [
        {
          message_id: 'msg-1',
          sender: 'Morgan <morgan@example.com>',
          recipients: ['ash@example.com'],
          cc: [],
          subject: 'The report',
          date: '2026-08-05T10:00:00.000Z',
          plain_text_body: 'Here is the report.',
          html_body: '<script>alert(1)</script><p>Unused</p>',
          attachments: [
            {
              attachment_id: 'att-1',
              filename: 'notes.pdf',
              mime_type: 'application/pdf',
              size_bytes: 2048,
            },
          ],
        },
      ],
    }),
  );

  try {
    const result = (await toolByName('gmail_read_thread').invoke({
      threadId: 'thread-1',
    })) as { messages: Array<Record<string, unknown>> };

    expect(result.messages[0].plainTextBody).toBe('Here is the report.');
    expect(result.messages[0].htmlBody).toBeUndefined();
    expect(result.messages[0].attachments).toEqual([
      {
        attachmentId: 'att-1',
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    ]);

    const threadCall = mustFind(calls, (c) =>
      c.url.includes('/gmail/threads/'),
    );
    expect(threadCall).toBeDefined();
    expect(threadCall.url).toBe(`${TEST_BASE_URL}/gmail/threads/thread-1`);
  } finally {
    restore();
  }
});

test('gmail_create_draft rejects invalid emails and creates drafts with the reply context', async () => {
  await expect(
    toolByName('gmail_create_draft').invoke({
      to: ['not-an-email'],
      subject: 'Hello',
      plainTextBody: 'Body',
    }),
  ).rejects.toThrow();

  const noRecipient = await toolByName('gmail_create_draft').invoke({
    to: [],
    subject: 'Hello',
    plainTextBody: 'Body',
  });
  expect((noRecipient as { error?: string }).error).toContain('recipient');

  const { calls, restore } = mockFetch(() => jsonResponse(draftCreateResponse));

  try {
    const result = (await toolByName('gmail_create_draft').invoke({
      to: ['alice@example.com'],
      subject: 'Re: Hello',
      plainTextBody: 'Reply body',
      replyToMessageId: 'msg-9',
      threadId: 'thread-1',
    })) as { draftId: string; status: string };

    expect(result.draftId).toBe('draft-1');
    expect(result.status).toBe('saved');

    const draftCall = mustFind(calls, (c) => c.url.includes('/gmail/drafts'));
    expect(draftCall).toBeDefined();
    expect(draftCall.init.method).toBe('POST');

    const body = parseBody(draftCall.init);
    expect(body.to).toEqual(['alice@example.com']);
    expect(body.plain_text_body).toBe('Reply body');
    expect(body.reply_to_message_id).toBe('msg-9');
    expect(body.thread_id).toBe('thread-1');
  } finally {
    restore();
  }
});

test('gmail_update_draft and gmail_delete_draft use the opaque draft id', async () => {
  const { calls, restore } = mockFetch((url) => {
    if (url.includes('/gmail/drafts/draft-1')) {
      return jsonResponse({
        ...draftCreateResponse,
        to: ['alice@example.com'],
        cc: [],
        bcc: [],
        plain_text_body: 'Updated body',
        html_body: null,
      });
    }
    return new Response(null, { status: 204 });
  });

  try {
    const updated = (await toolByName('gmail_update_draft').invoke({
      draftId: 'draft-1',
      subject: 'Updated subject',
      plainTextBody: 'Updated body',
    })) as { status: string };

    expect(updated.status).toBe('updated');

    const patch = mustFind(calls, (c) => c.init.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch.url).toBe(`${TEST_BASE_URL}/gmail/drafts/draft-1`);

    const deleted = (await toolByName('gmail_delete_draft').invoke({
      draftId: 'draft-1',
    })) as { status: string };

    expect(deleted.status).toBe('deleted');
    const del = mustFind(calls, (c) => c.init.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del.url).toBe(`${TEST_BASE_URL}/gmail/drafts/draft-1`);
  } finally {
    restore();
  }
});

test('calendar_list_events bounds days and uses the primary calendar', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({ calendar_id: 'primary', events: [] }),
  );

  try {
    await expect(
      toolByName('calendar_list_events').invoke({ days: 31 }),
    ).rejects.toThrow();

    const result = (await toolByName('calendar_list_events').invoke({
      days: 14,
    })) as { events: unknown[] };

    expect(result.events).toEqual([]);

    const eventCall = mustFind(calls, (c) =>
      c.url.includes('/calendar/events'),
    );
    expect(eventCall).toBeDefined();

    const url = new URL(eventCall.url);
    expect(url.searchParams.get('calendar_id')).toBe('primary');
  } finally {
    restore();
  }
});

test('calendar_get_event validates the opaque event id', async () => {
  const invalid = await toolByName('calendar_get_event').invoke({
    eventId: '..',
  });
  expect((invalid as { error?: string }).error).toBeTruthy();

  const { calls, restore } = mockFetch(() => jsonResponse(eventResponse));

  try {
    const result = (await toolByName('calendar_get_event').invoke({
      eventId: 'evt-1',
    })) as { eventId: string };

    expect(result.eventId).toBe('evt-1');

    const call = mustFind(calls, (c) =>
      c.url.includes('/calendar/events/evt-1'),
    );
    expect(call).toBeDefined();
    expect(call.url).toBe(
      `${TEST_BASE_URL}/calendar/events/evt-1?calendar_id=primary`,
    );
  } finally {
    restore();
  }
});

test('calendar_create_event rejects invalid ranges and sends the Idempotency-Key', async () => {
  const mixed = await toolByName('calendar_create_event').invoke({
    title: 'Meeting',
    start: '2026-08-07T09:00:00Z',
    end: '2026-08-07T09:30:00Z',
    startDate: '2026-08-10',
  });
  expect((mixed as { error?: string }).error).toContain('either timed');

  const equalDays = await toolByName('calendar_create_event').invoke({
    title: 'Holiday',
    startDate: '2026-08-10',
    endDate: '2026-08-10',
  });
  expect((equalDays as { error?: string }).error).toBeTruthy();

  const { calls, restore } = mockFetch(() => jsonResponse(eventResponse));

  try {
    const result = (await toolByName('calendar_create_event').invoke({
      title: 'Meeting',
      description: 'Notes',
      location: 'Zoom',
      start: '2026-08-07T09:00:00+01:00',
      end: '2026-08-07T09:30:00+01:00',
      timeZone: 'Europe/London',
    })) as { eventId: string; status: string };

    expect(result.eventId).toBe('evt-1');

    const post = mustFind(calls, (c) => c.init.method === 'POST');
    expect(post).toBeDefined();
    expect(post.url).toBe(`${TEST_BASE_URL}/calendar/events`);
    expect(headersOf(post.init)['idempotency-key']).toBeTruthy();

    const body = parseBody(post.init);
    expect(body.calendar_id).toBe('primary');
    expect(body.start).toBe('2026-08-07T09:00:00+01:00');
    expect(body.time_zone).toBe('Europe/London');
  } finally {
    restore();
  }
});

test('calendar_update_event and calendar_delete_event use the exact event id', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(eventResponse));

  try {
    const updated = (await toolByName('calendar_update_event').invoke({
      eventId: 'evt-1',
      title: 'Renamed',
    })) as { eventId: string };

    expect(updated.eventId).toBe('evt-1');

    const patch = mustFind(calls, (c) => c.init.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch.url).toBe(
      `${TEST_BASE_URL}/calendar/events/evt-1?calendar_id=primary`,
    );
    expect(parseBody(patch.init)).toEqual({ title: 'Renamed' });

    const deleted = (await toolByName('calendar_delete_event').invoke({
      eventId: 'evt-1',
    })) as { status: string };

    expect(deleted.status).toBe('deleted');
    const del = mustFind(calls, (c) => c.init.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del.url).toBe(
      `${TEST_BASE_URL}/calendar/events/evt-1?calendar_id=primary`,
    );
  } finally {
    restore();
  }
});

test('tool errors are sanitised and never leak upstream bodies or tokens', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({ detail: 'SECRET-UPSTREAM-BODY' }, 502),
  );

  try {
    const result = (await toolByName('gmail_list_messages').invoke({
      limit: 3,
    })) as { error?: string };

    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain('SECRET-UPSTREAM-BODY');
    expect(result.error).not.toContain(TEST_SECRET);

    const token = bearerToken(calls[0].init);
    expect(result.error).not.toContain(token);
  } finally {
    restore();
  }
});

test('no credentials or tokens appear in successful tool results', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({
      messages: [
        {
          message_id: 'm1',
          thread_id: 't1',
          sender: 'A',
          recipients: ['b@example.com'],
          subject: 's',
          date: '2026-08-05T10:00:00.000Z',
          snippet: 'x',
          label_ids: ['INBOX'],
          is_unread: true,
        },
      ],
    }),
  );

  try {
    const result = await toolByName('gmail_list_messages').invoke({ limit: 1 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TEST_SECRET);
    expect(serialized).not.toMatch(/Bearer /);
  } finally {
    restore();
  }
});
