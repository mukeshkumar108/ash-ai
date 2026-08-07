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

type ClassifierInput = {
  currentTurn: string;
  recentContext: string;
};

const NO_RESEARCH: EpistemicAssessment = {
  researchDepth: 'none',
  freshnessNeed: 'none',
  authorityNeed: 'none',
  sourceSensitivity: 'low',
  stakes: 'low',
  questionMode: 'conversation',
  reason: 'Ordinary conversation or stable explanation.',
  confidence: 0.8,
};

const EXPLICIT_RESEARCH =
  /\b(?:search|research|browse|look up|find (?:me )?(?:sources?|articles?|videos?|websites?)|check (?:online|the web))\b/iu;
const DECLINES_RESEARCH =
  /\b(?:do not|don't|dont|no need to) (?:search|research|browse|look (?:it )?up|use the web)\b/iu;

const CURRENT_EXTERNAL_FACT =
  /\b(?:latest|currently|current|today|this (?:week|month|year)|recent(?:ly)?|breaking|live|price|weather|score|schedule|release date|who is (?:the )?(?:current|new))\b/iu;
const ASKS_FOR_JUDGMENT =
  /(?:\b(?:what do you think|what's your (?:view|take)|what is your (?:view|take)|do you agree|don't you think|dont you think|how do you see it)\b|\bright\s*\?)/iu;
const FRAMED_CONCLUSION =
  /(?:\bI think\b.{0,120}\b(?:that|because|proves?|means?)\b|\b(?:clearly|obviously|probably just|must mean|proves? (?:that )?|means nothing)\b)/isu;

export function isFramedJudgmentRequest(currentTurn: string): boolean {
  return (
    ASKS_FOR_JUDGMENT.test(currentTurn) || FRAMED_CONCLUSION.test(currentTurn)
  );
}

function fallbackAssessment(currentTurn: string): EpistemicAssessment {
  if (EXPLICIT_RESEARCH.test(currentTurn)) {
    return {
      researchDepth: 'light',
      freshnessNeed: 'required',
      authorityNeed: 'none',
      sourceSensitivity: 'medium',
      stakes: 'low',
      questionMode: 'investigation',
      neutralResearchQuestion: currentTurn.slice(0, 300),
      reason: 'The user explicitly requested public research.',
      confidence: 0.55,
    };
  }
  if (CURRENT_EXTERNAL_FACT.test(currentTurn)) {
    return {
      researchDepth: 'light',
      freshnessNeed: 'required',
      authorityNeed: 'none',
      sourceSensitivity: 'medium',
      stakes: 'low',
      questionMode: 'explanation',
      neutralResearchQuestion: currentTurn.slice(0, 300),
      reason:
        'Classifier unavailable; current external fact requires checking.',
      confidence: 0,
    };
  }
  return { ...NO_RESEARCH, neutralResearchQuestion: null };
}

function policyPrompt({ currentTurn, recentContext }: ClassifierInput): string {
  return `You are an epistemic routing classifier. Do not answer the user's question. Decide only what evidence standard a truthful answer requires.

Distinguish stable explanation from claims that depend on current external facts. Distinguish ordinary research from requests that require actually reading a specific underlying authority such as a judgment, statute, regulator publication, original study, paper, dataset, standard, filing, or official document. Use recent context to understand follow-up verification such as "did they actually say that?".

This assessment governs public external research. Requests answerable through the app's trusted private Gmail or Calendar tools, or its trusted server clock, should not require public research merely because they concern the user's current email, schedule, date, or time.

Research depth:
- none: ordinary conversation or stable explanation
- light: a few targeted retrievals
- deep: explicit or genuinely multi-source investigation; controversy alone is insufficient

A request to verify one identifiable judgment, paper, filing, or quotation is normally light research with an authority read, not deep research. Interpretive prompts such as "why do people dislike Meta?" can remain conversational when the user is asking for a broad view rather than verification of a concrete factual premise. By contrast, "did Meta's internal research actually find X?" requires research and should prefer the original research when accessible.

An ordinary request for a view, judgment, interpretation, or help thinking should default to researchDepth=none when Sophie can answer usefully from learned understanding. Politics, science, law, medicine, or another serious subject does not by itself require public research. Do not turn “what do you think?” into an investigation merely because evidence exists. Research when the user requests it, a material premise is current or uncertain, consequential precision matters, or fresh evidence is likely to change the answer substantially.

Questions asking whether scientific or social-scientific evidence is strong, causal, replicated, or representative should normally use authorityNeed=preferred and sourceSensitivity=high. The synthesis should read the small number of original studies or reviews carrying its conclusion when accessible, without attempting to fetch every candidate.

Freshness need asks whether current external evidence is needed. Authority need asks whether snippets and summaries are insufficient and the underlying authority should actually be read. Use "required" only when completing the requested factual answer without it would be misleading. Stable educational questions can use "none" even in legal, medical, scientific, or financial domains.

If the user asks not to search, classify the evidence the question would objectively require anyway; runtime policy handles the refusal. Keep reason brief and machine-auditable. Do not include private details unnecessarily.

For a framed, disputed, or judgment-seeking question, provide neutralResearchQuestion as a concise, conclusion-neutral formulation of the issue Sophie should decide, even when researchDepth is none. Remove leading or loaded assumptions from the user's wording. If research is needed, the same formulation becomes the research question: ask about effects, strength, conditions, alternatives, and meaningful counterevidence rather than searching to prove or disprove the user's preferred conclusion. Oppositely framed versions of the same substantive question should yield materially equivalent neutral questions. Use null only when no neutralisation is useful, such as casual chat or a simple direct fact.

RECENT CONTEXT (bounded; may be empty):
${recentContext || '(none)'}

CURRENT USER TURN:
${currentTurn}`;
}

async function classifyWithModel(
  input: ClassifierInput,
  signal?: AbortSignal,
): Promise<EpistemicAssessment> {
  const modelId =
    process.env.EPISTEMIC_POLICY_MODEL?.trim() ||
    'google/gemini-3.1-flash-lite';
  const result = await generateObject({
    model: getLanguageModel(modelId),
    schema: epistemicAssessmentSchema,
    temperature: 0,
    maxOutputTokens: 280,
    prompt: policyPrompt(input),
    abortSignal: signal,
  });
  return result.object;
}

function applyConservativeEscalation(
  assessment: EpistemicAssessment,
): EpistemicAssessment {
  if (
    assessment.confidence < 0.65 &&
    (assessment.stakes === 'high' || assessment.sourceSensitivity === 'high')
  ) {
    return {
      ...assessment,
      freshnessNeed:
        assessment.freshnessNeed === 'none'
          ? 'preferred'
          : assessment.freshnessNeed,
      authorityNeed:
        assessment.authorityNeed === 'none'
          ? 'preferred'
          : assessment.authorityNeed,
      researchDepth:
        assessment.researchDepth === 'none'
          ? 'light'
          : assessment.researchDepth,
      reason:
        `${assessment.reason} Conservatively escalated due to low confidence and sensitivity.`.slice(
          0,
          180,
        ),
    };
  }
  return assessment;
}

function applyConversationalJudgmentDefault(
  assessment: EpistemicAssessment,
  currentTurn: string,
): EpistemicAssessment {
  if (
    !isFramedJudgmentRequest(currentTurn) ||
    EXPLICIT_RESEARCH.test(currentTurn) ||
    CURRENT_EXTERNAL_FACT.test(currentTurn) ||
    assessment.freshnessNeed === 'required' ||
    assessment.authorityNeed === 'required' ||
    assessment.stakes === 'high'
  ) {
    return assessment;
  }

  return {
    ...assessment,
    researchDepth: 'none',
    freshnessNeed: 'none',
    authorityNeed: 'none',
    questionMode: 'conversation',
    reason:
      'Ordinary judgment request; Sophie can reason naturally without defaulting to public research.',
  };
}

export async function assessEpistemicPolicy({
  currentTurn,
  recentContext = '',
  signal,
  classify,
}: ClassifierInput & {
  signal?: AbortSignal;
  classify?: (input: ClassifierInput) => Promise<unknown>;
}): Promise<EpistemicPolicy> {
  const normalized = currentTurn.trim();
  const userDeclinedResearch = DECLINES_RESEARCH.test(normalized);
  if (!normalized) {
    return {
      ...NO_RESEARCH,
      classifierRan: false,
      classifierSucceeded: false,
      userDeclinedResearch,
    };
  }

  try {
    const raw = classify
      ? await classify({ currentTurn: normalized, recentContext })
      : isTestEnvironment
        ? fallbackAssessment(normalized)
        : await classifyWithModel(
            { currentTurn: normalized, recentContext },
            signal,
          );
    const assessment = applyConversationalJudgmentDefault(
      applyConservativeEscalation(epistemicAssessmentSchema.parse(raw)),
      normalized,
    );
    return {
      ...assessment,
      classifierRan: Boolean(classify) || !isTestEnvironment,
      classifierSucceeded: true,
      userDeclinedResearch,
    };
  } catch {
    return {
      ...fallbackAssessment(normalized),
      classifierRan: !isTestEnvironment,
      classifierSucceeded: false,
      userDeclinedResearch,
      reason: 'Classifier unavailable; conservative deterministic fallback.',
      confidence: 0,
    };
  }
}

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

export function shouldUseJudgmentModel(
  policy: EpistemicPolicy,
  currentTurn = '',
): boolean {
  return (
    !requiresResearch(policy) &&
    policy.questionMode === 'conversation' &&
    (Boolean(policy.neutralResearchQuestion) ||
      isFramedJudgmentRequest(currentTurn))
  );
}

function succeeded(activity: ResearchActivity): boolean {
  return activity.status !== 'failed';
}

export function evidenceState(trace: ResearchTrace): EvidenceState {
  const searches = trace.activities.filter(({ kind }) => kind !== 'page');
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
      policy.questionMode === 'verification')
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
    /(?:\b(?:18|19|20)\d{2}\b|\b\d[\d,.]*\s*%|\b\d[\d,.]*\s+(?:people|users|participants|studies|weeks?|months?|years?)\b)/iu.test(
      paragraph,
    ) ||
    /\b(?:study|studies|paper|researchers?|court|judge|ruled|ruling|held|ordered|published|report(?:ed)?|dataset|trial|experiment|survey|review found|evidence shows)\b/iu.test(
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
  return process.env.SOPHIE_JUDGMENT_MODEL?.trim() || 'openai/gpt-5.6-luna-pro';
}
