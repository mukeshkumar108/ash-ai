import { expect, test } from '@playwright/test';

import {
  assessEpistemicPolicy,
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

async function classify(
  currentTurn: string,
  assessment: Record<string, unknown>,
  recentContext = '',
) {
  return assessEpistemicPolicy({
    currentTurn,
    recentContext,
    classify: async () => ({ ...base, ...assessment }),
  });
}

test('semantic assessment keeps stable explanations conversational', async () => {
  for (const question of [
    'What is copyright?',
    "Explain fair use like I'm 15.",
    'Why do interest rates affect mortgages?',
    'How does immune memory work?',
    'Why do people dislike Meta?',
  ]) {
    const policy = await classify(question, {});
    expect(policy.researchDepth).toBe('none');
    expect(policy.freshnessNeed).toBe('none');
  }
});

test('classifier outage does not turn an ordinary opinion into research', async () => {
  const policy = await assessEpistemicPolicy({
    currentTurn:
      "I'm not convinced social media causes political polarisation. What do you think?",
    recentContext: '',
    classify: async () => {
      throw new Error('classifier unavailable');
    },
  });

  expect(policy.researchDepth).toBe('none');
  expect(policy.freshnessNeed).toBe('none');
  expect(policy.neutralResearchQuestion).toBeNull();
  expect(shouldUseResearchModel(policy)).toBe(false);
});

test('classifier outage still checks explicitly current external facts', async () => {
  const policy = await assessEpistemicPolicy({
    currentTurn: 'What is the latest Bank of England interest rate?',
    recentContext: '',
    classify: async () => {
      throw new Error('classifier unavailable');
    },
  });

  expect(policy.researchDepth).toBe('light');
  expect(policy.freshnessNeed).toBe('required');
  expect(shouldUseResearchModel(policy)).toBe(true);
});

test('opposite framing can share one neutral research question', async () => {
  const neutral =
    'What effects does social media have on political polarisation, how strong is the causal evidence, and which competing explanations matter?';
  const classify = async () => ({
    researchDepth: 'light' as const,
    freshnessNeed: 'preferred' as const,
    authorityNeed: 'preferred' as const,
    sourceSensitivity: 'high' as const,
    stakes: 'medium' as const,
    questionMode: 'investigation' as const,
    neutralResearchQuestion: neutral,
    reason: 'Fresh evidence would materially improve the requested assessment.',
    confidence: 0.9,
  });

  const [skeptical, affirmative] = await Promise.all([
    assessEpistemicPolicy({
      currentTurn: 'Research why social media does not cause polarisation.',
      recentContext: '',
      classify,
    }),
    assessEpistemicPolicy({
      currentTurn: 'Research why social media causes polarisation.',
      recentContext: '',
      classify,
    }),
  ]);

  expect(skeptical.neutralResearchQuestion).toBe(neutral);
  expect(affirmative.neutralResearchQuestion).toBe(neutral);
});

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

test('framed statements and tag questions remain conversational judgments', async () => {
  const classify = async () => ({
    researchDepth: 'none' as const,
    freshnessNeed: 'none' as const,
    authorityNeed: 'none' as const,
    sourceSensitivity: 'medium' as const,
    stakes: 'low' as const,
    questionMode: 'conversation' as const,
    capabilityRoute: 'reply' as const,
    interactionMode: 'judgment' as const,
    neutralResearchQuestion:
      'How stable and categorical are introversion and extroversion?',
    reason: 'Stable psychology explanation.',
    confidence: 0.9,
  });
  const tagQuestion = await assessEpistemicPolicy({
    currentTurn:
      "People are either introverts or extroverts and that's fixed, right?",
    recentContext: '',
    classify,
  });
  const framedStatement = await assessEpistemicPolicy({
    currentTurn:
      "My friend hasn't replied, but they're probably just busy and it means nothing.",
    recentContext: '',
    classify,
  });

  expect(shouldUseResearchModel(tagQuestion)).toBe(false);
  expect(tagQuestion.questionMode).toBe('conversation');
  expect(shouldUseResearchModel(framedStatement)).toBe(false);
  expect(shouldUseJudgmentModel(framedStatement)).toBe(true);
});

test('trusted private tools and server clock do not require public research', async () => {
  for (const question of [
    "What's on my calendar this week?",
    'Have I got any unread Gmail messages?',
    'What day and time is it?',
  ]) {
    const policy = await classify(question, {
      questionMode: 'conversation',
      reason: 'Answered by a trusted private or server source.',
    });
    expect(policy).toMatchObject({
      researchDepth: 'none',
      freshnessNeed: 'none',
      authorityNeed: 'none',
    });
  }
});

test('semantic classifier routes private data separately from public research', async () => {
  const privateRead = await classify("What's on my calendar?", {
    capabilityRoute: 'read_tools',
    questionMode: 'conversation',
  });
  const clock = await classify('What time is it?', {
    capabilityRoute: 'reply',
    questionMode: 'conversation',
  });

  expect(privateRead.capabilityRoute).toBe('read_tools');
  expect(privateRead.researchDepth).toBe('none');
  expect(clock.capabilityRoute).toBe('reply');
});

test('semantic assessment represents current and factual verification needs', async () => {
  const currentLaw = await classify(
    'What is the current legal position on copyrighted AI training in the US?',
    {
      researchDepth: 'light',
      freshnessNeed: 'required',
      sourceSensitivity: 'high',
      stakes: 'medium',
      questionMode: 'verification',
    },
  );
  expect(currentLaw.freshnessNeed).toBe('required');

  const meta = await classify(
    "Did Meta's internal research really show Instagram harmed teenage girls?",
    {
      researchDepth: 'light',
      freshnessNeed: 'required',
      authorityNeed: 'preferred',
      sourceSensitivity: 'high',
      questionMode: 'verification',
    },
  );
  expect(meta).toMatchObject({
    freshnessNeed: 'required',
    authorityNeed: 'preferred',
  });
});

test('specific authorities and original papers can require an authority read', async () => {
  const ruling = await classify(
    'Judge Alsup said Anthropic could destroy books because they owned them. Is that actually what he ruled?',
    {
      researchDepth: 'light',
      freshnessNeed: 'preferred',
      authorityNeed: 'required',
      sourceSensitivity: 'high',
      stakes: 'medium',
      questionMode: 'verification',
    },
  );
  expect(ruling.authorityNeed).toBe('required');
  expect(requiresInlineCitations(ruling)).toBe(true);

  const paper = await classify(
    'Is this paper everyone is citing actually any good?',
    {
      researchDepth: 'deep',
      freshnessNeed: 'preferred',
      authorityNeed: 'required',
      sourceSensitivity: 'high',
      questionMode: 'investigation',
    },
  );
  expect(paper).toMatchObject({
    researchDepth: 'deep',
    authorityNeed: 'required',
  });
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

test('do-you-think phrasing is recognised as judgment without forced research', async () => {
  const policy = await classify(
    'Do you think social media contributes to political polarisation?',
    {
      questionMode: 'conversation',
      interactionMode: 'judgment',
      neutralResearchQuestion:
        'What role does social media play in political polarisation?',
    },
  );

  expect(policy.interactionMode).toBe('judgment');
  expect(shouldUseJudgmentModel(policy)).toBe(true);
  expect(shouldUseResearchModel(policy)).toBe(false);
});

test('bounded recent context lets a follow-up inherit verification needs', async () => {
  let receivedContext = '';
  const policy = await assessEpistemicPolicy({
    currentTurn: 'Did he actually say that?',
    recentContext:
      'assistant: Judge Alsup ruled that Anthropic could destroy books because it owned them.',
    classify: async (input) => {
      receivedContext = input.recentContext;
      return {
        ...base,
        researchDepth: 'light',
        freshnessNeed: 'preferred',
        authorityNeed: 'required',
        sourceSensitivity: 'high',
        questionMode: 'verification',
      };
    },
  });
  expect(receivedContext).toContain('Judge Alsup');
  expect(policy.authorityNeed).toBe('required');
});

test('explicit no-search instruction is respected without erasing epistemic need', async () => {
  const policy = await classify(
    "Don't search, just tell me what you understand about the current case.",
    {
      researchDepth: 'light',
      freshnessNeed: 'required',
      authorityNeed: 'preferred',
      sourceSensitivity: 'high',
      questionMode: 'explanation',
    },
  );
  expect(policy.userDeclinedResearch).toBe(true);
  expect(policy.freshnessNeed).toBe('required');
  expect(evidenceGapsForRetry(policy, evidenceState(emptyTrace))).toEqual([]);
});

const emptyTrace: ResearchTrace = { activities: [], sources: [] };
const searchOnly: ResearchTrace = {
  activities: [{ kind: 'web', query: 'case', resultCount: 3 }],
  sources: [
    {
      title: 'Analysis',
      url: 'https://example.com/analysis',
      hostname: 'example.com',
    },
  ],
};

test('primary-source requirement is enforced independently from search results', async () => {
  const policy = await classify('What did the ruling itself say?', {
    researchDepth: 'light',
    freshnessNeed: 'preferred',
    authorityNeed: 'required',
    sourceSensitivity: 'high',
    questionMode: 'verification',
  });
  expect(missingRequiredEvidence(policy, evidenceState(searchOnly))).toEqual([
    'authority_read',
  ]);

  const withMirror: ResearchTrace = {
    activities: [
      ...searchOnly.activities,
      {
        kind: 'page',
        query: 'https://law.example/case',
        resultCount: 1,
        sourceRole: 'full_text_mirror',
      },
    ],
    sources: searchOnly.sources,
  };
  expect(missingRequiredEvidence(policy, evidenceState(withMirror))).toEqual(
    [],
  );
});

test('preferred authority shapes planning without forcing a full retry', async () => {
  const policy = await classify('How strong is the scientific evidence?', {
    researchDepth: 'light',
    freshnessNeed: 'preferred',
    authorityNeed: 'preferred',
    sourceSensitivity: 'high',
    questionMode: 'investigation',
  });
  expect(evidenceGapsForRetry(policy, evidenceState(searchOnly))).toEqual([]);
});

test('failed reads and empty searches are not usable evidence', async () => {
  const trace: ResearchTrace = {
    activities: [
      { kind: 'web', query: 'case', resultCount: 0 },
      {
        kind: 'page',
        query: 'https://court.example',
        status: 'failed',
        failure: 'unavailable',
        sourceRole: 'official',
      },
    ],
    sources: [],
  };
  const state = evidenceState(trace);
  expect(state).toMatchObject({
    successfulPageReads: 0,
    failedPageReads: 1,
    usableSources: 0,
    authorityRead: false,
  });

  const policy = await classify('Verify the order.', {
    researchDepth: 'light',
    freshnessNeed: 'required',
    authorityNeed: 'required',
    sourceSensitivity: 'high',
    questionMode: 'verification',
  });
  expect(missingRequiredEvidence(policy, state)).toEqual([
    'current_research',
    'authority_read',
  ]);
});

test('uncertain sensitive classifications escalate conservatively', async () => {
  const policy = await classify('Could this affect my treatment?', {
    confidence: 0.4,
    sourceSensitivity: 'high',
    stakes: 'high',
  });
  expect(policy).toMatchObject({
    researchDepth: 'light',
    freshnessNeed: 'preferred',
    authorityNeed: 'preferred',
  });
});

test('classifier failure keeps ambiguous stable questions conversational', async () => {
  const policy = await assessEpistemicPolicy({
    currentTurn: 'What changed in this case?',
    recentContext: '',
    classify: async () => {
      throw new Error('classifier unavailable');
    },
  });
  expect(policy).toMatchObject({
    classifierRan: true,
    classifierSucceeded: false,
    researchDepth: 'none',
    freshnessNeed: 'none',
    confidence: 0,
  });
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

test('semantic live-data decisions pass through without keyword overrides', async () => {
  for (const currentTurn of [
    'What is the weather in Burwell today?',
    'Reckon I need a jacket?',
    'What time is sunset?',
    'Will it rain this evening?',
  ]) {
    const policy = await assessEpistemicPolicy({
      currentTurn,
      recentContext: '',
      classify: async () => ({
        ...base,
        researchDepth: 'none',
        freshnessNeed: 'required',
        capabilityRoute: 'live_data',
        interactionMode: 'practical',
      }),
    });
    expect(policy.capabilityRoute).toBe('live_data');
    expect(policy.researchDepth).toBe('none');
    expect(policy.freshnessNeed).toBe('required');
  }
});

test('semantic classifier—not sky keywords—selects current astronomy research', async () => {
  const policy = await assessEpistemicPolicy({
    currentTurn: 'Which planets can I see tonight?',
    recentContext: 'user: I am in Burwell, Cambridgeshire',
    classify: async () => ({
      ...base,
      capabilityRoute: 'reply',
      researchDepth: 'light',
      freshnessNeed: 'required',
      authorityNeed: 'preferred',
      sourceSensitivity: 'medium',
      questionMode: 'verification',
      interactionMode: 'practical',
      neutralResearchQuestion:
        'Which planets are visible from Burwell tonight, and at what verified times and directions?',
    }),
  });

  expect(policy).toMatchObject({
    capabilityRoute: 'reply',
    researchDepth: 'light',
    freshnessNeed: 'required',
    authorityNeed: 'preferred',
    sourceSensitivity: 'medium',
    questionMode: 'verification',
    interactionMode: 'practical',
  });
  expect(policy.neutralResearchQuestion).toContain('Burwell');
});

test('semantic classifier can keep weather-adjacent conversation out of tools', async () => {
  const policy = await assessEpistemicPolicy({
    currentTurn:
      'No jacket even this evening — shorts and t-shirt weather lol. Maybe watch the sunset.',
    recentContext: 'assistant: It is warm in Burwell today.',
    classify: async () => ({
      ...base,
      capabilityRoute: 'reply',
      interactionMode: 'social',
      questionMode: 'conversation',
    }),
  });

  expect(policy).toMatchObject({
    capabilityRoute: 'reply',
    researchDepth: 'none',
    interactionMode: 'social',
  });
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
