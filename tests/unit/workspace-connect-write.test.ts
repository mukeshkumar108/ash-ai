import { test, expect } from '@playwright/test';

import * as workspaceConnect from '@/lib/workspace-connect';
import {
  createCalendarEvent,
  createGmailDraft,
  deleteCalendarEvent,
  deleteGmailDraft,
  getCalendarEvent,
  getGmailDraft,
  updateCalendarEvent,
  updateGmailDraft,
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

  if (!encodedPayload) {
    throw new Error('malformed token');
  }

  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
}

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
}

const draftCreateResponse = {
  draft_id: 'draft-1',
  message_id: 'msg-1',
  thread_id: 'thread-1',
  recipients: ['alice@example.com'],
  subject: 'Hello',
  created: true,
};

const draftDetailResponse = {
  draft_id: 'draft-1',
  message_id: 'msg-1',
  thread_id: 'thread-1',
  to: ['alice@example.com'],
  cc: ['cc@example.com'],
  bcc: [],
  subject: 'Hello',
  plain_text_body: 'Hello body',
  html_body: null,
};

const eventResponse = {
  event_id: 'evt-1',
  calendar_id: 'primary',
  status: 'confirmed',
  title: 'Meeting',
  description: 'A meeting',
  location: 'Zoom',
  start: '2026-08-07T09:00:00.000Z',
  end: '2026-08-07T09:30:00.000Z',
  start_date: null,
  end_date: null,
  time_zone: 'UTC',
  all_day: false,
  html_link: 'https://calendar.google.com/calendar/event?eid=abc',
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

test('createGmailDraft posts exact safe fields and parses the created draft', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(draftCreateResponse));

  try {
    const draft = await createGmailDraft('stable-user-123', {
      to: ['alice@example.com'],
      cc: ['bob@example.com'],
      bcc: [],
      subject: 'Hello',
      plainTextBody: 'Hello body',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TEST_BASE_URL}/gmail/drafts`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.cache).toBe('no-store');
    expect(decodeJwtPayload(bearerToken(calls[0].init)).external_user_id).toBe(
      'stable-user-123',
    );

    expect(parseBody(calls[0].init)).toEqual({
      to: ['alice@example.com'],
      cc: ['bob@example.com'],
      bcc: [],
      subject: 'Hello',
      plain_text_body: 'Hello body',
    });

    expect(draft).toEqual({
      draftId: 'draft-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
      to: ['alice@example.com'],
      cc: [],
      bcc: [],
      subject: 'Hello',
      plainTextBody: null,
      htmlBody: null,
    });
  } finally {
    restore();
  }
});

test('reply draft forwards messageId and threadId as opaque IDs', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(draftCreateResponse));

  try {
    await createGmailDraft('stable-user-123', {
      to: ['alice@example.com'],
      subject: 'Re: Hello',
      plainTextBody: 'Reply body',
      replyToMessageId: 'msg-9',
      threadId: 'thread-1',
    });

    const body = parseBody(calls[0].init);
    expect(body.reply_to_message_id).toBe('msg-9');
    expect(body.thread_id).toBe('thread-1');
  } finally {
    restore();
  }
});

test('getGmailDraft retrieves with the encoded opaque draftId', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(draftDetailResponse));

  try {
    const draft = await getGmailDraft('stable-user-123', 'draft abc+1');

    expect(calls[0].url).toBe(
      `${TEST_BASE_URL}/gmail/drafts/${encodeURIComponent('draft abc+1')}`,
    );
    expect(calls[0].init.method).toBe('GET');
    expect(draft.draftId).toBe('draft-1');
    expect(draft.plainTextBody).toBe('Hello body');
  } finally {
    restore();
  }
});

test('updateGmailDraft patches only the provided fields', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(draftDetailResponse));

  try {
    await updateGmailDraft('stable-user-123', 'draft-1', {
      subject: 'Updated subject',
    });

    expect(calls[0].url).toBe(`${TEST_BASE_URL}/gmail/drafts/draft-1`);
    expect(calls[0].init.method).toBe('PATCH');
    expect(parseBody(calls[0].init)).toEqual({ subject: 'Updated subject' });
  } finally {
    restore();
  }
});

test('deleteGmailDraft deletes the exact draft', async () => {
  const { calls, restore } = mockFetch(
    () => new Response(null, { status: 204 }),
  );

  try {
    await deleteGmailDraft('stable-user-123', 'draft-1');

    expect(calls[0].url).toBe(`${TEST_BASE_URL}/gmail/drafts/draft-1`);
    expect(calls[0].init.method).toBe('DELETE');
  } finally {
    restore();
  }
});

test('createCalendarEvent posts timed fields on primary with Idempotency-Key', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(eventResponse));

  try {
    const event = await createCalendarEvent(
      'stable-user-123',
      {
        kind: 'timed',
        title: 'Meeting',
        description: 'A meeting',
        location: 'Zoom',
        start: '2026-08-07T09:00:00Z',
        end: '2026-08-07T09:30:00Z',
        timeZone: 'Europe/London',
      },
      '9f0c6f6e-0000-4000-8000-000000000000',
    );

    expect(calls[0].url).toBe(`${TEST_BASE_URL}/calendar/events`);
    expect(calls[0].init.method).toBe('POST');
    expect(headersOf(calls[0].init)['idempotency-key']).toBe(
      '9f0c6f6e-0000-4000-8000-000000000000',
    );

    expect(parseBody(calls[0].init)).toEqual({
      calendar_id: 'primary',
      title: 'Meeting',
      description: 'A meeting',
      location: 'Zoom',
      start: '2026-08-07T09:00:00Z',
      end: '2026-08-07T09:30:00Z',
      time_zone: 'Europe/London',
    });

    expect(event.eventId).toBe('evt-1');
    expect(event.calendarId).toBe('primary');
    expect(event.allDay).toBe(false);
    expect(event.htmlLink).toBe(
      'https://calendar.google.com/calendar/event?eid=abc',
    );
  } finally {
    restore();
  }
});

test('createCalendarEvent posts all-day fields without mixing timed fields', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      ...eventResponse,
      start: null,
      end: null,
      start_date: '2026-08-10',
      end_date: '2026-08-11',
      all_day: true,
    }),
  );

  try {
    await createCalendarEvent(
      'stable-user-123',
      {
        kind: 'allDay',
        title: 'Holiday',
        startDate: '2026-08-10',
        endDate: '2026-08-11',
      },
      '0f0c6f6e-0000-4000-8000-000000000001',
    );

    const body = parseBody(calls[0].init);
    expect(body.calendar_id).toBe('primary');
    expect(body.start_date).toBe('2026-08-10');
    expect(body.end_date).toBe('2026-08-11');
    expect(body.start).toBeUndefined();
    expect(body.end).toBeUndefined();
    expect(body.time_zone).toBeUndefined();
  } finally {
    restore();
  }
});

test('getCalendarEvent uses the exact encoded eventId on primary', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(eventResponse));

  try {
    const event = await getCalendarEvent('stable-user-123', 'evt 9+1');

    expect(calls[0].url).toBe(
      `${TEST_BASE_URL}/calendar/events/${encodeURIComponent('evt 9+1')}?calendar_id=primary`,
    );
    expect(calls[0].init.method).toBe('GET');
    expect(event.eventId).toBe('evt-1');
  } finally {
    restore();
  }
});

test('updateCalendarEvent patches only provided fields on the exact event', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(eventResponse));

  try {
    await updateCalendarEvent('stable-user-123', 'evt-1', {
      title: 'Renamed meeting',
      location: 'Room 4',
    });

    expect(calls[0].url).toBe(
      `${TEST_BASE_URL}/calendar/events/evt-1?calendar_id=primary`,
    );
    expect(calls[0].init.method).toBe('PATCH');
    expect(parseBody(calls[0].init)).toEqual({
      title: 'Renamed meeting',
      location: 'Room 4',
    });
  } finally {
    restore();
  }
});

test('deleteCalendarEvent deletes the exact event on primary', async () => {
  const { calls, restore } = mockFetch(
    () => new Response(null, { status: 204 }),
  );

  try {
    await deleteCalendarEvent('stable-user-123', 'evt-1');

    expect(calls[0].url).toBe(
      `${TEST_BASE_URL}/calendar/events/evt-1?calendar_id=primary`,
    );
    expect(calls[0].init.method).toBe('DELETE');
  } finally {
    restore();
  }
});

test('write error mapping is safe and precise', async () => {
  const cases: Array<{
    status: number;
    operation: () => Promise<unknown>;
    code: string;
  }> = [
    {
      status: 404,
      operation: () =>
        createGmailDraft('u', {
          to: ['a@example.com'],
          subject: 's',
          plainTextBody: 'b',
        }),
      code: 'not_connected',
    },
    {
      status: 404,
      operation: () => getGmailDraft('u', 'draft-1'),
      code: 'not_found',
    },
    {
      status: 401,
      operation: () =>
        createGmailDraft('u', {
          to: ['a@example.com'],
          subject: 's',
          plainTextBody: 'b',
        }),
      code: 'revoked',
    },
    {
      status: 403,
      operation: () =>
        createGmailDraft('u', {
          to: ['a@example.com'],
          subject: 's',
          plainTextBody: 'b',
        }),
      code: 'forbidden',
    },
    {
      status: 400,
      operation: () =>
        createGmailDraft('u', {
          to: ['a@example.com'],
          subject: 's',
          plainTextBody: 'b',
        }),
      code: 'invalid',
    },
    {
      status: 409,
      operation: () =>
        createCalendarEvent(
          'u',
          {
            kind: 'timed',
            title: 't',
            start: '2026-08-07T09:00:00Z',
            end: '2026-08-07T09:30:00Z',
            timeZone: 'UTC',
          },
          '9f0c6f6e-0000-4000-8000-000000000000',
        ),
      code: 'conflict',
    },
    {
      status: 502,
      operation: () =>
        createCalendarEvent(
          'u',
          {
            kind: 'timed',
            title: 't',
            start: '2026-08-07T09:00:00Z',
            end: '2026-08-07T09:30:00Z',
            timeZone: 'UTC',
          },
          '9f0c6f6e-0000-4000-8000-000000000000',
        ),
      code: 'unavailable',
    },
    {
      status: 404,
      operation: () => deleteCalendarEvent('u', 'evt-1'),
      code: 'not_found',
    },
  ];

  for (const testCase of cases) {
    const { restore } = mockFetch(() =>
      jsonResponse({ detail: 'upstream payload' }, testCase.status),
    );

    try {
      const error = await testCase.operation().catch((e: unknown) => e);
      expect(error).toMatchObject({ code: testCase.code });
      expect(String((error as Error).message)).not.toContain(
        'upstream payload',
      );
    } finally {
      restore();
    }
  }
});

test('workspace-connect outage fails safely for writes', async () => {
  const { restore } = mockFetch(() => {
    throw new TypeError('fetch failed');
  });

  try {
    await expect(deleteCalendarEvent('u', 'evt-1')).rejects.toMatchObject({
      code: 'unavailable',
    });
  } finally {
    restore();
  }
});

test('each write mints a fresh api_access token', async () => {
  const { calls, restore } = mockFetch(() => jsonResponse(draftDetailResponse));

  try {
    await getGmailDraft('user-a', 'd1');
    await getGmailDraft('user-b', 'd1');

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

test('no send capability is exposed by the module', () => {
  const exported = Object.keys(workspaceConnect);
  expect(exported.some((key) => /^send|sendGmail|sendEmail/i.test(key))).toBe(
    false,
  );
});
