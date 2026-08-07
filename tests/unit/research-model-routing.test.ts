import { expect, test } from '@playwright/test';

import { PINNED_OPENAI_PROVIDER_ROUTING } from '@/lib/ai/providers';

test('research OpenAI routing excludes Azure and keeps provider failover enabled', () => {
  expect(PINNED_OPENAI_PROVIDER_ROUTING).toEqual({
    only: ['openai'],
    allow_fallbacks: true,
    require_parameters: true,
  });
});
