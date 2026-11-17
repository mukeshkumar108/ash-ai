import 'server-only';

import { presignGetUrl } from './storage';

import { isPrivateBlobUrl, getBlobPathname } from './blob';

const BLOB_SIGN_URL_MS = 30 * 60 * 1000;

const presignBlobUrl = (pathname: string) =>
  presignGetUrl(pathname, BLOB_SIGN_URL_MS);

export async function presignFilePartUrls<T extends { parts: unknown[] }>(
  messages: T[],
): Promise<T[]> {
  const cache = new Map<string, Promise<string>>();

  const resolvePresigned = (pathname: string) => {
    const existing = cache.get(pathname);
    if (existing) return existing;
    const promise = presignBlobUrl(pathname);
    cache.set(pathname, promise);
    return promise;
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
