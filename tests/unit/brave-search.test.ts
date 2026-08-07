import { expect, test } from '@playwright/test';
import { AIMessage, ToolMessage } from '@langchain/core/messages';

import {
  buildBraveResearchTools,
  createResearchSession,
  extractResearchTrace,
} from '@/lib/agent/brave-search';
import { buildAshAgentSystemPrompt } from '@/lib/agent/system-prompt';
import { summarizeResearchTrace } from '@/lib/research-trace';

const originalFetch = globalThis.fetch;

function toolByName(name: string) {
  const candidate = buildBraveResearchTools().find(
    (entry) => (entry as { name?: string }).name === name,
  );
  if (!candidate) throw new Error(`missing tool ${name}`);
  return candidate as unknown as {
    invoke(input: Record<string, unknown>): Promise<unknown>;
  };
}

function toolFromSet(
  tools: ReturnType<typeof buildBraveResearchTools>,
  name: string,
) {
  const candidate = tools.find(
    (entry) => (entry as { name?: string }).name === name,
  );
  if (!candidate) throw new Error(`missing tool ${name}`);
  return candidate as unknown as {
    invoke(input: Record<string, unknown>): Promise<unknown>;
  };
}

test.beforeEach(() => {
  process.env.BRAVE_API_KEY = 'brave-test-key';
  process.env.BRAVE_SEARCH_COUNTRY = 'GB';
  process.env.BRAVE_SEARCH_LANGUAGE = 'en';
  process.env.BRAVE_SEARCH_MAX_CALLS = '5';
});

test.afterEach(() => {
  process.env.BRAVE_API_KEY = '';
  process.env.BRAVE_SEARCH_COUNTRY = '';
  process.env.BRAVE_SEARCH_LANGUAGE = '';
  process.env.BRAVE_SEARCH_MAX_CALLS = '';
  globalThis.fetch = originalFetch;
});

test('web_search uses Brave LLM Context and returns bounded extracted sources', async () => {
  let request: { url: string; init: RequestInit } | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    request = { url: String(input), init: init ?? {} };
    return new Response(
      JSON.stringify({
        grounding: {
          generic: [
            {
              title: 'Official result',
              url: 'https://example.com/article#section',
              snippets: ['Relevant extracted page content.'],
            },
          ],
          map: [],
        },
        sources: {
          'https://example.com/article#section': {
            title: 'Official result',
            hostname: 'example.com',
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const result = (await toolByName('web_search').invoke({
    query: 'official example update',
    freshness: 'pw',
  })) as {
    results: Array<{ url: string; snippets: string[] }>;
  };

  expect(request?.url).toBe('https://api.search.brave.com/res/v1/llm/context');
  expect(
    (request?.init.headers as Record<string, string>)?.['X-Subscription-Token'],
  ).toBe('brave-test-key');
  expect(request?.init.cache).toBe('no-store');
  expect(JSON.parse(String(request?.init.body))).toMatchObject({
    q: 'official example update',
    country: 'GB',
    search_lang: 'en',
    freshness: 'pw',
    maximum_number_of_urls: 8,
  });
  expect(result.results).toEqual([
    {
      title: 'Official result',
      url: 'https://example.com/article',
      hostname: 'example.com',
      snippets: ['Relevant extracted page content.'],
    },
  ]);
});

test('specialised tools use their matching Brave endpoints', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;

  await toolByName('news_search').invoke({ query: 'AI regulation' });
  await toolByName('video_search').invoke({ query: 'attention tutorial' });
  await toolByName('image_search').invoke({ query: 'Bristol skyline' });

  expect(urls[0]).toBe('https://api.search.brave.com/res/v1/news/search');
  expect(urls[1]).toBe('https://api.search.brave.com/res/v1/videos/search');
  expect(urls[2]).toContain(
    'https://api.search.brave.com/res/v1/images/search?',
  );
});

test('an exact duplicate search is rejected without another Brave request', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
  const tools = buildBraveResearchTools();
  const videoSearch = toolFromSet(tools, 'video_search');

  await videoSearch.invoke({ query: '  DeepAgents   LangGraph ' });
  const duplicate = await videoSearch.invoke({ query: 'deepagents langgraph' });

  expect(requests).toBe(1);
  expect(duplicate).toEqual({
    error:
      'That exact search was already run in this response. Refine the query or use the sources already found.',
  });
});

test('obvious semantic rewrites do not spend another request', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
  const tools = buildBraveResearchTools();
  const newsSearch = toolFromSet(tools, 'news_search');

  await newsSearch.invoke({ query: 'OpenAI copyright lawsuit ruling' });
  const rewrite = await newsSearch.invoke({
    query: 'OpenAI loses copyright case recently',
  });

  expect(requests).toBe(1);
  expect(rewrite).toEqual({
    error:
      'A substantially equivalent search was already run in this response. Use the evidence already found or search for a genuinely different missing fact.',
  });
});

test('Brave call budget and duplicate history are shared across retry tool sets', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;
  process.env.BRAVE_SEARCH_MAX_CALLS = '2';
  const session = createResearchSession();
  const first = toolFromSet(
    buildBraveResearchTools({ session }),
    'news_search',
  );
  const retry = toolFromSet(
    buildBraveResearchTools({ session }),
    'news_search',
  );

  await first.invoke({ query: 'first evidence gap' });
  await retry.invoke({ query: 'second evidence gap' });
  const overBudget = await retry.invoke({ query: 'third evidence gap' });
  const duplicate = await retry.invoke({ query: 'first evidence gap' });

  expect(requests).toBe(2);
  expect(overBudget).toEqual({
    error:
      'The research limit for this response has been reached. Use the sources already found or ask the user to narrow the request.',
  });
  expect(duplicate).toEqual({
    error:
      'That exact search was already run in this response. Refine the query or use the sources already found.',
  });
});

test('errors are safe and never expose the API key or upstream body', async () => {
  globalThis.fetch = (async () =>
    new Response('secret upstream diagnostic', {
      status: 500,
    })) as typeof fetch;

  const result = await toolByName('web_search').invoke({ query: 'test' });
  expect(result).toEqual({ error: 'Web research is temporarily unavailable.' });
  expect(JSON.stringify(result)).not.toContain('brave-test-key');
  expect(JSON.stringify(result)).not.toContain('upstream diagnostic');
});

test('research trace exposes actions and sources but not hidden reasoning', () => {
  const trace = extractResearchTrace([
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'search-1',
          name: 'web_search',
          args: { query: 'trusted current date' },
        },
      ],
    }),
    new ToolMessage({
      tool_call_id: 'search-1',
      name: 'web_search',
      content: JSON.stringify({
        query: 'trusted current date',
        results: [
          {
            title: 'A source',
            url: 'https://example.com/source',
            hostname: 'example.com',
            snippets: ['Private model reasoning should not be copied.'],
          },
        ],
      }),
    }),
  ]);

  expect(trace).toEqual({
    activities: [
      { kind: 'web', query: 'trusted current date', resultCount: 1 },
    ],
    sources: [
      {
        title: 'A source',
        url: 'https://example.com/source',
        hostname: 'example.com',
        retrieval: 'search_context',
      },
    ],
  });
  expect(JSON.stringify(trace)).not.toContain('Private model reasoning');
});

