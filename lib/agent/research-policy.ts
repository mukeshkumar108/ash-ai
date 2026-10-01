import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';
import { getLanguageModel } from '@/lib/ai/providers';
import { isTestEnvironment } from '@/lib/constants';
import type { ResearchActivity, ResearchTrace } from '@/lib/types';

export const epistemicAssessmentSchema = z
  .object({
    researchDepth: z.enum(['none', 'light', 'deep']),
    freshnessNeed: z.enum(['none', 'preferred', 'required']),
    authorityNeed: z.enum(['none', 'preferred', 'required']),
    sourceSensitivity: z.enum(['low', 'medium', 'high']),
    stakes: z.enum(['low', 'medium', 'high']),
    questionMode: z.enum([
      'conversation',
      'explanation',
      'verification',
      'investigation',
    ]),
    capabilityRoute: z.enum(['reply', 'read_tools', 'live_data']).optional(),
    interactionMode: z
      .enum([
        'social',
        'celebration',
        'judgment',
        'emotional',
        'practical',
        'safety',
      ])
      .optional(),
    neutralResearchQuestion: z.string().trim().max(300).nullable().optional(),
    reason: z.string().trim().min(1).max(180),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type EpistemicAssessment = z.infer<typeof epistemicAssessmentSchema>;

export type EpistemicPolicy = EpistemicAssessment & {
  classifierRan: boolean;
  classifierSucceeded: boolean;
  userDeclinedResearch: boolean;
};

export type EvidenceState = {
  successfulSearches: number;
  failedSearches: number;
  successfulPageReads: number;
  failedPageReads: number;
  usableSources: number;
  authorityRead: boolean;
  onlySecondaryEvidence: boolean;
};

export function requiresResearch(policy: EpistemicPolicy): boolean {
  if (policy.userDeclinedResearch) return false;
  return (
    policy.freshnessNeed === 'required' ||
    policy.authorityNeed === 'required' ||
    policy.researchDepth !== 'none'
  );
}

export function shouldUseResearchModel(policy: EpistemicPolicy): boolean {
  return requiresResearch(policy);
}

export function shouldUseJudgmentModel(policy: EpistemicPolicy): boolean {
  return (
    !requiresResearch(policy) &&
    policy.questionMode === 'conversation' &&
    (policy.interactionMode === 'judgment' ||
      Boolean(policy.neutralResearchQuestion))
  );
}

function succeeded(activity: ResearchActivity): boolean {
  return activity.status !== 'failed';
}

export function evidenceState(trace: ResearchTrace): EvidenceState {
  const searches = trace.activities.filter(
    ({ kind }) => kind !== 'page' && kind !== 'weather',
  );
  const pages = trace.activities.filter(({ kind }) => kind === 'page');
  const successfulPageReads = pages.filter(succeeded);
  const successfulSearches = searches.filter(
    (activity) => succeeded(activity) && (activity.resultCount ?? 0) > 0,
  );
  return {
    successfulSearches: successfulSearches.length,
    failedSearches: searches.filter((activity) => !succeeded(activity)).length,
    successfulPageReads: successfulPageReads.length,
    failedPageReads: pages.filter((activity) => !succeeded(activity)).length,
    usableSources: trace.sources.length,
    authorityRead: successfulPageReads.some(
      ({ sourceRole }) =>
        sourceRole === 'official' || sourceRole === 'full_text_mirror',
    ),
    onlySecondaryEvidence:
      trace.sources.length > 0 &&
      !successfulPageReads.some(
        ({ sourceRole }) =>
          sourceRole === 'official' || sourceRole === 'full_text_mirror',
      ),
  };
}

export function missingRequiredEvidence(
  policy: EpistemicPolicy,
  state: EvidenceState,
): Array<'current_research' | 'authority_read'> {
  if (policy.userDeclinedResearch) return [];
  const missing: Array<'current_research' | 'authority_read'> = [];
  if (
    policy.freshnessNeed === 'required' &&
    (state.successfulSearches === 0 || state.usableSources === 0)
  ) {
    missing.push('current_research');
  }
  if (policy.authorityNeed === 'required' && !state.authorityRead) {
    missing.push('authority_read');
  }
  return missing;
}

export function evidenceGapsForRetry(
  policy: EpistemicPolicy,
  state: EvidenceState,
): Array<'current_research' | 'authority_read'> {
  if (policy.userDeclinedResearch) return [];
  const gaps = missingRequiredEvidence(policy, state);
  if (
    policy.researchDepth !== 'none' &&
    state.successfulSearches === 0 &&
    !gaps.includes('current_research')
  ) {
    gaps.push('current_research');
  }
  return gaps;
}

export function requiresInlineCitations(policy: EpistemicPolicy): boolean {
  return (
    !policy.userDeclinedResearch &&
    (policy.authorityNeed === 'required' ||
      policy.questionMode === 'verification' ||
      (policy.researchDepth !== 'none' &&
        policy.sourceSensitivity === 'high' &&
        policy.questionMode === 'investigation'))
  );
}

export function hasInlineCitation(text: string): boolean {
  return /\[[^\]]+\]\(https?:\/\/[^\s)]+\)/u.test(text);
}

function canonicalCitationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function citedUrls(text: string): Set<string> {
  const urls = new Set<string>();
  for (const match of text.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/gu)) {
    const canonical = canonicalCitationUrl(match[1]);
    if (canonical) urls.add(canonical);
  }
  return urls;
}

export function hasGroundedInlineCitation(
  text: string,
  trace: ResearchTrace,
): boolean {
  const cited = citedUrls(text);
  return trace.sources.some((source) => {
    const canonical = canonicalCitationUrl(source.url);
    return canonical !== null && cited.has(canonical);
  });
}

export function hasOnlyGroundedCitations(
  text: string,
  trace: ResearchTrace,
): boolean {
  const cited = citedUrls(text);
  const grounded = new Set(
    trace.sources
      .map((source) => canonicalCitationUrl(source.url))
      .filter((url): url is string => url !== null),
  );
  return [...cited].every((url) => grounded.has(url));
}

function hasMaterialFactualClaim(paragraph: string): boolean {
  return (
    /(?:\b(?:18|19|20)\d{2}\b|\b\d[\d,.]*\s*%|\b\d[\d,.]*\s+(?:people|users|participants|studies|weeks?|months?|years?)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b)/iu.test(
      paragraph,
    ) ||
    /\b(?:study|studies|paper|researchers?|court|judge|ruled|ruling|held|ordered|published|report(?:ed)?|dataset|trial|experiment|survey|review found|evidence shows|sunrise|sunset|rises?|sets?)\b/iu.test(
      paragraph,
    )
  );
}

export function hasMaterialClaimCitationCoverage(
  text: string,
  trace: ResearchTrace,
): boolean {
  const paragraphs = text
    .split(/\n{2,}|(?=^[-*]\s)/gmu)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const material = paragraphs.filter(hasMaterialFactualClaim);
  return (
    material.length === 0 ||
    material.every((paragraph) => hasGroundedInlineCitation(paragraph, trace))
  );
}

export function markCitedSources(
  trace: ResearchTrace,
  text: string,
): ResearchTrace {
  const cited = citedUrls(text);
  return {
    ...trace,
    sources: trace.sources.map((source) => {
      const canonical = canonicalCitationUrl(source.url);
      return {
        ...source,
        cited: canonical !== null && cited.has(canonical),
      };
    }),
  };
}

export function researchModelId(): string {
  return process.env.RESEARCH_CHAT_MODEL?.trim() || 'openai/gpt-5.6-luna-pro';
}

export function researchFallbackModelId(): string {
  return (
    process.env.RESEARCH_CHAT_FALLBACK_MODEL?.trim() || 'openai/gpt-5.6-luna'
  );
}

export function judgmentModelId(): string {
  return (
    process.env.SOPHIE_JUDGMENT_MODEL?.trim() || 'google/gemini-3.5-flash-lite'
  );
}

export function celebrationModelId(): string {
  return (
    process.env.SOPHIE_CELEBRATION_MODEL?.trim() || 'openai/gpt-5.6-luna-pro'
  );
}
