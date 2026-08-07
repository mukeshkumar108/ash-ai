import 'server-only';

import { tool } from '@langchain/core/tools';
import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type {
  ResearchActivity,
  ResearchSource,
  ResearchTrace,
} from '@/lib/types';

const BRAVE_API_BASE = 'https://api.search.brave.com/res/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CALLS = 5;
const DEFAULT_COUNTRY = 'GB';
const DEFAULT_SEARCH_LANGUAGE = 'en';
const MAX_TOOL_OUTPUT_CHARS = 40_000;

export type ResearchSession = {
  braveCallCount: number;
  searchSignatures: Set<string>;
  semanticSearchSignatures: Set<string>;
  discoveredUrls: Set<string>;
};

export function createResearchSession(): ResearchSession {
  return {
    braveCallCount: 0,
    searchSignatures: new Set(),
    semanticSearchSignatures: new Set(),
    discoveredUrls: new Set(),
  };
}

const RESEARCH_TOOL_NAMES = new Set([
  'web_search',
  'news_search',
  'video_search',
  'image_search',
  'place_search',
  'fetch_web_page',
]);

const queryField = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .refine((value) => value.split(/\s+/u).length <= 50, {
    message: 'Search queries must contain at most 50 words',
  });

const commonSearchFields = {
  query: queryField,
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/u)
    .transform((value) => value.toUpperCase())
    .optional(),
  searchLanguage: z.string().trim().min(2).max(12).optional(),
};

class BraveSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BraveSearchError';
  }
}

function getConfig() {
  return {
    apiKey: process.env.BRAVE_API_KEY?.trim() ?? '',
    timeoutMs: positiveInteger(
      process.env.BRAVE_SEARCH_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
    maxCalls: positiveInteger(
      process.env.BRAVE_SEARCH_MAX_CALLS,
      DEFAULT_MAX_CALLS,
    ),
    country:
      process.env.BRAVE_SEARCH_COUNTRY?.trim().toUpperCase() || DEFAULT_COUNTRY,
    searchLanguage:
      process.env.BRAVE_SEARCH_LANGUAGE?.trim() || DEFAULT_SEARCH_LANGUAGE,
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeResearchError(error: unknown): { error: string } {
  if (error instanceof BraveSearchError) {
    return { error: error.message };
  }

  return { error: 'Web research is temporarily unavailable.' };
}

async function braveRequest(
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = getConfig();
  if (!config.apiKey) {
    throw new BraveSearchError('Web research is not configured yet.');
  }

  const response = await fetch(`${BRAVE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/json',
      'X-Subscription-Token': config.apiKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new BraveSearchError('Web research is not configured correctly.');
    }
    if (response.status === 429) {
      throw new BraveSearchError(
        'Web research is temporarily rate-limited. Please try again shortly.',
      );
    }
    throw new BraveSearchError('Web research is temporarily unavailable.');
  }

  const json: unknown = await response.json();
  if (!isRecord(json)) {
    throw new BraveSearchError('Web research returned an invalid response.');
  }
  return json;
}

async function braveGet(
  path: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = getConfig();
  if (!config.apiKey) {
    throw new BraveSearchError('Web research is not configured yet.');
  }

  const searchParams = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(name, String(value));
    }
  }

  const response = await fetch(`${BRAVE_API_BASE}${path}?${searchParams}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': config.apiKey,
    },
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new BraveSearchError('Web research is not configured correctly.');
    }
    if (response.status === 429) {
      throw new BraveSearchError(
        'Web research is temporarily rate-limited. Please try again shortly.',
      );
    }
    throw new BraveSearchError('Web research is temporarily unavailable.');
  }

  const json: unknown = await response.json();
  if (!isRecord(json)) {
    throw new BraveSearchError('Web research returned an invalid response.');
  }
  return json;
}

function requestSignal(runtimeSignal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(getConfig().timeoutMs);
  return runtimeSignal ? AbortSignal.any([runtimeSignal, timeout]) : timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hostnameFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return '';
  }
}

function evidenceFamilyKey(source: ResearchSource): string {
  const decodedUrl = decodeURIComponent(source.url);
  const doi = decodedUrl.match(/10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+/u)?.[0];
  if (doi) return `doi:${doi.toLowerCase()}`;
  const title = source.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (title.length >= 24 && title.split(/\s+/u).length >= 4) {
    return `title:${title}`;
  }
  return `url:${source.url}`;
}

