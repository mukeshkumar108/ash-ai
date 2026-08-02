import 'server-only';

import { issueSignedToken, presignUrl } from '@vercel/blob';

import { isPrivateBlobUrl, getBlobPathname } from './blob';

const BLOB_SIGN_URL_MS = 30 * 60 * 1000;

async function presignBlobUrl(pathname: string) {
  const validUntil = Date.now() + BLOB_SIGN_URL_MS;
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  const signedToken = await issueSignedToken({
    pathname,
    operations: ['get'],
    validUntil,
    token,
  });

  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: signedToken.clientSigningToken,
      delegationToken: signedToken.delegationToken,
    },
    {
      operation: 'get',
      pathname,
      access: 'private',
      validUntil,
    },
  );

  return presignedUrl;
}

export async function presignFilePartUrls<T extends { parts: unknown[] }>(
  messages: T[],
): Promise<T[]> {
  const cache = new Map<string, Promise<string>>();

  const resolvePresigned = (pathname: string) => {
    if (!cache.has(pathname)) {
      cache.set(pathname, presignBlobUrl(pathname));
    }
    return cache.get(pathname)!;
  };

  return Promise.all(
    messages.map(async (message) => {
      const parts = await Promise.all(
        message.parts.map(async (part) => {
          if (typeof part !== 'object' || part === null) return part;
          const p = part as { type?: string; url?: string };
          if (p.type !== 'file' || !p.url || !isPrivateBlobUrl(p.url)) return part;
          return { ...p, url: await resolvePresigned(getBlobPathname(p.url)) };
        }),
      );
      return { ...message, parts };
    }),
  );
}
