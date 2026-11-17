// Client-safe: recognises private stored URLs (Vercel Blob host or s3://bucket/key).
export function isPrivateBlobUrl(url: string) {
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

export function getBlobPathname(url: string) {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return url;
  }
}

export function getBlobDisplayUrl(url: string) {
  if (!isPrivateBlobUrl(url)) return url;
  const pathname = getBlobPathname(url);
  return `/api/files?pathname=${encodeURIComponent(pathname)}`;
}
