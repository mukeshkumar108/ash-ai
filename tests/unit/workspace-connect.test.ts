import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

import {
  buildIntegrationsStatusResponse,
  deriveGoogleCapabilities,
} from '@/lib/integrations';
import * as workspaceConnect from '@/lib/workspace-connect';
import {
  createGoogleConnectUrl,
  disconnectGoogle,
  getGoogleConnectionStatus,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';

const TEST_BASE_URL = 'http://workspace-connect.test';
const TEST_SECRET = 'test-only-signing-secret-at-least-32-bytes!!';
const TEST_APPLICATION_ID = 'ash-test';
const TEST_RETURN_URL = 'http://localhost:3000/settings/integrations';

const originalFetch = globalThis.fetch;

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function decodeJwt(token: string): DecodedJwt {
  const [encodedHeader, encodedPayload, signature] = token.split('.');

  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error('malformed token');
  }

  return {
    header: JSON.parse(base64UrlDecode(encodedHeader)) as Record<
      string,
      unknown
    >,
    payload: JSON.parse(base64UrlDecode(encodedPayload)) as Record<
      string,
      unknown
    >,
  };
}

function verifyHs256(token: string, secret: string): boolean {
  const [encodedHeader, encodedPayload, signature] = token.split('.');

  if (!encodedHeader || !encodedPayload || !signature) {
    return false;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expected = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return expected === signature;
}

function tokenFromConnectUrl(url: string): string {
  const token = new URL(url).searchParams.get('token');

  if (!token) {
    throw new Error('no token in connect URL');
  }

  return token;
}

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

function bearerToken(init: RequestInit): string {
  const headers = init.headers as Record<string, string> | undefined;
  const authorization = headers?.authorization ?? '';

  expect(authorization.startsWith('Bearer ')).toBe(true);
  return authorization.slice('Bearer '.length);
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
  globalThis.fetch = originalFetch;
});

test('createGoogleConnectUrl mints an HS256 google_connect token with return_url', () => {
  const url = createGoogleConnectUrl('stable-user-123');

  expect(url.startsWith(`${TEST_BASE_URL}/google/connect?token=`)).toBe(true);

  const token = tokenFromConnectUrl(url);
  const { header, payload } = decodeJwt(token);

  expect(header.alg).toBe('HS256');
  expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
  expect(payload.application_id).toBe(TEST_APPLICATION_ID);
  expect(payload.external_user_id).toBe('stable-user-123');
  expect(payload.purpose).toBe('google_connect');
  expect(payload.return_url).toBe(TEST_RETURN_URL);
  expect(typeof payload.iat).toBe('number');
  expect(typeof payload.exp).toBe('number');
  expect(typeof payload.jti).toBe('string');
  expect((payload.exp as number) - (payload.iat as number)).toBe(300);
  expect(verifyHs256(token, TEST_SECRET)).toBe(true);
  expect(token.split('.')).toHaveLength(3);
  expect(token.split('.').every((segment) => !segment.includes('='))).toBe(
    true,
  );
});

test('supported unusual user IDs serialize and sign without corruption', () => {
  const externalUserId = 'user.name-with_symbols@tenant_42';
  const token = tokenFromConnectUrl(createGoogleConnectUrl(externalUserId));
  const { payload } = decodeJwt(token);

  expect(payload.external_user_id).toBe(externalUserId);
  expect(verifyHs256(token, TEST_SECRET)).toBe(true);
});

test('unsupported Unicode and control-character user IDs are rejected before signing', () => {
  for (const externalUserId of [
    '用户',
    'user/other',
    'user\u0000id',
    ' user ',
  ]) {
    expect(() => createGoogleConnectUrl(externalUserId)).toThrow(
      WorkspaceConnectError,
    );
  }
});

