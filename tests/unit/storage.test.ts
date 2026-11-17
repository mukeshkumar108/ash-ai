import { expect, test } from '@playwright/test';

import {
  deleteObject,
  getObject,
  isPrivateStoredUrl,
  presignGetUrl,
  putObject,
} from '@/lib/storage';

const store = new Map<string, { body: Uint8Array; type: string }>();
const realFetch = globalThis.fetch;

test.beforeAll(() => {
  process.env.S3_ENDPOINT = 'https://s3.test';
  process.env.S3_BUCKET = 'bkt';
  process.env.S3_ACCESS_KEY_ID = 'k';
  process.env.S3_SECRET_ACCESS_KEY = 's';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as Request, init);
    const key = new URL(req.url).pathname;
    expect(req.headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
    if (req.method === 'PUT') {
      store.set(key, {
        body: new Uint8Array(await req.arrayBuffer()),
        type: req.headers.get('content-type') ?? '',
      });
      return new Response(null, { status: 200 });
    }
    if (req.method === 'DELETE') {
      store.delete(key);
      return new Response(null, { status: 204 });
    }
    const hit = store.get(key);
    return hit
      ? new Response(hit.body as BodyInit, { headers: { 'content-type': hit.type } })
      : new Response(null, { status: 404 });
  }) as typeof fetch;
});
test.afterAll(() => {
  globalThis.fetch = realFetch;
});

test.describe('object storage (S3)', () => {
  test('put/get/delete round trip keeps the pathname prefix', async () => {
    const obj = await putObject('uploads/u1/a.png', new Uint8Array([1, 2, 3]), {
      contentType: 'image/png',
    });
    expect(obj.pathname).toMatch(/^uploads\/u1\/a-[0-9a-f]{12}\.png$/);
    expect(obj.url).toBe(`s3://bkt/${obj.pathname}`);
    expect(isPrivateStoredUrl(obj.url)).toBe(true);
    const got = await getObject(obj.pathname);
    expect(got?.contentType).toBe('image/png');
    expect(new Uint8Array(await new Response(got!.stream).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await deleteObject(obj.pathname);
    expect(await getObject(obj.pathname)).toBeNull();
    await deleteObject(obj.pathname); // 404 is fine
  });

  test('presigned URLs are signed and expire', async () => {
    const url = new URL(await presignGetUrl('a/b.png', 60_000));
    expect(url.pathname).toBe('/bkt/a/b.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
