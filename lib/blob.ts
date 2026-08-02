const PRIVATE_BLOB_HOST_RE = /^[^.]+\.private\.blob\.vercel-storage\.com$/;

export function isPrivateBlobUrl(url: string) {
  try {
    return PRIVATE_BLOB_HOST_RE.test(new URL(url).hostname);
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