test('api_access tokens carry correct claims and never a return_url', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      connected: false,
      google_email: null,
      granted_scopes: null,
      status: 'not_connected',
    }),
  );

  try {
    await getGoogleConnectionStatus('stable-user-123');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TEST_BASE_URL}/google/status`);

    const token = bearerToken(calls[0].init);
    const { payload } = decodeJwt(token);

    expect(payload.purpose).toBe('api_access');
    expect(payload.application_id).toBe(TEST_APPLICATION_ID);
    expect(payload.external_user_id).toBe('stable-user-123');
    expect(payload.return_url).toBeUndefined();
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);
    expect(verifyHs256(token, TEST_SECRET)).toBe(true);
  } finally {
    restore();
  }
});

test('status requests use Bearer auth on the /google/status endpoint', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      connected: true,
      google_email: 'user@example.com',
      granted_scopes: ['gmail.readonly'],
      status: 'active',
    }),
  );

  try {
    const result = await getGoogleConnectionStatus('stable-user-123');

    expect(result.connected).toBe(true);
    expect(result.google_email).toBe('user@example.com');
    expect(calls[0].init.method).toBe('GET');
    expect(bearerToken(calls[0].init).length).toBeGreaterThan(0);
  } finally {
    restore();
  }
});

test('disconnect requests use Bearer auth on DELETE /google/connection', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({ status: 'deleted', message: 'revoked' }),
  );

  try {
    await disconnectGoogle('stable-user-123');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TEST_BASE_URL}/google/connection`);
    expect(calls[0].init.method).toBe('DELETE');

    const token = bearerToken(calls[0].init);
    expect(decodeJwt(token).payload.purpose).toBe('api_access');
    expect(decodeJwt(token).payload.external_user_id).toBe('stable-user-123');
  } finally {
    restore();
  }
});

test('connect tokens get a fresh jti on every call', () => {
  const first = tokenFromConnectUrl(createGoogleConnectUrl('stable-user-123'));
  const second = tokenFromConnectUrl(createGoogleConnectUrl('stable-user-123'));

  expect(decodeJwt(first).payload.jti).not.toBe(decodeJwt(second).payload.jti);
});

test('two Ash users produce different external_user_id claims', () => {
  const userA = decodeJwt(
    tokenFromConnectUrl(createGoogleConnectUrl('user-a')),
  ).payload;
  const userB = decodeJwt(
    tokenFromConnectUrl(createGoogleConnectUrl('user-b')),
  ).payload;

  expect(userA.external_user_id).toBe('user-a');
  expect(userB.external_user_id).toBe('user-b');
  expect(userA.external_user_id).not.toBe(userB.external_user_id);
});

test('client-supplied identity cannot override the authenticated user id', async () => {
  const { calls, restore } = mockFetch(() =>
    jsonResponse({
      connected: false,
      google_email: null,
      granted_scopes: null,
      status: 'not_connected',
    }),
  );

  try {
    await getGoogleConnectionStatus('server-resolved-user-42');

    const token = bearerToken(calls[0].init);
    expect(decodeJwt(token).payload.external_user_id).toBe(
      'server-resolved-user-42',
    );
  } finally {
    restore();
  }
});

test('empty authenticated user ids are rejected', async () => {
  expect(() => createGoogleConnectUrl('')).toThrow(WorkspaceConnectError);

  const { restore } = mockFetch(() => jsonResponse({ connected: false }));

  try {
    await expect(getGoogleConnectionStatus('')).rejects.toBeInstanceOf(
      WorkspaceConnectError,
    );
  } finally {
    restore();
  }
});

test('workspace-connect outage fails safely', async () => {
  const { restore } = mockFetch(() => {
    throw new TypeError('fetch failed');
  });

  try {
    await expect(
      getGoogleConnectionStatus('stable-user-123'),
    ).rejects.toMatchObject({ code: 'unavailable' });
  } finally {
    restore();
  }
});

test('workspace-connect 5xx failures are surfaced safely', async () => {
  const { restore } = mockFetch(() => jsonResponse({ detail: 'boom' }, 500));

  try {
    await expect(disconnectGoogle('stable-user-123')).rejects.toMatchObject({
      code: 'unavailable',
    });
  } finally {
    restore();
  }
});