function dedupeEvidenceFamilies(sources: ResearchSource[]): ResearchSource[] {
  const families = new Map<string, ResearchSource>();
  for (const source of sources) {
    const key = evidenceFamilyKey(source);
    const existing = families.get(key);
    if (!existing || source.retrieval === 'page_read') {
      families.set(key, source);
    }
  }
  return [...families.values()];
}

function cleanUrl(value: unknown): string | undefined {
  const candidate = stringValue(value);
  if (!candidate) return undefined;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return undefined;
    }
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function compactStandardResults(payload: Record<string, unknown>) {
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  return rawResults.slice(0, 10).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = cleanUrl(entry.url);
    const title = stringValue(entry.title);
    if (!url || !title) return [];

    const thumbnail = isRecord(entry.thumbnail)
      ? cleanUrl(entry.thumbnail.src ?? entry.thumbnail.original)
      : undefined;
    const properties = isRecord(entry.properties) ? entry.properties : {};

    return [
      {
        title,
        url,
        description:
          stringValue(entry.description) ?? stringValue(entry.snippet) ?? '',
        publishedAt:
          stringValue(entry.page_age) ?? stringValue(entry.age) ?? null,
        source:
          stringValue(entry.meta_url) ??
          stringValue(entry.source) ??
          hostnameFor(url),
        ...(thumbnail ? { thumbnail } : {}),
        ...(stringValue(properties.duration)
          ? { duration: stringValue(properties.duration) }
          : {}),
      },
    ];
  });
}

function compactImageResults(payload: Record<string, unknown>) {
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  return rawResults.slice(0, 10).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const pageUrl = cleanUrl(entry.url);
    const title = stringValue(entry.title);
    const properties = isRecord(entry.properties) ? entry.properties : {};
    const imageUrl = cleanUrl(properties.url ?? entry.image_url);
    const thumbnail = isRecord(entry.thumbnail)
      ? cleanUrl(entry.thumbnail.src)
      : undefined;
    if (!pageUrl || !title) return [];

    return [
      {
        title,
        pageUrl,
        source: hostnameFor(pageUrl),
        ...(imageUrl ? { imageUrl } : {}),
        ...(thumbnail ? { thumbnail } : {}),
      },
    ];
  });
}

function compactWebContext(payload: Record<string, unknown>) {
  const grounding = isRecord(payload.grounding) ? payload.grounding : {};
  const generic = Array.isArray(grounding.generic) ? grounding.generic : [];
  const sourcesObject = isRecord(payload.sources) ? payload.sources : {};

  const results = generic.slice(0, 8).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = cleanUrl(entry.url);
    if (!url) return [];
    const sourceMetadata = isRecord(sourcesObject[url])
      ? sourcesObject[url]
      : {};
    const snippets = Array.isArray(entry.snippets)
      ? entry.snippets
          .filter((value): value is string => typeof value === 'string')
          .slice(0, 6)
          .map((value) => value.slice(0, 4_000))
      : [];

    return [
      {
        title:
          stringValue(entry.title) ??
          stringValue(sourceMetadata.title) ??
          hostnameFor(url),
        url,
        hostname: stringValue(sourceMetadata.hostname) ?? hostnameFor(url),
        snippets,
      },
    ];
  });

  return {
    results,
    local: compactLocalGrounding(grounding),
  };
}

function compactLocalGrounding(grounding: Record<string, unknown>) {
  const local = {
    poi: grounding.poi ?? null,
    map: grounding.map ?? null,
  };
  const serialized = JSON.stringify(local);
  if (serialized.length <= 12_000) return local;
  return {
    note: 'Additional place details were omitted because they were too large.',
  };
}

function boundedResult(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) return value;
  return {
    error:
      'The search returned too much data. Refine the query or request fewer results.',
  };
}

function endpointBody(
  query: string,
  country: string | undefined,
  searchLanguage: string | undefined,
  extra: Record<string, unknown> = {},
) {
  const config = getConfig();
  return {
    q: query,
    country: country ?? config.country,
    search_lang: searchLanguage ?? config.searchLanguage,
    ...extra,
  };
}

function searchSignature(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const normalized = Object.fromEntries(
    Object.entries(args)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        typeof value === 'string'
          ? value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en')
          : value,
      ]),
  );
  return `${toolName}:${JSON.stringify(normalized)}`;
}

const GENERIC_QUERY_TERMS = new Set([
  'actual',
  'case',
  'check',
  'current',
  'evidence',
  'find',
  'latest',
  'loss',
  'loses',
  'lost',
  'lawsuit',
  'recent',
  'recently',
  'really',
  'report',
  'research',
  'ruling',
  'search',
  'study',
  'update',
]);

