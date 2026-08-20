import { expect, test } from '@playwright/test';

import { extractSophieAttentionCandidates } from '@/lib/ai/interaction/attention';
import { hasPlausibleContinuityCandidate } from '@/lib/ai/relationship/continuity';

test('post-turn extraction keeps semantic intent rather than polished dialogue', async () => {
  const candidates = await extractSophieAttentionCandidates({
    recentContext: 'user: I might apply for the course.\nassistant: What attracts you to it?',
    userText: 'Mostly the career change, but there is more to it.',
    assistantText: 'Yeah. The “more to it” is probably the interesting bit.',
    generate: async () => ({
      candidates: [
        {
          key: 'course_deeper_reason',
          kind: 'pending_question',
          content: 'Understand what the course represents beyond a career change.',
          salience: 0.8,
          confidence: 0.85,
          notBeforeMinutes: 10,
          expiresAfterHours: 168,
        },
      ],
    }),
  });
  expect(candidates).toHaveLength(1);
  expect(candidates[0].content).not.toMatch(/^(wait|hey|actually)[,!]?/i);
});

test('ordinary completed exchange creates no carried attention', async () => {
  const candidates = await extractSophieAttentionCandidates({
    recentContext: '',
    userText: 'What is seven times eight?',
    assistantText: 'Fifty-six.',
    generate: async () => ({ candidates: [] }),
  });
  expect(candidates).toEqual([]);
});

test('Sophie-side attention is a plausible initiative candidate', () => {
  expect(
    hasPlausibleContinuityCandidate({
      sophie_attention: [
        {
          type: 'reentry',
          content: 'Return to the unfinished course decision.',
        },
      ],
    }),
  ).toBe(true);
});
