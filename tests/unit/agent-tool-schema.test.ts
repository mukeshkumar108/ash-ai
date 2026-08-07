import { test, expect } from '@playwright/test';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { buildAshModelTools } from '@/lib/agent/ash-agent';

test('tool schemas convert to AI SDK JSON schema', () => {
  const tools = buildAshModelTools('user-42');

  const names = tools.map((t) => (t as { name?: string }).name ?? '');
  expect(names).toEqual([
    'gmail_list_messages',
    'gmail_read_thread',
    'calendar_list_events',
    'calendar_get_event',
    'web_search',
    'news_search',
    'video_search',
    'image_search',
    'place_search',
    'fetch_web_page',
  ]);

  for (const t of tools) {
    const candidate = t as {
      name?: string;
      description?: string;
      schema?: unknown;
    };
    expect(candidate.name).toBeTruthy();
    expect(candidate.schema).toBeTruthy();
    const schema = candidate.schema as never;
    const converted = zodToJsonSchema(schema, { target: 'jsonSchema7' });
    expect(converted).toBeTruthy();
    expect((converted as { type?: string }).type).toBe('object');
  }
});