test('the trace counts mirrored URLs for one titled work as one evidence family', () => {
  const trace = extractResearchTrace([
    new AIMessage({
      content: '',
      tool_calls: [
        { id: 'search-family', name: 'web_search', args: { query: 'paper' } },
      ],
    }),
    new ToolMessage({
      tool_call_id: 'search-family',
      name: 'web_search',
      content: JSON.stringify({
        query: 'paper',
        results: [
          {
            title: 'The political effects of an algorithmic social media feed',
            url: 'https://publisher.example/paper',
          },
          {
            title: 'The political effects of an algorithmic social media feed',
            url: 'https://mirror.example/paper',
          },
        ],
      }),
    }),
  ]);

  expect(trace.sources).toHaveLength(1);
});

test('failed research calls do not satisfy the successful research trace', () => {
  const trace = extractResearchTrace([
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'search-failed',
          name: 'news_search',
          args: { query: 'current disputed claim' },
        },
      ],
    }),
    new ToolMessage({
      tool_call_id: 'search-failed',
      name: 'news_search',
      content: JSON.stringify({
        error: 'Web research is temporarily unavailable.',
      }),
    }),
  ]);

  expect(trace).toEqual({
    activities: [
      {
        kind: 'news',
        query: 'current disputed claim',
        status: 'failed',
        failure: 'unavailable',
      },
    ],
    sources: [],
  });
});

