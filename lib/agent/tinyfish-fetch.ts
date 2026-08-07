import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const TINYFISH_FETCH_URL = 'https://api.fetch.tinyfish.ai';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONTENT_CHARS = 32_000;
const MAX_URL_CHARS = 2_048;

type Address = { address: string; family: number };
export type HostnameResolver = (hostname: string) => Promise<Address[]>;

class TinyFishFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TinyFishFetchError';
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeIpv4(address: string): number[] | null {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPublicIpv4(address: string): boolean {
  const parts = normalizeIpv4(address);
  if (!parts) return false;
  const [a, b, c] = parts;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('::') && !normalized.startsWith('::ffff:')) {
    return false;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
  if (/^fe[89ab]/u.test(normalized)) return false;
  if (normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) {
    return false;
  }

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u);
  if (mapped) return isPublicIpv4(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPublicIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function defaultResolver(hostname: string): Promise<Address[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
]);

const SENSITIVE_QUERY_NAMES =
  /^(?:access_token|api[_-]?key|auth|authorization|code|credential|jwt|password|secret|signature|state|token)$/iu;

export async function validatePublicWebUrl(
  input: string,
  resolveHostname: HostnameResolver = defaultResolver,
): Promise<URL> {
  if (input.length > MAX_URL_CHARS) {
    throw new TinyFishFetchError('That page URL is too long to fetch safely.');
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TinyFishFetchError('That is not a valid public page URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TinyFishFetchError(
      'Only public HTTP or HTTPS pages can be read.',
    );
  }
  if (url.username || url.password) {
    throw new TinyFishFetchError(
      'Page URLs containing credentials are not allowed.',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  const addressHostname = hostname.replace(/^\[|\]$/gu, '');
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new TinyFishFetchError(
      'Private or internal page URLs are not allowed.',
    );
  }

  for (const name of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_NAMES.test(name)) {
      throw new TinyFishFetchError(
        'Page URLs containing authentication or callback secrets are not allowed.',
      );
    }
  }

  if (isIP(addressHostname)) {
    if (!isPublicIpAddress(addressHostname)) {
      throw new TinyFishFetchError(
        'Private or internal page URLs are not allowed.',
      );
    }
  } else {
    let addresses: Address[];
    try {
      addresses = await resolveHostname(hostname);
    } catch {
      throw new TinyFishFetchError(
        'That public page hostname could not be resolved.',
      );
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicIpAddress(address))
    ) {
      throw new TinyFishFetchError(
        'Private or internal page URLs are not allowed.',
      );
    }
  }

  url.hash = '';
  return url;
}

function safeFetchError(error: unknown): { error: string } {
  if (error instanceof TinyFishFetchError) return { error: error.message };
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { error: 'Reading that page was cancelled.' };
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { error: 'That page took too long to read.' };
  }
  return { error: 'That public page could not be read right now.' };
}

function boundedSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException('The page fetch timed out.', 'TimeoutError'),
      ),
    timeoutMs,
  );

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

