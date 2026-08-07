import { expect, test } from '@playwright/test';

import {
  buildTinyFishFetchTool,
  isPublicIpAddress,
  validatePublicWebUrl,
  verifiedSourceRole,
  type HostnameResolver,
} from '@/lib/agent/tinyfish-fetch';

const originalFetch = globalThis.fetch;
const publicResolver: HostnameResolver = async () => [
  { address: '93.184.216.34', family: 4 },
];

function fetchTool(resolveHostname: HostnameResolver = publicResolver) {
  return buildTinyFishFetchTool({
    resolveHostname,
    isUrlAllowed: () => true,
  }) as unknown as {
    invoke(
      input: { url: string },
      config?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
}

test.beforeEach(() => {
  process.env.TINYFISH_API_KEY = 'tinyfish-test-key';
  process.env.TINYFISH_FETCH_TIMEOUT_MS = '120000';
  process.env.TINYFISH_FETCH_MAX_CONTENT_CHARS = '32000';
});

test.afterEach(() => {
  process.env.TINYFISH_API_KEY = '';
  process.env.TINYFISH_FETCH_TIMEOUT_MS = '';
  process.env.TINYFISH_FETCH_MAX_CONTENT_CHARS = '';
  globalThis.fetch = originalFetch;
});

test('accepts only credential-free public HTTP and HTTPS URLs', async () => {
  await expect(
    validatePublicWebUrl('https://example.com/report#section', publicResolver),
  ).resolves.toMatchObject({
    href: 'https://example.com/report',
  });

  for (const url of [
    'file:///etc/passwd',
    'ftp://example.com/file',
    'https://user:password@example.com/private',
    'https://example.com/callback?token=secret',
    'not a URL',
  ]) {
    await expect(validatePublicWebUrl(url, publicResolver)).rejects.toThrow();
  }
});

test('blocks localhost, metadata, private IPs, and hostnames resolving internally', async () => {
  for (const url of [
    'http://localhost/admin',
    'http://service.internal/data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://127.0.0.1',
    'http://2130706433',
    'http://10.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://192.0.2.1',
    'http://[::1]',
    'http://[fd00::1]',
    'http://[::ffff:7f00:1]',
  ]) {
    await expect(validatePublicWebUrl(url, publicResolver)).rejects.toThrow(
      'Private or internal',
    );
  }

  await expect(
    validatePublicWebUrl('https://public-looking.example', async () => [
      { address: '10.1.2.3', family: 4 },
    ]),
  ).rejects.toThrow('Private or internal');

  expect(isPublicIpAddress('8.8.8.8')).toBe(true);
  expect(isPublicIpAddress('100.64.0.1')).toBe(false);
});

test('fetches one page as bounded clean Markdown with no browser controls', async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init: init ?? {} };
    return new Response(
      JSON.stringify({
        results: [
          {
            url: 'https://example.com/order',
            final_url: 'https://example.com/order#decision',
            title: 'Official court order',
            text: `# Decision\n\n${'Evidence '.repeat(20)}`,
          },
        ],
        errors: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  process.env.TINYFISH_FETCH_MAX_CONTENT_CHARS = '60';

  const result = (await fetchTool().invoke({
    url: 'https://example.com/order#page-2',
  })) as Record<string, unknown>;

  expect(captured?.url).toBe('https://api.fetch.tinyfish.ai');
  expect(captured?.init.method).toBe('POST');
  expect(captured?.init.cache).toBe('no-store');
  expect((captured?.init.headers as Record<string, string>)['X-API-Key']).toBe(
    'tinyfish-test-key',
  );
  expect(JSON.parse(String(captured?.init.body))).toEqual({
    urls: ['https://example.com/order'],
    format: 'markdown',
    links: false,
    image_links: false,
  });
  expect(result).toMatchObject({
    url: 'https://example.com/order',
    finalUrl: 'https://example.com/order',
    title: 'Official court order',
    truncated: true,
    sourceRole: 'unverified',
  });
  expect(String(result.content)).toHaveLength(60);
  expect(JSON.stringify(result)).not.toContain('tinyfish-test-key');
});

test('authority role is derived conservatively rather than supplied by the model', () => {
  const paper = verifiedSourceRole(
    new URL('https://www.nature.com/articles/s41586-026-12345-6'),
    'Political effects of an algorithmic feed',
    'Abstract and methods. '.repeat(80),
  );
  const news = verifiedSourceRole(
    new URL('https://www.nature.com/articles/d41586-026-00486-z'),
    'News: an algorithmic feed shifted opinions',
    'News analysis. '.repeat(80),
  );
  const lawFirm = verifiedSourceRole(
    new URL('https://cms.law/en/deu/publication/case-note'),
    'Client alert and case note',
    'Legal analysis. '.repeat(80),
  );

  expect(paper).toBe('official');
  expect(news).toBe('secondary');
  expect(lawFirm).toBe('secondary');
});

test('rejects a public URL that Brave did not discover', async () => {
  const tool = buildTinyFishFetchTool({
    resolveHostname: publicResolver,
  }) as unknown as {
    invoke(input: { url: string }): Promise<unknown>;
  };

  await expect(
    tool.invoke({ url: 'https://example.com/not-discovered' }),
  ).resolves.toEqual({
    error: 'That page must first be discovered through public web research.',
  });
  expect(globalThis.fetch).toBe(originalFetch);
});

test('preserves caller cancellation and enforces its own bounded timeout', async () => {
  let markFetchStarted = () => {};
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      markFetchStarted();
      init?.signal?.addEventListener('abort', () =>
        reject((init.signal as AbortSignal).reason),
      );
    })) as typeof fetch;

  const controller = new AbortController();
  const cancelled = fetchTool().invoke(
    { url: 'https://example.com/slow' },
    { signal: controller.signal },
  );
  await fetchStarted;
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

  process.env.TINYFISH_FETCH_TIMEOUT_MS = '5';
  await expect(
    fetchTool().invoke({ url: 'https://example.com/slow' }),
  ).resolves.toEqual({ error: 'That page took too long to read.' });
});

test('sanitizes HTTP and per-page errors and failed reads yield no evidence', async () => {
  globalThis.fetch = (async () =>
    new Response('upstream secret diagnostic tinyfish-test-key', {
      status: 500,
    })) as typeof fetch;

  const httpError = await fetchTool().invoke({ url: 'https://example.com' });
  expect(httpError).toEqual({
    error: 'That public page could not be read right now.',
  });
  expect(JSON.stringify(httpError)).not.toContain('upstream secret');
  expect(JSON.stringify(httpError)).not.toContain('tinyfish-test-key');

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [],
        errors: [
          {
            url: 'https://example.com',
            error: 'proxy_error: internal upstream details',
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  const pageError = await fetchTool().invoke({ url: 'https://example.com' });
  expect(pageError).toEqual({
    error: 'That public page could not be read right now.',
  });
  expect(JSON.stringify(pageError)).not.toContain('internal upstream');
});
