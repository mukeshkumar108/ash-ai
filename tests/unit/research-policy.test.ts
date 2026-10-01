import { expect, test } from '@playwright/test';

import {
  celebrationModelId,
  evidenceGapsForRetry,
  evidenceState,
  hasInlineCitation,
  hasGroundedInlineCitation,
  hasMaterialClaimCitationCoverage,
  hasOnlyGroundedCitations,
  judgmentModelId,
  markCitedSources,
  missingRequiredEvidence,
  researchModelId,
  researchFallbackModelId,
  requiresInlineCitations,
  shouldUseResearchModel,
  shouldUseJudgmentModel,
} from '@/lib/agent/research-policy';
import type { ResearchTrace } from '@/lib/types';

const base = {
  researchDepth: 'none' as const,
  freshnessNeed: 'none' as const,
  authorityNeed: 'none' as const,
  sourceSensitivity: 'low' as const,
  stakes: 'low' as const,
  questionMode: 'explanation' as const,
  reason: 'Stable explanatory question.',
  confidence: 0.9,
};

test('framed conversational judgments use a dedicated model without research', () => {
  const judgment = {
    ...base,
    questionMode: 'conversation' as const,
    classifierRan: true,
    classifierSucceeded: true,
    userDeclinedResearch: false,
    neutralResearchQuestion:
      'What relationship exists between social media and political polarisation?',
  };

  expect(shouldUseResearchModel(judgment)).toBe(false);
  expect(shouldUseJudgmentModel(judgment)).toBe(true);
  expect(judgmentModelId()).toBe('google/gemini-3.5-flash-lite');
});

test('celebration model remains independently configurable', () => {
  expect(celebrationModelId()).toBe('openai/gpt-5.6-luna-pro');
});

test('source-sensitive research requires citations for material factual claims', () => {
  expect(
    requiresInlineCitations({
      researchDepth: 'deep',
      freshnessNeed: 'preferred',
      authorityNeed: 'preferred',
      sourceSensitivity: 'high',
      stakes: 'medium',
      questionMode: 'investigation',
      reason: 'Fresh research may improve an ordinary opinion.',
      confidence: 0.9,
      classifierRan: true,
      classifierSucceeded: true,
      userDeclinedResearch: false,
    }),
  ).toBe(true);
});

test('inline citation detection requires a real Markdown link', () => {
  expect(hasInlineCitation('According to (Example), the claim is true.')).toBe(
    false,
  );
  expect(
    hasInlineCitation(
      'The order says so [in the judgment](https://court.example/order).',
    ),
  ).toBe(true);
});

test('citation grounding accepts only URLs returned by research', () => {
  const trace = {
    activities: [],
    sources: [
      {
        title: 'Court order',
        url: 'https://court.example/order#page=2',
        hostname: 'court.example',
      },
    ],
  };
  expect(
    hasGroundedInlineCitation(
      '[the order](https://court.example/order)',
      trace,
    ),
  ).toBe(true);
  expect(
    hasGroundedInlineCitation(
      '[invented](https://unseen.example/story)',
      trace,
    ),
  ).toBe(false);
  expect(
    markCitedSources(trace, '[the order](https://court.example/order)'),
  ).toMatchObject({ sources: [{ cited: true }] });
});

test('final synthesis cannot introduce a URL that research did not return', () => {
  const trace = {
    activities: [],
    sources: [
      {
        title: 'Real source',
        url: 'https://example.com/real',
        hostname: 'example.com',
      },
    ],
  };

  expect(
    hasOnlyGroundedCitations('[Source](https://example.com/real)', trace),
  ).toBe(true);
  expect(
    hasOnlyGroundedCitations('[Invented](https://example.com/invented)', trace),
  ).toBe(false);
});

test('material researched claims need grounded citations in each paragraph', () => {
  const trace = {
    activities: [],
    sources: [
      {
        title: 'Paper',
        url: 'https://science.example/paper',
        hostname: 'science.example',
      },
    ],
  };
  expect(
    hasMaterialClaimCitationCoverage(
      'A 2026 study found an effect [in the paper](https://science.example/paper).\n\nMy judgment is that the result is important.',
      trace,
    ),
  ).toBe(true);
  expect(
    hasMaterialClaimCitationCoverage(
      'A 2026 study found an effect.\n\nA court also ruled against the company [in the paper](https://science.example/paper).',
      trace,
    ),
  ).toBe(false);
});

test('research synthesis model remains configurable', () => {
  const previous = process.env.RESEARCH_CHAT_MODEL;
  const previousFallback = process.env.RESEARCH_CHAT_FALLBACK_MODEL;
  process.env.RESEARCH_CHAT_MODEL = '';
  process.env.RESEARCH_CHAT_FALLBACK_MODEL = '';
  expect(researchModelId()).toBe('openai/gpt-5.6-luna-pro');
  expect(researchFallbackModelId()).toBe('openai/gpt-5.6-luna');
  process.env.RESEARCH_CHAT_MODEL = 'openai/gpt-5.6-terra';
  process.env.RESEARCH_CHAT_FALLBACK_MODEL = 'openai/gpt-5.6-mini';
  expect(researchModelId()).toBe('openai/gpt-5.6-terra');
  expect(researchFallbackModelId()).toBe('openai/gpt-5.6-mini');
  if (previous === undefined) {
    Reflect.deleteProperty(process.env, 'RESEARCH_CHAT_MODEL');
  } else {
    process.env.RESEARCH_CHAT_MODEL = previous;
  }
  if (previousFallback === undefined) {
    Reflect.deleteProperty(process.env, 'RESEARCH_CHAT_FALLBACK_MODEL');
  } else {
    process.env.RESEARCH_CHAT_FALLBACK_MODEL = previousFallback;
  }
});

test('exact researched clock times count as material citation-bearing claims', () => {
  const trace: ResearchTrace = {
    activities: [],
    sources: [
      {
        title: 'Sky guide',
        url: 'https://astronomy.example/guide',
        hostname: 'astronomy.example',
      },
    ],
  };
  expect(
    hasMaterialClaimCitationCoverage(
      'Saturn rises at 10:30 pm in the southeast.',
      trace,
    ),
  ).toBe(false);
  expect(
    hasMaterialClaimCitationCoverage(
      'Saturn rises at 10:30 pm in the southeast [Sky guide](https://astronomy.example/guide).',
      trace,
    ),
  ).toBe(true);
});