export function buildTinyFishFetchTool({
  resolveHostname = defaultResolver,
  isUrlAllowed = () => false,
}: {
  resolveHostname?: HostnameResolver;
  isUrlAllowed?: (url: URL) => boolean;
} = {}) {
  return tool(
    async ({ url: inputUrl }: { url: string }, runtime) => {
      let cleanupSignal = () => {};
      try {
        const apiKey = process.env.TINYFISH_API_KEY?.trim();
        if (!apiKey) {
          throw new TinyFishFetchError('Page reading is not configured yet.');
        }

        const url = await validatePublicWebUrl(inputUrl, resolveHostname);
        if (!isUrlAllowed(url)) {
          throw new TinyFishFetchError(
            'That page must first be discovered through public web research.',
          );
        }
        const requestSignal = boundedSignal(
          runtime?.signal,
          positiveInteger(
            process.env.TINYFISH_FETCH_TIMEOUT_MS,
            DEFAULT_TIMEOUT_MS,
          ),
        );
        cleanupSignal = requestSignal.cleanup;
        const { signal } = requestSignal;
        signal.throwIfAborted();

        const response = await fetch(TINYFISH_FETCH_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({
            urls: [url.toString()],
            format: 'markdown',
            links: false,
            image_links: false,
          }),
          cache: 'no-store',
          signal,
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new TinyFishFetchError(
              'Page reading is not configured correctly.',
            );
          }
          if (response.status === 429) {
            throw new TinyFishFetchError(
              'Page reading is temporarily rate-limited. Please try again shortly.',
            );
          }
          throw new TinyFishFetchError(
            'That public page could not be read right now.',
          );
        }

        const payload: unknown = await response.json();
        if (!isRecord(payload)) {
          throw new TinyFishFetchError(
            'Page reading returned an invalid response.',
          );
        }
        const firstError = Array.isArray(payload.errors)
          ? payload.errors.find(isRecord)
          : undefined;
        const result = Array.isArray(payload.results)
          ? payload.results.find(isRecord)
          : undefined;
        if (!result) {
          const errorCode = stringValue(firstError?.error);
          throw new TinyFishFetchError(
            errorCode === 'timeout'
              ? 'That page took too long to read.'
              : 'That public page could not be read right now.',
          );
        }

        const finalUrl = await validatePublicWebUrl(
          stringValue(result.final_url) ?? url.toString(),
          resolveHostname,
        );
        const content = stringValue(result.text);
        if (!content) {
          throw new TinyFishFetchError(
            'That page did not contain readable text.',
          );
        }
        const maxChars = positiveInteger(
          process.env.TINYFISH_FETCH_MAX_CONTENT_CHARS,
          DEFAULT_MAX_CONTENT_CHARS,
        );
        const truncated = content.length > maxChars;
        const sourceRole = verifiedSourceRole(
          finalUrl,
          stringValue(result.title) ?? '',
          content,
        );

        return {
          url: url.toString(),
          finalUrl: finalUrl.toString(),
          title: stringValue(result.title) ?? finalUrl.hostname,
          content: truncated ? content.slice(0, maxChars) : content,
          truncated,
          sourceRole,
        };
      } catch (error) {
        return safeFetchError(error);
      } finally {
        cleanupSignal();
      }
    },
    {
      name: 'fetch_web_page',
      description:
        'Read one specific public HTTP/HTTPS page already discovered during research and return clean Markdown. Use after Brave identifies a useful source, especially an official or primary legal, regulatory, scientific, or technical source. This is read-only page retrieval, not search or browser automation. Never construct a URL from private Gmail, Calendar, document, authentication, or personal content.',
      schema: z
        .object({
          url: z.string().trim().min(1).max(MAX_URL_CHARS),
        })
        .strict(),
    },
  );
}

export function verifiedSourceRole(
  url: URL,
  title: string,
  content: string,
): 'official' | 'full_text_mirror' | 'secondary' | 'unverified' {
  const hostname = url.hostname.toLowerCase().replace(/^www\./u, '');
  const path = url.pathname.toLowerCase();
  const text = `${title}\n${content.slice(0, 8_000)}`.toLowerCase();
  const substantial = content.trim().length >= 800;

  if (
    substantial &&
    ((hostname === 'arxiv.org' && /^\/(?:abs|pdf)\//u.test(path)) ||
      (hostname === 'pmc.ncbi.nlm.nih.gov' && path.includes('/articles/')) ||
      (hostname.endsWith('nature.com') && /\/articles\/s\d+/u.test(path)) ||
      (hostname.endsWith('science.org') && path.includes('/doi/')) ||
      (hostname.endsWith('pnas.org') && path.includes('/doi/')) ||
      (hostname.endsWith('plos.org') && path.includes('/article')))
  ) {
    return 'official';
  }

  if (
    substantial &&
    ((hostname === 'eur-lex.europa.eu' && path.includes('/legal-content/')) ||
      (hostname === 'curia.europa.eu' && path.includes('/juris/')) ||
      ((hostname === 'justiz.bayern.de' ||
        hostname.endsWith('.justiz.de') ||
        hostname === 'bundesgerichtshof.de' ||
        hostname === 'bundesverfassungsgericht.de') &&
        /(?:urteil|beschluss|entscheidung|judgment|decision|ruling)/u.test(
          `${path} ${text}`,
        )) ||
      (hostname.endsWith('judiciary.uk') &&
        /(?:judgment|decision|ruling|press-summary)/u.test(
          `${path} ${text}`,
        )) ||
      ((hostname.endsWith('.gov') || hostname.endsWith('.gov.uk')) &&
        /(?:opinion|judgment|decision|order|ruling|statute|regulation|report|filing)/u.test(
          `${path} ${title.toLowerCase()}`,
        )))
  ) {
    return 'official';
  }

  if (
    substantial &&
    ((hostname === 'courtlistener.com' && path.includes('/opinion/')) ||
      (hostname === 'law.justia.com' && path.includes('/cases/'))) &&
    /(?:opinion|judgment|order|court)/u.test(text)
  ) {
    return 'full_text_mirror';
  }

  if (
    /(?:analysis|explainer|commentary|news|blog|case note|client alert)/u.test(
      `${path} ${title.toLowerCase()}`,
    )
  ) {
    return 'secondary';
  }

  return 'unverified';
}