function semanticSearchSignature(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  const query = typeof args.query === 'string' ? args.query : '';
  const terms = [
    ...new Set(
      query
        .toLocaleLowerCase('en')
        .match(/[\p{L}\p{N}]+/gu)
        ?.filter((term) => term.length > 2 && !GENERIC_QUERY_TERMS.has(term)) ??
        [],
    ),
  ].sort();
  if (terms.length < 2) return null;
  const qualifiers = [
    args.country,
    args.searchLanguage,
    args.freshness,
    args.location,
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLocaleLowerCase('en'));
  return `${toolName}:${terms.join('|')}:${qualifiers.join('|')}`;
}

export function buildBraveResearchTools({
  onDiscoveredUrl,
  session = createResearchSession(),
}: {
  onDiscoveredUrl?: (url: string) => void;
  session?: ResearchSession;
} = {}) {
  const recordResults = <T extends Record<string, unknown>>(output: T): T => {
    for (const result of Array.isArray(output.results) ? output.results : []) {
      if (!isRecord(result)) continue;
      const url = cleanUrl(result.url ?? result.pageUrl);
      if (url) onDiscoveredUrl?.(url);
    }
    return output;
  };

  const run = async <T>(
    signature: string,
    semanticSignature: string | null,
    operation: () => Promise<T>,
  ): Promise<T> => {
    if (session.searchSignatures.has(signature)) {
      throw new BraveSearchError(
        'That exact search was already run in this response. Refine the query or use the sources already found.',
      );
    }
    if (
      semanticSignature &&
      session.semanticSearchSignatures.has(semanticSignature)
    ) {
      throw new BraveSearchError(
        'A substantially equivalent search was already run in this response. Use the evidence already found or search for a genuinely different missing fact.',
      );
    }
    if (session.braveCallCount >= getConfig().maxCalls) {
      throw new BraveSearchError(
        'The research limit for this response has been reached. Use the sources already found or ask the user to narrow the request.',
      );
    }
    session.searchSignatures.add(signature);
    if (semanticSignature) {
      session.semanticSearchSignatures.add(semanticSignature);
    }
    session.braveCallCount += 1;
    return operation();
  };

  return [
    tool(
      async (
        {
          query,
          country,
          searchLanguage,
          freshness,
        }: {
          query: string;
          country?: string;
          searchLanguage?: string;
          freshness?: string;
        },
        runtime,
      ) => {
        try {
          return await run(
            searchSignature('web_search', {
              query,
              country,
              searchLanguage,
              freshness,
            }),
            semanticSearchSignature('web_search', {
              query,
              country,
              searchLanguage,
              freshness,
            }),
            async () => {
              const payload = await braveRequest(
                '/llm/context',
                endpointBody(query, country, searchLanguage, {
                  count: 12,
                  maximum_number_of_urls: 8,
                  maximum_number_of_tokens: 6_000,
                  maximum_number_of_snippets: 30,
                  maximum_number_of_tokens_per_url: 1_500,
                  context_threshold_mode: 'balanced',
                  ...(freshness ? { freshness } : {}),
                }),
                requestSignal(runtime?.signal),
              );
              return recordResults(
                boundedResult({
                  query,
                  searchedAt: new Date().toISOString(),
                  ...compactWebContext(payload),
                }),
              );
            },
          );
        } catch (error) {
          return safeResearchError(error);
        }
      },
      {
        name: 'web_search',
        description:
          'Search and read relevant public web-page excerpts using Brave LLM Context. Use for current facts, websites, official documentation, comparisons, fact-checking, or when you need page content rather than just links. It can also retrieve relevant structured data and public video captions. Search again with a refined query when evidence is missing or conflicting.',
        schema: z
          .object({
            ...commonSearchFields,
            freshness: z
              .enum(['pd', 'pw', 'pm', 'py'])
              .describe('Optional freshness: past day, week, month, or year')
              .optional(),
          })
          .strict(),
      },
    ),
    tool(
      async (
        args: {
          query: string;
          country?: string;
          searchLanguage?: string;
          freshness?: string;
        },
        runtime,
      ) => {
        try {
          return await run(
            searchSignature('news_search', args),
            semanticSearchSignature('news_search', args),
            async () => {
              const payload = await braveRequest(
                '/news/search',
                endpointBody(args.query, args.country, args.searchLanguage, {
                  count: 10,
                  safesearch: 'moderate',
                  ...(args.freshness ? { freshness: args.freshness } : {}),
                }),
                requestSignal(runtime?.signal),
              );
              const results = compactStandardResults(payload);
              return recordResults({
                query: args.query,
                resultCount: results.length,
                results,
              });
            },
          );
        } catch (error) {
          return safeResearchError(error);
        }
      },
      {
        name: 'news_search',
        description:
          'Search current news articles. Use when recency, reporting date, or coverage from news publications matters. Return to web_search for deeper page excerpts or primary-source verification.',
        schema: z
          .object({
            ...commonSearchFields,
            freshness: z.enum(['pd', 'pw', 'pm', 'py']).optional(),
          })
          .strict(),
      },
    ),
    tool(
      async (
        args: {
          query: string;
          country?: string;
          searchLanguage?: string;
        },
        runtime,
      ) => {
        try {
          return await run(
            searchSignature('video_search', args),
            semanticSearchSignature('video_search', args),
            async () => {
              const payload = await braveRequest(
                '/videos/search',
                endpointBody(args.query, args.country, args.searchLanguage, {
                  count: 10,
                  safesearch: 'moderate',
                }),
                requestSignal(runtime?.signal),
              );
              const results = compactStandardResults(payload);
              return recordResults({
                query: args.query,
                resultCount: results.length,
                results,
              });
            },
          );
        } catch (error) {
          return safeResearchError(error);
        }
      },
      {
        name: 'video_search',
        description:
          'Find public videos, including YouTube videos, with titles, links, descriptions, sources, and available metadata. Use web_search afterward when you need relevant public captions or page content to assess a video.',
        schema: z.object(commonSearchFields).strict(),
      },
    ),
    tool(
      async (
        args: {
          query: string;
          country?: string;
          searchLanguage?: string;
        },
        runtime,
      ) => {
        try {
          return await run(
            searchSignature('image_search', args),
            semanticSearchSignature('image_search', args),
            async () => {
              const payload = await braveGet(
                '/images/search',
                endpointBody(args.query, args.country, args.searchLanguage, {
                  count: 10,
                  safesearch: 'strict',
                }),
                requestSignal(runtime?.signal),
              );
              const results = compactImageResults(payload);
              return recordResults({
                query: args.query,
                resultCount: results.length,
                results,
              });
            },
          );
        } catch (error) {
          return safeResearchError(error);
        }
      },
      {
        name: 'image_search',
        description:
          'Find public images and their source pages. Use for visual references or when the user explicitly asks to find images. Never imply that an image is licensed for reuse; direct the user to verify rights on the source page.',
        schema: z.object(commonSearchFields).strict(),
      },
    ),
    tool(
      async (
        {
          query,
          location,
          country,
          searchLanguage,
        }: {
          query: string;
          location: string;
          country?: string;
          searchLanguage?: string;
        },
        runtime,
      ) => {
        try {
          return await run(
            searchSignature('place_search', {
              query,
              location,
              country,
              searchLanguage,
            }),
            semanticSearchSignature('place_search', {
              query,
              location,
              country,
              searchLanguage,
            }),
            async () => {
              const combinedQuery = `${query} in ${location}`;
              const payload = await braveRequest(
                '/llm/context',
                endpointBody(combinedQuery, country, searchLanguage, {
                  count: 12,
                  maximum_number_of_urls: 8,
                  maximum_number_of_tokens: 5_000,
                  maximum_number_of_snippets: 24,
                  maximum_number_of_tokens_per_url: 1_200,
                  context_threshold_mode: 'balanced',
                  enable_local: true,
                }),
                requestSignal(runtime?.signal),
              );
              return recordResults(
                boundedResult({
                  query,
                  location,
                  searchedAt: new Date().toISOString(),
                  ...compactWebContext(payload),
                }),
              );
            },
          );
        } catch (error) {
          return safeResearchError(error);
        }
      },
      {
        name: 'place_search',
        description:
          'Search for public places, businesses, attractions, services, or local recommendations in an explicit location. The user must provide or confirm the location; never infer it from private email or calendar data. Verify time-sensitive opening information against a source before presenting it as certain.',
        schema: z
          .object({
            ...commonSearchFields,
            location: z.string().trim().min(2).max(160),
          })
          .strict(),
      },
    ),
  ];
}

