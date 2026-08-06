import { expect, test } from '../fixtures';

function hasWorkspaceConnectConfig(): boolean {
  return Boolean(
    process.env.WORKSPACE_CONNECT_BASE_URL &&
      process.env.WORKSPACE_CONNECT_SIGNING_SECRET,
  );
}

test.describe('/api/integrations/google', () => {
  test('unauthenticated status/connect/disconnect are rejected', async ({
    browser,
  }) => {
    const context = await browser.newContext();

    try {
      const status = await context.request.get('/api/integrations/google');
      expect(status.status()).toBe(401);

      const connect = await context.request.post('/api/integrations/google');
      expect(connect.status()).toBe(401);

      const disconnect = await context.request.delete(
        '/api/integrations/google',
      );
      expect(disconnect.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('authenticated status is private and fails safely when workspace-connect is unavailable', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.get('/api/integrations/google');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');

    const body = await response.json();
    if (hasWorkspaceConnectConfig()) {
      expect(body.available).toBe(true);
      expect(typeof body.connected).toBe('boolean');
    } else {
      expect(body.available).toBe(false);
      expect(body.connected).toBe(false);
      expect(body.googleEmail).toBeNull();
      expect(body.status).toBe('unavailable');
    }
  });

  test('authenticated disconnect fails safely when workspace-connect is unreachable', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.delete(
      '/api/integrations/google',
    );
    expect([200, 502]).toContain(response.status());
  });

  test('authenticated connect redirects to workspace-connect or fails safely', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post('/api/integrations/google', {
      maxRedirects: 0,
    });

    if (hasWorkspaceConnectConfig()) {
      expect(response.status()).toBe(303);
      const location = response.headers().location ?? '';
      expect(
        location.startsWith(
          `${process.env.WORKSPACE_CONNECT_BASE_URL}/google/connect?token=`,
        ),
      ).toBe(true);
    } else {
      expect(response.status()).toBe(502);
    }
  });
});

test.describe('/api/integrations/google/gmail and calendar', () => {
  test('unauthenticated messages/thread/events are rejected', async ({
    browser,
  }) => {
    const context = await browser.newContext();

    try {
      const messages = await context.request.get(
        '/api/integrations/google/gmail/messages',
      );
      expect(messages.status()).toBe(401);

      const thread = await context.request.get(
        '/api/integrations/google/gmail/threads/any-thread',
      );
      expect(thread.status()).toBe(401);

      const events = await context.request.get(
        '/api/integrations/google/calendar/events',
      );
      expect(events.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('Gmail limit and query length are validated', async ({ adaContext }) => {
    for (const limit of ['0', '21', 'abc', '1.5']) {
      const response = await adaContext.request.get(
        `/api/integrations/google/gmail/messages?limit=${limit}`,
      );
      expect(response.status()).toBe(400);
    }

    const longQuery = await adaContext.request.get(
      `/api/integrations/google/gmail/messages?query=${'x'.repeat(257)}`,
    );
    expect(longQuery.status()).toBe(400);
  });

  test('invalid thread ids are rejected', async ({ adaContext }) => {
    const response = await adaContext.request.get(
      `/api/integrations/google/gmail/threads/${'x'.repeat(256)}`,
    );
    expect(response.status()).toBe(400);
  });

  test('authenticated data routes fail safely or return data', async ({
    adaContext,
  }) => {
    const messages = await adaContext.request.get(
      '/api/integrations/google/gmail/messages',
    );
    expect(messages.status()).toBe(200);
    expect(messages.headers()['cache-control']).toBe('no-store');

    const messagesBody = await messages.json();
    if (messagesBody.ok) {
      expect(Array.isArray(messagesBody.data.messages)).toBe(true);
    } else {
      expect([
        'unavailable',
        'not_connected',
        'revoked',
        'forbidden',
        'not_found',
      ]).toContain(messagesBody.reason);
    }

    const events = await adaContext.request.get(
      '/api/integrations/google/calendar/events',
    );
    expect(events.status()).toBe(200);
    expect(events.headers()['cache-control']).toBe('no-store');

    const eventsBody = await events.json();
    if (eventsBody.ok) {
      expect(Array.isArray(eventsBody.data.events)).toBe(true);
    } else {
      expect([
        'unavailable',
        'not_connected',
        'revoked',
        'forbidden',
        'not_found',
      ]).toContain(eventsBody.reason);
    }
  });

  test('browser-supplied identity and upstream parameters are ignored', async ({
    adaContext,
  }) => {
    const plain = await adaContext.request.get(
      '/api/integrations/google/gmail/messages',
    );
    const attacked = await adaContext.request.get(
      '/api/integrations/google/gmail/messages?external_user_id=attacker&calendar_id=evil&providerUrl=https://evil.example',
    );

    expect(plain.status()).toBe(200);
    expect(attacked.status()).toBe(200);

    const plainBody = await plain.json();
    const attackedBody = await attacked.json();
    expect(attackedBody.ok).toBe(plainBody.ok);
  });
});

test.describe('/api/integrations/google write routes', () => {
  const validDraftBody = {
    to: ['alice@example.com'],
    subject: 'Hello',
    plainTextBody: 'Body text',
  };

  const validEventBody = {
    operationId: '9f0c6f6e-0000-4000-8000-000000000000',
    title: 'Meeting',
    start: '2026-08-07T09:00:00+01:00',
    end: '2026-08-07T09:30:00+01:00',
    timeZone: 'Europe/London',
  };

  test('unauthenticated write routes are rejected', async ({ browser }) => {
    const context = await browser.newContext();

    try {
      const draftPost = await context.request.post(
        '/api/integrations/google/gmail/drafts',
        { data: validDraftBody },
      );
      expect(draftPost.status()).toBe(401);

      const draftGet = await context.request.get(
        '/api/integrations/google/gmail/drafts/draft-1',
      );
      expect(draftGet.status()).toBe(401);

      const draftPatch = await context.request.patch(
        '/api/integrations/google/gmail/drafts/draft-1',
        { data: { subject: 'x' } },
      );
      expect(draftPatch.status()).toBe(401);

      const draftDelete = await context.request.delete(
        '/api/integrations/google/gmail/drafts/draft-1',
      );
      expect(draftDelete.status()).toBe(401);

      const eventPost = await context.request.post(
        '/api/integrations/google/calendar/events',
        { data: validEventBody },
      );
      expect(eventPost.status()).toBe(401);

      const eventGet = await context.request.get(
        '/api/integrations/google/calendar/events/event-1',
      );
      expect(eventGet.status()).toBe(401);

      const eventPatch = await context.request.patch(
        '/api/integrations/google/calendar/events/event-1',
        { data: { title: 'x' } },
      );
      expect(eventPatch.status()).toBe(401);

      const eventDelete = await context.request.delete(
        '/api/integrations/google/calendar/events/event-1',
      );
      expect(eventDelete.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('draft validation rejects invalid recipients and CR/LF injection', async ({
    adaContext,
  }) => {
    const invalidEmail = await adaContext.request.post(
      '/api/integrations/google/gmail/drafts',
      { data: { ...validDraftBody, to: ['not-an-email'] } },
    );
    expect(invalidEmail.status()).toBe(400);
    expect((await invalidEmail.json()).error).toBe('invalid_recipient');

    const crlf = await adaContext.request.post(
      '/api/integrations/google/gmail/drafts',
      { data: { ...validDraftBody, subject: 'hi\r\nBcc: x@y.com' } },
    );
    expect(crlf.status()).toBe(400);
    expect((await crlf.json()).error).toBe('invalid_subject');
  });

  test('draft create requires a body', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/integrations/google/gmail/drafts',
      { data: { ...validDraftBody, plainTextBody: '' } },
    );
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('no_body');
  });

  test('calendar validation rejects naive datetimes, bad operationId, and unknown fields', async ({
    adaContext,
  }) => {
    const naive = await adaContext.request.post(
      '/api/integrations/google/calendar/events',
      {
        data: {
          ...validEventBody,
          start: '2026-08-07T09:00:00',
          end: '2026-08-07T09:30:00',
        },
      },
    );
    expect(naive.status()).toBe(400);
    expect((await naive.json()).error).toBe('invalid_datetime');

    const badOperationId = await adaContext.request.post(
      '/api/integrations/google/calendar/events',
      { data: { ...validEventBody, operationId: 'not-a-uuid' } },
    );
    expect(badOperationId.status()).toBe(400);
    expect((await badOperationId.json()).error).toBe('invalid_operation_id');

    const unknownField = await adaContext.request.post(
      '/api/integrations/google/calendar/events',
      {
        data: {
          ...validEventBody,
          attendees: [{ email: 'a@example.com' }],
        },
      },
    );
    expect(unknownField.status()).toBe(400);
    expect((await unknownField.json()).error).toBe('invalid_request');
  });

  test('browser-supplied identity fields are rejected by the strict schema', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post(
      '/api/integrations/google/gmail/drafts',
      {
        data: { ...validDraftBody, external_user_id: 'attacker' },
      },
    );
    expect(response.status()).toBe(400);
  });

  test('oversized write bodies are rejected', async ({ adaContext }) => {
    const response = await adaContext.request.post(
      '/api/integrations/google/gmail/drafts',
      {
        data: { ...validDraftBody, plainTextBody: 'x'.repeat(300_000) },
      },
    );
    expect(response.status()).toBe(413);
  });

  test('authenticated valid writes return data or fail safely', async ({
    adaContext,
  }) => {
    const draft = await adaContext.request.post(
      '/api/integrations/google/gmail/drafts',
      { data: validDraftBody },
    );
    expect(draft.status()).toBe(200);
    expect(draft.headers()['cache-control']).toBe('no-store');

    const draftBody = await draft.json();
    if (draftBody.ok) {
      expect(draftBody.data.draftId).toBeTruthy();
    } else {
      expect([
        'unavailable',
        'not_connected',
        'revoked',
        'forbidden',
        'not_found',
        'invalid',
        'conflict',
      ]).toContain(draftBody.reason);
    }

    const event = await adaContext.request.post(
      '/api/integrations/google/calendar/events',
      { data: validEventBody },
    );
    expect(event.status()).toBe(200);
    expect(event.headers()['cache-control']).toBe('no-store');

    const eventBody = await event.json();
    if (eventBody.ok) {
      expect(eventBody.data.eventId).toBeTruthy();
    } else {
      expect([
        'unavailable',
        'not_connected',
        'revoked',
        'forbidden',
        'not_found',
        'invalid',
        'conflict',
      ]).toContain(eventBody.reason);
    }
  });
});
