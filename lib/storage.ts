import 'server-only';

import { AwsClient } from 'aws4fetch';

/**
 * Private object storage seam. Every upload/download in the app goes through
 * here so the backend is a deployment choice, not a code change.
 *
 *   STORAGE_DRIVER=vercel-blob   (default; needs BLOB_READ_WRITE_TOKEN)
 *   STORAGE_DRIVER=s3            S3-compatible (Cloudflare R2, MinIO, AWS S3):
 *     S3_ENDPOINT           e.g. https://<account>.r2.cloudflarestorage.com
 *     S3_BUCKET             bucket name
 *     S3_ACCESS_KEY_ID
 *     S3_SECRET_ACCESS_KEY
 *     S3_REGION             optional, default "auto" (R2); use the real region on AWS
 *
 * The bucket stays private. Stored URLs for the s3 driver look like
 * `s3://<bucket>/<pathname>`; the browser reads them through /api/files, and
 * model providers get short-lived presigned URLs.
 */

export type StoredObject = {
  url: string;
  pathname: string;
  contentType: string;
};

export type ReadObject = { stream: ReadableStream<Uint8Array>; contentType: string | null };

function driver(): 'vercel-blob' | 's3' {
  return process.env.STORAGE_DRIVER?.trim() === 's3' ? 's3' : 'vercel-blob';
}

function s3Config() {
  const endpoint = process.env.S3_ENDPOINT?.trim().replace(/\/+$/, '');
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY',
    );
  }
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: process.env.S3_REGION?.trim() || 'auto',
  });
  return { endpoint, bucket, client };
}

function s3ObjectUrl(pathname: string) {
  const { endpoint, bucket } = s3Config();
  const key = pathname.split('/').map(encodeURIComponent).join('/');
  return `${endpoint}/${bucket}/${key}`;
}

function randomSuffix() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function withSuffix(pathname: string) {
  const dot = pathname.lastIndexOf('.');
  const slash = pathname.lastIndexOf('/');
  return dot > slash + 1
    ? `${pathname.slice(0, dot)}-${randomSuffix()}${pathname.slice(dot)}`
    : `${pathname}-${randomSuffix()}`;
}

/** True for URLs this app stores privately (must be read through the server). */
export function isPrivateStoredUrl(url: string) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 's3:' ||
      /^[^.]+\.private\.blob\.vercel-storage\.com$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}

export async function putObject(
  pathname: string,
  body: ArrayBuffer | Buffer | Uint8Array,
  options: { contentType?: string },
): Promise<StoredObject> {
  const contentType = options.contentType || 'application/octet-stream';
  if (driver() === 's3') {
    const { bucket, client } = s3Config();
    const key = withSuffix(pathname);
    const res = await client.fetch(s3ObjectUrl(key), {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: body as BodyInit,
    });
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
    return { url: `s3://${bucket}/${key}`, pathname: key, contentType };
  }
  const { put } = await import('@vercel/blob');
  const blob = await put(pathname, body as Buffer, {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
    contentType,
  });
  return { url: blob.url, pathname: blob.pathname, contentType: blob.contentType };
}

export async function getObject(pathname: string): Promise<ReadObject | null> {
  if (driver() === 's3') {
    const { client } = s3Config();
    const res = await client.fetch(s3ObjectUrl(pathname), { method: 'GET' });
    if (res.status !== 200 || !res.body) return null;
    return { stream: res.body, contentType: res.headers.get('content-type') };
  }
  const { get } = await import('@vercel/blob');
  const result = await get(pathname, {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  if (result?.statusCode !== 200 || !result.stream) return null;
  return { stream: result.stream, contentType: result.blob.contentType ?? null };
}

export async function deleteObject(pathname: string): Promise<void> {
  if (driver() === 's3') {
    const { client } = s3Config();
    const res = await client.fetch(s3ObjectUrl(pathname), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`);
    return;
  }
  const { del } = await import('@vercel/blob');
  await del(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
}

/** Short-lived GET URL a third party (e.g. a model provider) can fetch. */
export async function presignGetUrl(pathname: string, ttlMs: number): Promise<string> {
  if (driver() === 's3') {
    const { client } = s3Config();
    const url = new URL(s3ObjectUrl(pathname));
    url.searchParams.set('X-Amz-Expires', String(Math.max(1, Math.round(ttlMs / 1000))));
    const signed = await client.sign(new Request(url, { method: 'GET' }), {
      aws: { signQuery: true },
    });
    return signed.url;
  }
  const { issueSignedToken, presignUrl } = await import('@vercel/blob');
  const validUntil = Date.now() + ttlMs;
  const signedToken = await issueSignedToken({
    pathname,
    operations: ['get'],
    validUntil,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: signedToken.clientSigningToken,
      delegationToken: signedToken.delegationToken,
    },
    { operation: 'get', pathname, access: 'private', validUntil },
  );
  return presignedUrl;
}

/** Read a private object as a base64 data URI (providers cannot fetch private URLs). */
export async function readObjectDataUri(pathname: string): Promise<string | null> {
  try {
    const result = await getObject(pathname);
    if (!result) return null;
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    return `data:${result.contentType || 'image/png'};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
