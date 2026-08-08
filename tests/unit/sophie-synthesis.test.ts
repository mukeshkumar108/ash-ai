import { expect, test } from '@playwright/test';

import {
  buildResearchHandoff,
  buildSophieSynthesisSystemPrompt,
} from '@/lib/agent/sophie-synthesis';
import type { EpistemicPolicy } from '@/lib/agent/research-policy';

const policy: EpistemicPolicy = {
  researchDepth: 'deep',
  freshnessNeed: 'preferred',
  authorityNeed: 'preferred',
  sourceSensitivity: 'high',
  stakes: 'medium',
  questionMode: 'investigation',
  reason: 'Fresh evidence may sharpen an opinion.',
  confidence: 0.9,
  classifierRan: true,
  classifierSucceeded: true,
  userDeclinedResearch: false,
};

test('final synthesis separates independent judgment from research notes', () => {
  const prompt = buildSophieSynthesisSystemPrompt(policy);

  expect(prompt).toContain('Form an independent view');
  expect(prompt).toContain('does not choose your conclusion');
  expect(prompt).toContain('If retrieval was partial');
  expect(prompt).toContain(
    'Never turn an empty or failed retrieval into an absence claim',
  );
  expect(prompt).toContain(
    'Opinions and interpretations do not need citations',
  );
});

test('partial retrieval handoff preserves evidence and exposes failures', () => {
  const handoff = buildResearchHandoff({
    researchDraft: 'A cautious working answer [Source](https://example.com/a).',
    trace: {
      activities: [
        { kind: 'web', query: 'topic', status: 'success', resultCount: 2 },
        {
          kind: 'page',
          query: 'https://blocked.example',
          status: 'failed',
          failure: 'timeout',
        },
      ],
      sources: [
        {
          title: 'Source',
          url: 'https://example.com/a',
          hostname: 'example.com',
          retrieval: 'search_context',
          sourceRole: 'secondary',
        },
      ],
    },
    evidence: {
      successfulSearches: 1,
      failedSearches: 0,
      successfulPageReads: 0,
      failedPageReads: 1,
      usableSources: 1,
      authorityRead: false,
      onlySecondaryEvidence: true,
    },
    missing: ['authority_read'],
    truncated: false,
  });

  expect(handoff).toContain('usable sources: 1');
  expect(handoff).toContain('Missing evidence: authority_read');
  expect(handoff).toContain('page:timeout');
  expect(handoff).toContain('https://example.com/a');
});

test('failed retrieval is not represented as successful evidence', () => {
  const handoff = buildResearchHandoff({
    researchDraft: '',
    trace: {
      activities: [
        {
          kind: 'web',
          query: 'current fact',
          status: 'failed',
          failure: 'unavailable',
        },
      ],
      sources: [],
    },
    evidence: {
      successfulSearches: 0,
      failedSearches: 1,
      successfulPageReads: 0,
      failedPageReads: 0,
      usableSources: 0,
      authorityRead: false,
      onlySecondaryEvidence: false,
    },
    missing: ['current_research'],
    truncated: false,
  });

  expect(handoff).toContain('Successful searches: 0');
  expect(handoff).toContain('usable sources: 0');
  expect(handoff).toContain('web:unavailable');
});