test('successful page reads appear as evidence while failed reads do not', () => {
  const successful = extractResearchTrace([
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'fetch-1',
          name: 'fetch_web_page',
          args: { url: 'https://example.com/official-order' },
        },
      ],
    }),
    new ToolMessage({
      tool_call_id: 'fetch-1',
      name: 'fetch_web_page',
      content: JSON.stringify({
        url: 'https://example.com/official-order',
        finalUrl: 'https://example.com/official-order',
        title: 'Official order',
        content: '# Order\n\nGrounded text',
        truncated: false,
      }),
    }),
  ]);

  expect(successful).toEqual({
    activities: [
      {
        kind: 'page',
        query: 'https://example.com/official-order',
        resultCount: 1,
      },
    ],
    sources: [
      {
        title: 'Official order',
        url: 'https://example.com/official-order',
        hostname: 'example.com',
        retrieval: 'page_read',
      },
    ],
  });

  const failed = extractResearchTrace([
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'fetch-2',
          name: 'fetch_web_page',
          args: { url: 'https://example.com/private' },
        },
      ],
    }),
    new ToolMessage({
      tool_call_id: 'fetch-2',
      name: 'fetch_web_page',
      content: JSON.stringify({ error: 'That page could not be read.' }),
    }),
  ]);
  expect(failed).toEqual({
    activities: [
      {
        kind: 'page',
        query: 'https://example.com',
        status: 'failed',
        failure: 'unavailable',
      },
    ],
    sources: [],
  });
});

test('system prompt injects the trusted date, timezone, and privacy boundary', () => {
  const prompt = buildAshAgentSystemPrompt({
    now: new Date('2026-08-06T13:30:00.000Z'),
    timeZone: 'Europe/London',
  });

  expect(prompt).toContain('Thursday, 6 August 2026');
  expect(prompt).toContain('Europe/London');
  expect(prompt).toContain("Never infer today's date from model memory");
  expect(prompt).toContain('23:xx is before midnight');
  expect(prompt).toContain('00:xx is after midnight');
  expect(prompt).toContain(
    'state titles, channels or publishers, dates, durations',
  );
  expect(prompt).toContain('Never place private Gmail content');
  expect(prompt).toContain(
    'Do not reveal hidden reasoning or chain-of-thought',
  );
  expect(prompt).toContain('Evidence comes before editorial judgment');
  expect(prompt).toContain('does not replace your personality');
  expect(prompt).toContain('Brave is the discovery layer');
  expect(prompt).toContain('fetch it before making strong factual claims');
});

test('turn-specific policy requires tool use and strengthens the retry', () => {
  const firstAttempt = buildAshAgentSystemPrompt({
    researchRequirement: {
      reason: 'current_controversy',
      retry: false,
    },
  });
  const retry = buildAshAgentSystemPrompt({
    researchRequirement: {
      reason: 'current_controversy',
      retry: true,
    },
  });

  expect(firstAttempt).toContain('Follow this evidence standard');
  expect(retry).toContain('A previous attempt did not satisfy');
});

test('research prompt uses a conclusion-neutral question', () => {
  const prompt = buildAshAgentSystemPrompt({
    researchRequirement: {
      reason: 'The user requested research.',
      retry: false,
      researchDepth: 'light',
      freshnessNeed: 'preferred',
      authorityNeed: 'preferred',
      sourceSensitivity: 'high',
      neutralResearchQuestion:
        'What effects does social media have on political polarisation, under which conditions, and how strong is the causal evidence?',
    },
  });

  expect(prompt).toContain(
    'Conclusion-neutral issue: What effects does social media have',
  );
  expect(prompt).toContain('competing explanations');
  expect(prompt).toContain('not wording designed to confirm or refute');
});

test('research summary distinguishes calls from results reviewed', () => {
  expect(
    summarizeResearchTrace({
      activities: [
        {
          kind: 'video',
          query: 'DeepAgents LangGraph YouTube',
          resultCount: 10,
        },
      ],
      sources: Array.from({ length: 10 }, (_, index) => ({
        title: `Video ${index + 1}`,
        url: `https://example.com/video-${index + 1}`,
        hostname: 'example.com',
      })),
    }),
  ).toBe('1 video search · 10 results returned');

  expect(
    summarizeResearchTrace({
      activities: [
        { kind: 'web', query: 'first', resultCount: 4 },
        { kind: 'news', query: 'second', resultCount: 3 },
      ],
      sources: [],
    }),
  ).toBe('2 searches · 7 results returned');

  expect(
    summarizeResearchTrace({
      activities: [
        { kind: 'web', query: 'official order', resultCount: 8 },
        {
          kind: 'page',
          query: 'https://example.com/order',
          resultCount: 1,
        },
      ],
      sources: [],
    }),
  ).toBe('1 web search · 1 page read · 8 results returned');

  expect(
    summarizeResearchTrace({
      activities: [
        {
          kind: 'page',
          query: 'https://courtlistener.com',
          status: 'failed',
          failure: 'unavailable',
        },
      ],
      sources: [],
    }),
  ).toBe('1 retrieval failed');
});