test('disconnect treats an already-disconnected 404 as success', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse(
      { detail: 'No active Google connection found to delete' },
      404,
    ),
  );

  try {
    await expect(disconnectGoogle('stable-user-123')).resolves.toBeUndefined();
  } finally {
    restore();
  }
});

test('workspace-connect identity rejections map to unauthorized/forbidden', async () => {
  const status401 = mockFetch(() => jsonResponse({ detail: 'expired' }, 401));
  try {
    await expect(getGoogleConnectionStatus('u')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  } finally {
    status401.restore();
  }

  const status403 = mockFetch(() => jsonResponse({ detail: 'forbidden' }, 403));
  try {
    await expect(disconnectGoogle('u')).rejects.toMatchObject({
      code: 'forbidden',
    });
  } finally {
    status403.restore();
  }
});

test('missing signing secret fails safely', () => {
  process.env.WORKSPACE_CONNECT_SIGNING_SECRET = '';

  expect(() => createGoogleConnectUrl('stable-user-123')).toThrow(
    WorkspaceConnectError,
  );
});

test('short signing secrets are rejected', () => {
  process.env.WORKSPACE_CONNECT_SIGNING_SECRET = 'too-short';

  expect(() => createGoogleConnectUrl('stable-user-123')).toThrow(
    WorkspaceConnectError,
  );
});

test('signing secret remains server-only', () => {
  const exportedKeys = Object.keys(workspaceConnect);

  expect(exportedKeys.some((key) => key.toLowerCase().includes('secret'))).toBe(
    false,
  );
  expect(createGoogleConnectUrl('stable-user-123')).not.toContain(TEST_SECRET);
});

test('connected status surfaces the Google email for the UI', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({
      connected: true,
      google_email: 'user@example.com',
      granted_scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      status: 'active',
    }),
  );

  try {
    const result = await getGoogleConnectionStatus('stable-user-123');

    expect(buildIntegrationsStatusResponse(result)).toEqual({
      available: true,
      connected: true,
      googleEmail: 'user@example.com',
      gmailAuthorized: true,
      calendarAuthorized: true,
      status: 'active',
    });
  } finally {
    restore();
  }
});

test('disconnected status renders a not_connected response', async () => {
  const { restore } = mockFetch(() =>
    jsonResponse({
      connected: false,
      google_email: null,
      granted_scopes: null,
      status: 'not_connected',
    }),
  );

  try {
    const result = await getGoogleConnectionStatus('stable-user-123');

    expect(buildIntegrationsStatusResponse(result)).toEqual({
      available: true,
      connected: false,
      googleEmail: null,
      gmailAuthorized: false,
      calendarAuthorized: false,
      status: 'not_connected',
    });
  } finally {
    restore();
  }
});

test.describe('deriveGoogleCapabilities', () => {
  test('detects Gmail scopes', () => {
    expect(deriveGoogleCapabilities(['gmail.readonly']).gmailAuthorized).toBe(
      true,
    );
    expect(
      deriveGoogleCapabilities(['https://mail.google.com/']).gmailAuthorized,
    ).toBe(true);
  });

  test('detects Calendar scopes', () => {
    expect(
      deriveGoogleCapabilities(['calendar.events']).calendarAuthorized,
    ).toBe(true);
    expect(
      deriveGoogleCapabilities([
        'https://www.googleapis.com/auth/calendar.readonly',
      ]).calendarAuthorized,
    ).toBe(true);
  });

  test('null or empty scopes authorize nothing', () => {
    expect(deriveGoogleCapabilities(null)).toEqual({
      gmailAuthorized: false,
      calendarAuthorized: false,
    });
    expect(deriveGoogleCapabilities([])).toEqual({
      gmailAuthorized: false,
      calendarAuthorized: false,
    });
  });
});
