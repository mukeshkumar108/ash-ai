import { test, expect } from '@playwright/test';

import {
  calendarEventTimeLabel,
  describeIntegrationFailure,
  extractPlainTextFromHtml,
  formatGmailMessageDate,
  getThreadMessagePlainText,
  integrationFailureReason,
  parseGmailMessagesQuery,
  validateThreadId,
  type CalendarEvent,
  type GmailThreadMessage,
} from '@/lib/integrations';
import {
  getGmailThread,
  getRecentGmailMessages,
  getUpcomingCalendarEvents,
  parseCalendarEventsResponse,
  parseGmailMessagesResponse,
  parseGmailThreadResponse,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';

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

function bearerToken(init: RequestInit): string {
  const headers = init.headers as Record<string, string> | undefined;
  const authorization = headers?.authorization ?? '';

  expect(authorization.startsWith('Bearer ')).toBe(true);
  return authorization.slice('Bearer '.length);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encodedPayload = token.split('.')[1];

  if (!encodedPayload) {
    throw new Error('malformed token');
  }

  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
}

const messagesResponseBody = {
  messages: [
    {
      message_id: 'msg-1',
      thread_id: 'thread-1',
      sender: 'Alice <alice@example.com>',
      recipients: ['bob@example.com'],
      subject: 'Hello Bob',
      date: '2026-08-05T10:00:00.000Z',
      snippet: 'Just checking in...',
      label_ids: ['INBOX', 'UNREAD'],
      is_unread: true,
    },
  ],
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

test('getRecentGmailMessages calls /gmail/messages with a default limit of 10 and Bearer auth', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse(messagesResponseBody),
  );

  try {
    const result = await getRecentGmailMessages('stable-user-123');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TEST_BASE_URL}/gmail/messages?limit=10`);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.cache).toBe('no-store');

    const token = bearerToken(calls[0].init);
    expect(decodeJwtPayload(token).purpose).toBe('api_access');
    expect(decodeJwtPayload(token).external_user_id).toBe('stable-user-123');

    expect(result).toEqual([
      {
        messageId: 'msg-1',
        threadId: 'thread-1',
        sender: 'Alice <alice@example.com>',
        recipients: ['bob@example.com'],
        subject: 'Hello Bob',
        date: '2026-08-05T10:00:00.000Z',
        snippet: 'Just checking in...',
        labelIds: ['INBOX', 'UNREAD'],
        isUnread: true,
      },
    ]);
  } finally {
    restore();
  }
});

test('getRecentGmailMessages forwards a bounded limit and encodes the Gmail query', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ messages: [] }));

  try {
    await getRecentGmailMessages('stable-user-123', {
      limit: 7,
      query: 'from:alice subject:"hello world"',
    });

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`${TEST_BASE_URL}/gmail/messages`);
    expect(url.searchParams.get('limit')).toBe('7');
    expect(url.searchParams.get('query')).toBe(
      'from:alice subject:"hello world"',
    );
  } finally {
    restore();
  }
});

test('getRecentGmailMessages clamps out-of-range limits defensively', async () => {
  const limits: Array<[number, number]> = [
    [999, 20],
    [0, 10],
    [-3, 10],
    [5, 5],
  ];

  for (const [requested, expected] of limits) {
    const { calls, restore } = mockFetch(() => jsonResponse({ messages: [] }));

    try {
      await getRecentGmailMessages('stable-user-123', { limit: requested });
      expect(calls[0].url).toBe(
        `${TEST_BASE_URL}/gmail/messages?limit=${expected}`,
      );
    } finally {
      restore();
    }
  }
});

test('getGmailThread encodes the opaque thread id as a single path segment', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      thread_id: 'thread abc+1',
      messages: [
        {
          message_id: 'msg-1',
          sender: 'Alice <alice@example.com>',
          recipients: ['bob@example.com'],
          cc: [],
          subject: 'Re: Hello',
          date: '2026-08-05T10:00:00.000Z',
          plain_text_body: 'Plain reply body',
          html_body: null,
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
    const result = await getGmailThread('stable-user-123', 'thread abc+1');

    expect(calls[0].url).toBe(
      `${TEST_BASE_URL}/gmail/threads/${encodeURIComponent('thread abc+1')}`,
    );
    expect(decodeJwtPayload(bearerToken(calls[0].init)).external_user_id).toBe(
      'stable-user-123',
    );

    expect(result.threadId).toBe('thread abc+1');
    expect(result.messages[0].messageId).toBe('msg-1');
    expect(result.messages[0].plainTextBody).toBe('Plain reply body');
    expect(result.messages[0].attachments).toEqual([
      {
        attachmentId: 'att-1',
        filename: 'notes.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      },
    ]);
  } finally {
    restore();
  }
});

test('getGmailThread rejects unsafe thread ids before calling workspace-connect', async () => {
  for (const threadId of ['', 'a/b', '..', '.', 'x'.repeat(256)]) {
    await expect(
      getGmailThread('stable-user-123', threadId),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  }
});

test('getUpcomingCalendarEvents sends a timezone-aware 7-day window on primary', async () => {
  const before = Date.now();
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      calendar_id: 'primary',
      events: [
        {
          event_id: 'evt-1',
          calendar_id: 'primary',
          status: 'confirmed',
          title: 'Standup',
          description: null,
          location: 'Zoom',
          start: '2026-08-07T09:00:00.000Z',
          end: '2026-08-07T09:30:00.000Z',
          start_date: null,
          end_date: null,
          time_zone: 'UTC',
          all_day: false,
        },
      ],
    }),
  );

  try {
    const result = await getUpcomingCalendarEvents('stable-user-123');

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`${TEST_BASE_URL}/calendar/events`);
    expect(url.searchParams.get('calendar_id')).toBe('primary');
    expect(url.searchParams.get('limit')).toBe('50');

    const timeMin = url.searchParams.get('time_min');
    const timeMax = url.searchParams.get('time_max');
    expect(timeMin).toMatch(/Z$/);
    expect(timeMax).toMatch(/Z$/);

    const minTime = Date.parse(timeMin ?? '');
    const maxTime = Date.parse(timeMax ?? '');
    expect(Number.isNaN(minTime)).toBe(false);
    expect(Number.isNaN(maxTime)).toBe(false);
    expect(minTime).toBeGreaterThanOrEqual(before);
    expect(maxTime - minTime).toBeGreaterThanOrEqual(6 * 24 * 60 * 60 * 1000);
    expect(maxTime - minTime).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1000);

    expect(result.calendarId).toBe('primary');
    expect(result.events[0]).toEqual({
      eventId: 'evt-1',
      calendarId: 'primary',
      status: 'confirmed',
      title: 'Standup',
      description: null,
      location: 'Zoom',
      start: '2026-08-07T09:00:00.000Z',
      end: '2026-08-07T09:30:00.000Z',
      startDate: null,
      endDate: null,
      timeZone: 'UTC',
      allDay: false,
      htmlLink: null,
    });
  } finally {
    restore();
  }
});

test('missing Google connection maps to not_connected on list endpoints', async () => {
  const messages404 = mockFetch(() =>
    jsonResponse({ detail: 'No active Google connection' }, 404),
  );

  try {
    await expect(getRecentGmailMessages('u')).rejects.toMatchObject({
      code: 'not_connected',
    });
  } finally {
    messages404.restore();
  }

  const events404 = mockFetch(() =>
    jsonResponse({ detail: 'No active Google connection' }, 404),
  );

  try {
    await expect(getUpcomingCalendarEvents('u')).rejects.toMatchObject({
      code: 'not_connected',
    });
  } finally {
    events404.restore();
  }
});

test('missing thread maps to not_found', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({ detail: 'Thread not found' }, 404),
  );

  try {
    await expect(getGmailThread('u', 'thread-1')).rejects.toMatchObject({
      code: 'not_found',
    });
  } finally {
    restore();
  }
});

test('revoked Google credentials map to revoked', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({ detail: 'Token has been revoked' }, 401),
  );

  try {
    await expect(getRecentGmailMessages('u')).rejects.toMatchObject({
      code: 'revoked',
    });
  } finally {
    restore();
  }
});

test('upstream 5xx maps to unavailable without leaking the upstream body', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({ detail: 'SECRET-UPSTREAM-PAYLOAD' }, 502),
  );

  try {
    const error = await getRecentGmailMessages('u').catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'unavailable' });
    expect((error as Error).message).not.toContain('SECRET-UPSTREAM-PAYLOAD');
  } finally {
    restore();
  }
});

test('workspace-connect outage fails safely for data functions', async () => {
  const { restore } = mockFetch(() => {
    throw new TypeError('fetch failed');
  });

  try {
    await expect(getUpcomingCalendarEvents('u')).rejects.toMatchObject({
      code: 'unavailable',
    });
  } finally {
    restore();
  }
});

test('no cross-user cache: each user gets a fresh token and request', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse({ messages: [] }));

  try {
    await getRecentGmailMessages('user-a');
    await getRecentGmailMessages('user-b');

    expect(calls).toHaveLength(2);

    const tokenA = decodeJwtPayload(bearerToken(calls[0].init));
    const tokenB = decodeJwtPayload(bearerToken(calls[1].init));

    expect(tokenA.external_user_id).toBe('user-a');
    expect(tokenB.external_user_id).toBe('user-b');
    expect(tokenA.jti).not.toBe(tokenB.jti);
  } finally {
    restore();
  }
});

test('malformed Gmail and calendar responses are rejected', () => {
  expect(() => parseGmailMessagesResponse({})).toThrow(WorkspaceConnectError);
  expect(() => parseGmailThreadResponse(null)).toThrow(WorkspaceConnectError);
  expect(() => parseCalendarEventsResponse({ events: 'nope' })).toThrow(
    WorkspaceConnectError,
  );
});

test('parse helpers are lenient with missing optional email fields', () => {
  const messages = parseGmailMessagesResponse({
    messages: [{ message_id: 'm', thread_id: 't', sender: 'S' }],
  });

  expect(messages[0]).toMatchObject({
    messageId: 'm',
    threadId: 't',
    sender: 'S',
    recipients: [],
    subject: '',
    labelIds: [],
    isUnread: false,
  });
});

test('Gmail query limit and length are bounded', () => {
  expect(parseGmailMessagesQuery(null, null)).toEqual({
    ok: true,
    limit: 10,
    query: null,
  });
  expect(parseGmailMessagesQuery('5', 'from:alice')).toEqual({
    ok: true,
    limit: 5,
    query: 'from:alice',
  });
  expect(parseGmailMessagesQuery('0', null)).toEqual({
    ok: false,
    error: 'invalid_limit',
  });
  expect(parseGmailMessagesQuery('21', null)).toEqual({
    ok: false,
    error: 'invalid_limit',
  });
  expect(parseGmailMessagesQuery('abc', null)).toEqual({
    ok: false,
    error: 'invalid_limit',
  });
  expect(parseGmailMessagesQuery('1.5', null)).toEqual({
    ok: false,
    error: 'invalid_limit',
  });
  expect(parseGmailMessagesQuery(null, 'x'.repeat(257))).toEqual({
    ok: false,
    error: 'invalid_query',
  });
});

test('thread ids are validated as opaque single path segments', () => {
  expect(validateThreadId('thread-123')).toBe('thread-123');
  expect(validateThreadId('')).toBeNull();
  expect(validateThreadId('a/b')).toBeNull();
  expect(validateThreadId('..')).toBeNull();
  expect(validateThreadId('.')).toBeNull();
  expect(validateThreadId('x'.repeat(256))).toBeNull();
});

test('extractPlainTextFromHtml strips markup and decodes entities', () => {
  expect(
    extractPlainTextFromHtml(
      '<div><style>p{color:red}</style><script>alert(1)</script><p>Hello &amp; <b>world</b></p></div>',
    ),
  ).toBe('Hello & world');
});

test('thread message plain text prefers plain text and falls back to HTML text', () => {
  const withPlain: GmailThreadMessage = {
    messageId: 'm1',
    sender: 'S',
    recipients: [],
    cc: [],
    subject: '',
    date: '',
    plainTextBody: 'The plain body',
    htmlBody: '<p>Ignored <b>HTML</b></p>',
    attachments: [],
  };
  const htmlOnly: GmailThreadMessage = {
    ...withPlain,
    plainTextBody: null,
    htmlBody: '<p>Only <i>HTML</i></p>',
  };
  const empty: GmailThreadMessage = {
    ...withPlain,
    plainTextBody: null,
    htmlBody: null,
  };

  expect(getThreadMessagePlainText(withPlain)).toBe('The plain body');
  expect(getThreadMessagePlainText(htmlOnly)).toBe('Only HTML');
  expect(getThreadMessagePlainText(empty)).toBe('(no body)');
});

test('calendar and message date labels render safely', () => {
  const allDay: CalendarEvent = {
    eventId: 'e',
    calendarId: 'primary',
    status: 'confirmed',
    title: '',
    description: null,
    location: null,
    start: null,
    end: null,
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    timeZone: null,
    allDay: true,
    htmlLink: null,
  };

  expect(calendarEventTimeLabel(allDay)).toBe('2026-08-10 (all day)');

  const timed: CalendarEvent = {
    ...allDay,
    allDay: false,
    startDate: null,
    endDate: null,
    start: '2026-08-07T09:00:00.000Z',
    end: '2026-08-07T09:30:00.000Z',
  };

  const label = calendarEventTimeLabel(timed);
  expect(label).toMatch(/AM|PM/);
  expect(label).toContain('–');

  expect(formatGmailMessageDate('2026-08-05T12:00:00.000Z')).toMatch(
    /^[A-Z][a-z]{2} \d{1,2}$/,
  );
  expect(formatGmailMessageDate('not-a-date')).toBe('not-a-date');
});

test('integration failure reasons map to readable messages', () => {
  expect(integrationFailureReason('not_connected')).toBe('not_connected');
  expect(integrationFailureReason('revoked')).toBe('revoked');
  expect(integrationFailureReason('invalid_response')).toBe('unavailable');
  expect(integrationFailureReason('unknown-code')).toBe('unavailable');
  expect(describeIntegrationFailure('not_connected')).toContain(
    'not connected',
  );
  expect(describeIntegrationFailure('revoked')).toContain('revoked');
  expect(describeIntegrationFailure('unavailable')).toContain('unavailable');
});