function researchKind(name: string): ResearchActivity['kind'] | undefined {
  if (name === 'web_search') return 'web';
  if (name === 'news_search') return 'news';
  if (name === 'video_search') return 'video';
  if (name === 'image_search') return 'image';
  if (name === 'place_search') return 'place';
  if (name === 'fetch_web_page') return 'page';
  return undefined;
}

function parseToolContent(content: unknown): Record<string, unknown> | null {
  if (isRecord(content)) return content;
  if (typeof content !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeFailedTarget(kind: ResearchActivity['kind'], query: string) {
  if (kind !== 'page') return query.slice(0, 400);
  try {
    const url = new URL(query);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return 'public page';
  }
}

function safeFailure(value: unknown): ResearchActivity['failure'] {
  const error = stringValue(value)?.toLowerCase() ?? '';
  if (error.includes('timeout') || error.includes('too long')) return 'timeout';
  if (
    error.includes('private') ||
    error.includes('internal') ||
    error.includes('allowed') ||
    error.includes('discovered')
  ) {
    return 'blocked';
  }
  return 'unavailable';
}

export function extractResearchTrace(messages: BaseMessage[]): ResearchTrace {
  const calls = new Map<
    string,
    { name: string; query: string; kind: ResearchActivity['kind'] }
  >();
  const activities: ResearchActivity[] = [];
  const sources = new Map<string, ResearchSource>();

  for (const message of messages) {
    if (message.getType() === 'ai') {
      for (const call of (
        message as {
          tool_calls?: Array<{
            id?: string;
            name: string;
            args?: Record<string, unknown>;
          }>;
        }
      ).tool_calls ?? []) {
        if (!call.id || !RESEARCH_TOOL_NAMES.has(call.name)) continue;
        const kind = researchKind(call.name);
        const query = stringValue(call.args?.query ?? call.args?.url);
        if (kind && query) calls.set(call.id, { name: call.name, kind, query });
      }
      continue;
    }

    if (message.getType() !== 'tool') continue;
    const toolMessage = message as BaseMessage & {
      tool_call_id?: string;
      name?: string;
    };
    const call = toolMessage.tool_call_id
      ? calls.get(toolMessage.tool_call_id)
      : undefined;
    const kind = call?.kind ?? researchKind(toolMessage.name ?? '');
    const output = parseToolContent(message.content);
    const query = call?.query ?? stringValue(output?.query);
    if (!kind || !query) continue;
    if (stringValue(output?.error)) {
      activities.push({
        kind,
        query: safeFailedTarget(kind, query),
        status: 'failed',
        failure: safeFailure(output?.error),
      });
      continue;
    }

    const resultCount =
      kind === 'page'
        ? 1
        : Array.isArray(output?.results)
          ? output.results.length
          : undefined;
    activities.push({
      kind,
      query,
      ...(resultCount !== undefined ? { resultCount } : {}),
      ...(kind === 'page' &&
      (output?.sourceRole === 'official' ||
        output?.sourceRole === 'full_text_mirror' ||
        output?.sourceRole === 'secondary' ||
        output?.sourceRole === 'unverified')
        ? { sourceRole: output.sourceRole }
        : {}),
    });

    for (const result of Array.isArray(output?.results) ? output.results : []) {
      if (!isRecord(result)) continue;
      const url = cleanUrl(result.url ?? result.pageUrl);
      if (!url) continue;
      sources.set(url, {
        url,
        title: stringValue(result.title) ?? hostnameFor(url),
        hostname: stringValue(result.hostname) ?? hostnameFor(url),
        retrieval: 'search_context',
      });
    }

    if (kind === 'page') {
      const url = cleanUrl(output?.finalUrl ?? output?.url);
      if (url) {
        const sourceRole =
          output?.sourceRole === 'official' ||
          output?.sourceRole === 'full_text_mirror' ||
          output?.sourceRole === 'secondary' ||
          output?.sourceRole === 'unverified'
            ? output.sourceRole
            : undefined;
        sources.set(url, {
          url,
          title: stringValue(output?.title) ?? hostnameFor(url),
          hostname: hostnameFor(url),
          retrieval: 'page_read',
          ...(sourceRole ? { sourceRole } : {}),
        });
      }
    }
  }

  return {
    activities: activities.slice(0, 10),
    sources: dedupeEvidenceFamilies([...sources.values()]).slice(0, 40),
  };
}

export function mergeResearchTraces(
  first: ResearchTrace,
  second: ResearchTrace,
): ResearchTrace {
  const activities = new Map(
    [...first.activities, ...second.activities].map((activity) => [
      JSON.stringify([
        activity.kind,
        activity.query,
        activity.status,
        activity.resultCount,
        activity.sourceRole,
        activity.failure,
      ]),
      activity,
    ]),
  );
  const sources = new Map(
    [...first.sources, ...second.sources].map((source) => [source.url, source]),
  );
  return {
    activities: [...activities.values()].slice(0, 16),
    sources: dedupeEvidenceFamilies([...sources.values()]).slice(0, 40),
  };
}
