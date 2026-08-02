import { myProvider } from '@/lib/ai/providers';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { PromptDomainState } from './prompt-domains';
import { logAIError } from './error-log';

import { activeStateSchema } from './active-state';
import {
  continuityEventSchema,
  relationshipDeltaSchema,
  type ExtractorOperation,
  type RelationshipDelta,
} from './continuity';

const SUMMARY_MAX_OUTPUT_TOKENS = Number(
  process.env.SUMMARIZER_MAX_OUTPUT_TOKENS ?? 900,
);

const UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS = Number(
  process.env.UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS ?? 4000,
);

export interface Summarizer {
  summarizePlain(
    convo: { role: 'user' | 'assistant'; content: string }[],
    tier: 'short' | 'medium' | 'long',
  ): Promise<string>; // returns tier-appropriate sentences (plain text)

  summarizeStructured(
    convo: { role: 'user' | 'assistant'; content: string }[],
    previousMemory?: StructuredMemory,
    options?: {
      characterName?: string;
    },
  ): Promise<StructuredMemory>; // returns structured memory with facts, decisions, etc.

  extractIncrementalPatch(
    convo: { role: 'user' | 'assistant'; content: string }[],
    previousMemory?: StructuredMemory,
    options?: {
      characterName?: string;
    },
  ): Promise<IncrementalMemoryPatch>;

  extractUnifiedUpdate(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      previousMemory?: StructuredMemory;
      previousActiveState?: any;
      previousDynamics?: any;
      characterName?: string;
    },
  ): Promise<UnifiedRPUpdate>;

  extractOntologyUpdate(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      previousMemory?: StructuredMemory;
      previousActiveState?: any;
      previousDynamics?: any;
      characterName?: string;
      previousOntologyItems?: import('@/lib/ai/continuity').OntologyItem[];
      previousPersonModels?: import('@/lib/ai/continuity').PersonModel[];
      historicalEvidence?: string;
    },
  ): Promise<import('@/lib/ai/continuity').UnifiedContinuityUpdate>;

  extractCanonicalEvents(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      characterName?: string;
    },
  ): Promise<{ events: { type: string; statement: string }[] }>;
}

export interface StructuredMemory {
  // Natural language summary (concise)
  summary: string;

  // RP-specific fields
  core_facts: string[];
  relationship_milestones: string[];
  major_events: string[];
  emotional_turns: string[];
  promises_and_commitments: string[];
  relationship_state: string;
  emotional_state: string;
  user_preferences: {
    emotional: string[];
    sexual: string[];
  };
  shared_memories: string[];
  hidden_fantasies: string[];
  characters_and_npcs: string[]; // People mentioned
  people_registry: string[]; // Normalized people/NPC registry
  significant_incidents: string[]; // Specific events/incidents
  decisions_and_commitments: string[]; // Explicit decisions and agreed next steps
  relationship_rules: string[]; // Explicit rules established in the relationship
  agreements: string[]; // Standing agreements that should persist
  boundaries: string[]; // Explicit permissions, limits, and conditions
  must_not_forget: string[]; // Pinned canon that should survive long chats
  active_desires: string[]; // Current wants, urges, and psychological pulls
  fantasy_themes: string[]; // Soft recurring fantasy themes; not hard canon
  sexual_history?: {
    favorite_things: string[]; // Positions, sensations, dynamics she loves
    acts: string[]; // Notable sexual acts that happened (e.g. "first time kitchen counter")
    aftercare_needs: string[]; // What she needs after intense scenes
    dirty_phrases_used: string[]; // Specific dirty talk patterns she uses
  };
  prompt_domains?: PromptDomainState;
  relational_guidance?: {
    core_relationship_direction: string;
    user_desired_direction: string;
    allowed_resistance_styles: string[];
    disallowed_drift: string[];
    dominant_tension: string;
    supportive_arc_pressure: string;
    reason: string;
  };
  corruption_level: number; // 0 to 10 scale
  open_emotional_threads: string[];
  resolved_threads: string[];
  recent_scene_recap: string;

  // Quality metadata
  metadata: {
    confidence: number;
    extractedAt: Date;
    lastRefreshTurnCount?: number;
    lastRefreshSalience?: number;
    lastRefreshDate?: string;
    lastRefreshSeq?: number;
    canonVersion?: number;
    consecutiveFailures?: number;
    reframeWarnings?: string[];
    currentArc?: string;
    rejectedClaims?: { reason: string; statement: string }[];
  };
}

export interface IncrementalMemoryPatch {
  summary?: string;
  core_facts?: string[];
  major_events?: string[];
  emotional_turns?: string[];
  promises_and_commitments?: string[];
  people_registry?: string[];
  significant_incidents?: string[];
  decisions_and_commitments?: string[];
  relationship_rules?: string[];
  agreements?: string[];
  boundaries?: string[];
  must_not_forget?: string[];
  active_desires?: string[];
  fantasy_themes?: string[];
  sexual_history?: {
    favorite_things?: string[];
    acts?: string[];
    aftercare_needs?: string[];
    dirty_phrases_used?: string[];
  };
  open_emotional_threads?: string[];
  relationship_state?: string;
  emotional_state?: string;
  recent_scene_recap?: string;
  // Explicit removals. Present only when the user explicitly revokes an
  // established rule/agreement/boundary. Omission means NO_CHANGE.
  revoke_agreements?: string[];
  revoke_rules?: string[];
  revoke_boundaries?: string[];
  revoke_promises?: string[];
}

/**
 * Authority policy for rule-shaped memory fields.
 *
 * Two separate concerns:
 *  1. CREATE authority: a NEW rule/agreement/boundary may only be added when
 *     the user (or the character acting for the user) explicitly establishes
 *     it within the extraction window.
 *  2. PERSISTENCE: already-established rules/agreements/boundaries remain
 *     active until an explicit ADD / UPDATE / REVOKE / SUPERSEDE / RESOLVE.
 *     A patch that omits these fields must mean NO_CHANGE — never
 *     "replace with an empty collection".
 *
 * This function only ever strips *newly proposed* entries that lack authority.
 * It never clears existing canon, and it always lets explicit revocations pass.
 */
export function enforceMemoryPatchAuthority(
  patch: IncrementalMemoryPatch,
  convo: { role: 'user' | 'assistant'; content: string }[],
  thirdPartyMode = 'closed',
): IncrementalMemoryPatch {
  const userText = convo
    .filter(turn => turn.role === 'user')
    .map(turn => turn.content)
    .join('\n');
  const hasExplicitRuleAuthority =
    /\b(?:we\s+(?:agree|agreed)|our\s+(?:rule|agreement|boundary)|i\s+(?:explicitly\s+)?(?:consent|agree|permit|allow)|i\s+(?:give|gave)\s+you\s+permission|promise\s+me|you\s+must\s+never|you\s+(?:are\s+not|aren't)\s+allowed)\b/i
      .test(userText);
  const hasExplicitFantasyAuthority =
    /\b(?:my\s+fantasy\s+is|i\s+fantasi[sz]e|we\s+(?:agree|agreed)\s+to\s+explore|i\s+want\s+us\s+to\s+explore)\b/i
      .test(userText);

  const safe: IncrementalMemoryPatch = { ...patch };

  // CREATE authority gate: only newly-proposed rules/agreements/boundaries are
  // removed. Established canon is untouched here — the merge layer treats a
  // missing field as NO_CHANGE. Behaviour, silence, arousal, repeated
  // generation, and NPC dialogue cannot create permissions or erase boundaries.
  if (!hasExplicitRuleAuthority) {
    delete safe.relationship_rules;
    delete safe.agreements;
    delete safe.boundaries;
  }

  // A directed scene is not evidence of the companion's durable psychology.
  if (thirdPartyMode !== 'closed' && !hasExplicitFantasyAuthority) {
    delete safe.active_desires;
    delete safe.fantasy_themes;
  }

  // Explicit revocations always pass through: removing an established rule is
  // itself an explicit, user-driven operation.
  return safe;
}

const LOW_INFORMATION_STATE_VALUES =
  /^(relationship continuity is beginning to form\.?|early interaction\.?|developing\.?|neutral\.?|current state of the relationship\.?|recent interaction continued naturally\.?|no summary\.?|no prior (?:state|summary)\.?)$/i;

export function isLowInformationStateValue(value?: string): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  return LOW_INFORMATION_STATE_VALUES.test(trimmed);
}

const incrementalMemoryPatchSchema = z.object({
  summary: z.string().optional(),
  core_facts: z.array(z.string()).max(6).optional(),
  major_events: z.array(z.string()).max(4).optional(),
  emotional_turns: z.array(z.string()).max(4).optional(),
  promises_and_commitments: z.array(z.string()).max(4).optional(),
  people_registry: z.array(z.string()).max(6).optional(),
  significant_incidents: z.array(z.string()).max(8).optional(),
  decisions_and_commitments: z.array(z.string()).max(4).optional(),
  relationship_rules: z.array(z.string()).max(4).optional(),
  agreements: z.array(z.string()).max(4).optional(),
  boundaries: z.array(z.string()).max(4).optional(),
  must_not_forget: z.array(z.string()).max(6).optional(),
  active_desires: z.array(z.string()).max(4).optional(),
  fantasy_themes: z.array(z.string()).max(4).optional(),
  sexual_history: z.object({
    favorite_things: z.array(z.string()).max(4).optional(),
    acts: z.array(z.string()).max(4).optional(),
    aftercare_needs: z.array(z.string()).max(4).optional(),
    dirty_phrases_used: z.array(z.string()).max(4).optional(),
  }).optional(),
  open_emotional_threads: z.array(z.string()).max(4).optional(),
  relationship_state: z.string().optional(),
  emotional_state: z.string().optional(),
  recent_scene_recap: z.string().optional(),
  revoke_agreements: z.array(z.string()).max(8).optional(),
  revoke_rules: z.array(z.string()).max(8).optional(),
  revoke_boundaries: z.array(z.string()).max(8).optional(),
  revoke_promises: z.array(z.string()).max(8).optional(),
});

export interface UnifiedRPUpdate {
  memoryPatch: IncrementalMemoryPatch;
  activeState: any;
  newEvents: any[];
  dynamicsDeltas: RelationshipDelta[];
  reasoning: string;
}

const unifiedRPUpdateSchema = z.object({
  memoryPatch: incrementalMemoryPatchSchema,
  activeState: activeStateSchema,
  newEvents: z.array(continuityEventSchema),
  dynamicsDeltas: z.array(relationshipDeltaSchema).max(5),
  reasoning: z.string(),
});

export function selectTopContinuityEvents<T extends {
  id?: string;
  summary?: string;
  importance?: number;
  unresolved?: boolean;
  persist?: boolean;
  actuality?: string;
}>(events: T[], limit = 3): T[] {
  // Content type is not actuality. A narrated event that happens inside the
  // roleplay world (RP_CANON_EVENT / ACTUAL_EVENT / OOC_INSTRUCTION) is
  // persistable, even when it is fictional in the real world or explicit.
  const actualityScore: Record<string, number> = {
    ACTUAL_EVENT: 50,
    RP_CANON_EVENT: 50,
    REAL_WORLD_FACT: 50,
    OOC_INSTRUCTION: 45,
    RELATIONAL_TRUTH: 45,
    CHARACTER_REFRAME: 40,
    POWER_REFRAME: 40,
    RP_CHARACTER_CLAIM: 30,
    RP_CHARACTER_LIE: 25,
    SPOKEN_INTENTION: 20,
    SPOKEN_THREAT: 20,
    INTERPRETATION: 10,
    RP_HYPOTHETICAL: 5,
    TEMPORARY_SCENE_AFFECT: 0,
    PERFORMATIVE_SPEECH: -30,
    FANTASY_CONTENT: -40,
    NON_CANON_FANTASY: -40,
    UNCLASSIFIED: -10,
  };
  const seen = new Set<string>();

  return [...events]
    .sort((a, b) => {
      const score = (event: T) =>
        (event.importance ?? 0) +
        (event.unresolved ? 20 : 0) +
        (event.persist === false ? -50 : 0) +
        (actualityScore[event.actuality ?? ''] ?? 0);
      return score(b) - score(a);
    })
    .filter(event => {
      const key = event.id || event.summary?.trim().toLowerCase();
      if (!key || seen.has(key)) return !key;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function mergeUniqueStrings(
  current: string[] = [],
  incoming: string[] = [],
  maxItems = 16,
) {
  const merged: string[] = [];

  for (const item of [...current, ...incoming]) {
    const normalized = item.trim();
    if (!normalized) continue;
    if (!merged.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      merged.push(normalized);
    }
  }

  return merged.slice(-maxItems);
}

/**
 * Remove explicitly revoked statements from a string collection. Matching is
 * case-insensitive on the full statement, so only exact revocations land.
 */
export function applyExplicitRevocations(
  current: string[] = [],
  revoked: string[] = [],
): string[] {
  if (!revoked || revoked.length === 0) return current;
  const revokeSet = new Set(revoked.map((item) => item.trim().toLowerCase()));
  return current.filter((item) => !revokeSet.has(item.trim().toLowerCase()));
}

export function applyIncrementalMemoryPatch(
  base: StructuredMemory | null | undefined,
  patch: IncrementalMemoryPatch,
): StructuredMemory {
  const foundation: StructuredMemory =
    base ?? {
      summary: 'Relationship continuity is beginning to form.',
      core_facts: [],
      relationship_milestones: [],
      major_events: [],
      emotional_turns: [],
      promises_and_commitments: [],
      relationship_state: 'Early interaction.',
      emotional_state: 'Developing.',
      user_preferences: {
        emotional: [],
        sexual: [],
      },
      shared_memories: [],
      hidden_fantasies: [],
      characters_and_npcs: [],
      people_registry: [],
      significant_incidents: [],
      decisions_and_commitments: [],
      relationship_rules: [],
      agreements: [],
      boundaries: [],
      must_not_forget: [],
      active_desires: [],
      fantasy_themes: [],
      sexual_history: undefined,
      prompt_domains: undefined,
      corruption_level: 0,
      open_emotional_threads: [],
      resolved_threads: [],
      recent_scene_recap: 'Recent interaction continued naturally.',
      metadata: {
        confidence: 0.55,
        extractedAt: new Date(),
      },
    };

  const patchedSummary = patch.summary?.trim();
  const patchedRelationshipState = patch.relationship_state?.trim();
  const patchedEmotionalState = patch.emotional_state?.trim();
  const patchedRecap = patch.recent_scene_recap?.trim();

  return {
    ...foundation,
    summary:
      patchedSummary && !isLowInformationStateValue(patchedSummary)
        ? patchedSummary
        : foundation.summary,
    core_facts: mergeUniqueStrings(foundation.core_facts, patch.core_facts, 16),
    major_events: mergeUniqueStrings(foundation.major_events, patch.major_events, 12),
    emotional_turns: mergeUniqueStrings(
      foundation.emotional_turns,
      patch.emotional_turns,
      12,
    ),
    promises_and_commitments: applyExplicitRevocations(
      mergeUniqueStrings(
        foundation.promises_and_commitments,
        patch.promises_and_commitments,
        12,
      ),
      patch.revoke_promises,
    ),
    people_registry: mergeUniqueStrings(
      foundation.people_registry,
      patch.people_registry,
      16,
    ),
    significant_incidents: mergeUniqueStrings(
      foundation.significant_incidents,
      patch.significant_incidents,
      12,
    ),
    decisions_and_commitments: mergeUniqueStrings(
      foundation.decisions_and_commitments,
      patch.decisions_and_commitments,
      12,
    ),
    relationship_rules: applyExplicitRevocations(
      mergeUniqueStrings(
        foundation.relationship_rules,
        patch.relationship_rules,
        20,
      ),
      patch.revoke_rules,
    ),
    agreements: applyExplicitRevocations(
      mergeUniqueStrings(foundation.agreements, patch.agreements, 20),
      patch.revoke_agreements,
    ),
    boundaries: applyExplicitRevocations(
      mergeUniqueStrings(foundation.boundaries, patch.boundaries, 20),
      patch.revoke_boundaries,
    ),
    must_not_forget: mergeUniqueStrings(
      foundation.must_not_forget,
      patch.must_not_forget,
      24,
    ),
    active_desires: mergeUniqueStrings(
      foundation.active_desires,
      patch.active_desires,
      10,
    ),
    fantasy_themes: mergeUniqueStrings(
      foundation.fantasy_themes,
      patch.fantasy_themes,
      10,
    ),
    sexual_history: patch.sexual_history
      ? {
          favorite_things: mergeUniqueStrings(
            foundation.sexual_history?.favorite_things,
            patch.sexual_history.favorite_things,
            8,
          ),
          acts: mergeUniqueStrings(
            foundation.sexual_history?.acts,
            patch.sexual_history.acts,
            12,
          ),
          aftercare_needs: mergeUniqueStrings(
            foundation.sexual_history?.aftercare_needs,
            patch.sexual_history.aftercare_needs,
            6,
          ),
          dirty_phrases_used: mergeUniqueStrings(
            foundation.sexual_history?.dirty_phrases_used,
            patch.sexual_history.dirty_phrases_used,
            8,
          ),
        }
      : foundation.sexual_history,
    open_emotional_threads: mergeUniqueStrings(
      foundation.open_emotional_threads,
      patch.open_emotional_threads,
      10,
    ),
    relationship_state:
      patchedRelationshipState && !isLowInformationStateValue(patchedRelationshipState)
        ? patchedRelationshipState
        : foundation.relationship_state,
    emotional_state:
      patchedEmotionalState && !isLowInformationStateValue(patchedEmotionalState)
        ? patchedEmotionalState
        : foundation.emotional_state,
    recent_scene_recap:
      patchedRecap && !isLowInformationStateValue(patchedRecap)
        ? patchedRecap
        : foundation.recent_scene_recap,
    metadata: {
      confidence: Math.max(foundation.metadata.confidence, 0.65),
      extractedAt: new Date(),
      lastRefreshTurnCount: foundation.metadata.lastRefreshTurnCount,
      lastRefreshSalience: foundation.metadata.lastRefreshSalience,
      lastRefreshDate: foundation.metadata.lastRefreshDate,
      canonVersion: hasNewCanonEntries(patch)
        ? (foundation.metadata.canonVersion ?? 0) + 1
        : (foundation.metadata.canonVersion ?? 0),
    },
  };
}

export function diffMemoryPatch(
  previous: StructuredMemory | null | undefined,
  next: StructuredMemory,
): string[] {
  const changes: string[] = [];
  if (!previous) return ['No previous memory to compare'];

  const tier1Fields: (keyof StructuredMemory)[] = [
    'core_facts', 'people_registry', 'promises_and_commitments',
    'decisions_and_commitments', 'relationship_rules', 'agreements',
    'boundaries', 'must_not_forget', 'major_events', 'emotional_turns',
    'significant_incidents', 'fantasy_themes', 'active_desires',
    'open_emotional_threads', 'resolved_threads',
  ];

  for (const field of tier1Fields) {
    const prev = previous[field] as string[] | undefined;
    const nextVal = next[field] as string[] | undefined;
    if (!prev || prev.length === 0) {
      if (nextVal && nextVal.length > 0) {
        changes.push(`+${field}: ${nextVal.length} new entries`);
      }
      continue;
    }
    const prevSet = new Set(prev.map(s => s.toLowerCase()));
    const added = (nextVal || []).filter(s => !prevSet.has(s.toLowerCase()));
    if (added.length > 0) {
      changes.push(`+${field}: ${added.length} new (${added.join('; ')})`);
    }
    const nextSet = new Set((nextVal || []).map(s => s.toLowerCase()));
    const dropped = prev.filter(s => !nextSet.has(s.toLowerCase()));
    if (dropped.length > 0) {
      changes.push(`-${field}: ${dropped.length} dropped (${dropped.join('; ')})`);
    }
  }

  // Volatile field changes
  const volatileChecks: [string, keyof StructuredMemory][] = [
    ['summary', 'summary'],
    ['relationship_state', 'relationship_state'],
    ['emotional_state', 'emotional_state'],
    ['recent_scene_recap', 'recent_scene_recap'],
  ];
  for (const [label, key] of volatileChecks) {
    const p = previous[key] as string | undefined;
    const n = next[key] as string | undefined;
    if (p !== n) {
      changes.push(`~${label}: "${(p || '').slice(0, 60)}" → "${(n || '').slice(0, 60)}"`);
    }
  }

  // Corruption
  if (previous.corruption_level !== next.corruption_level) {
    changes.push(`~corruption: ${previous.corruption_level} → ${next.corruption_level}`);
  }

  return changes;
}

// Check if the patch contains any new Tier 1 (canon) entries
function hasNewCanonEntries(patch: IncrementalMemoryPatch): boolean {
  const tier1Fields: (keyof IncrementalMemoryPatch)[] = [
    'core_facts', 'people_registry', 'promises_and_commitments',
    'decisions_and_commitments', 'relationship_rules', 'agreements',
    'boundaries', 'must_not_forget', 'major_events', 'emotional_turns',
    'significant_incidents', 'fantasy_themes', 'active_desires',
    'open_emotional_threads',
  ];
  for (const field of tier1Fields) {
    const val = patch[field];
    if (Array.isArray(val) && val.length > 0) return true;
  }
  if (patch.sexual_history) return true;
  return false;
}

function buildPrompt(
  convoLines: string,
  tier: 'short' | 'medium' | 'long',
): string {
  const sentenceGuide = {
    short: '1–2 sentences',
    medium: '2–3 sentences',
    long: '3–5 sentences',
  };

  const instructions = [
    'You are a conversation summarizer.',
    `Rewrite the dialogue so far into ${sentenceGuide[tier]} that preserve:`,
    '- Key people, names, relationships',
    '- Important facts (ages, places, events)',
    '- Emotional tone and ongoing concerns',
    '- Open threads or pending questions',
    'Keep it compact, fluent, and natural. No lists, no bullets, no JSON — just plain sentences.',
  ];

  return [
    ...instructions,
    '',
    'Conversation (oldest first, newest last):',
    convoLines,
  ].join('\n');
}

function clipConversationText(fullText: string) {
  const hardCap = 12000;

  if (fullText.length <= hardCap) {
    return fullText;
  }

  const head = fullText.slice(0, 4000);
  const tail = fullText.slice(-8000);

  return `${head}\n\n[... middle of earlier conversation omitted for length ...]\n\n${tail}`;
}

export class ModelSummarizer implements Summarizer {
  async summarizePlain(
    convo: { role: 'user' | 'assistant'; content: string }[],
    tier: 'short' | 'medium' | 'long',
  ): Promise<string> {
    const modelId = 'summarizer-model'; // from provider map
    const convoLines = clipConversationText(
      convo
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n'),
    );

    const prompt = buildPrompt(convoLines, tier);

    try {
      const res = await generateText({
        model: myProvider.languageModel(modelId),
        temperature: 0,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        prompt,
        experimental_activeTools: [], // Explicitly disable tools for summarizer
        tools: {}, // Ensure no tools are available
      });
      const text = (res?.text || '').trim();
      if (!text) throw new Error('Empty summarizer output');

      // One more guard: forbid lists/JSON
      if (
        text.includes('{') ||
        text.includes('}') ||
        text.includes('•') ||
        text.includes('- ')
      ) {
        // take first sentence chunk as ultra-safe fallback
        return `${text.split(/\.\s+/).slice(0, 3).join('. ')}.`;
      }
      return text;
    } catch (error) {
      // Log the model error for debugging
      logAIError(`summary:${modelId}`, error);

      // Try fallback models in order of preference (using logical names from provider map)
      const fallbackModels = [
        'chat-model',
        'chat-model-reasoning',
        'artifact-model',
      ];
      for (const fallbackModel of fallbackModels) {
        try {
          console.log(
            `[ModelSummarizer] Trying fallback model: ${fallbackModel}`,
          );
          const res = await generateText({
            model: myProvider.languageModel(fallbackModel),
            temperature: 0,
            maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
            prompt,
            experimental_activeTools: [], // Explicitly disable tools for all fallback models
            tools: {}, // Ensure no tools are available
          });
          const text = (res?.text || '').trim();
          if (text) {
            console.log(
              `[ModelSummarizer] Fallback model ${fallbackModel} succeeded`,
            );
            return text;
          }
        } catch (fallbackError) {
          logAIError(`summary-fallback:${fallbackModel}`, fallbackError);
          continue;
        }
      }

      // If all models fail, return a safe default summary
      console.error('[ModelSummarizer] All models failed, using safe default');
      return 'The conversation includes several important topics that the user mentioned.';
    }
  }

  async summarizeStructured(
    convo: { role: 'user' | 'assistant'; content: string }[],
    previousMemory?: StructuredMemory,
    options?: {
      characterName?: string;
    },
  ): Promise<StructuredMemory> {
    const modelId = 'summarizer-model'; // from provider map
    const fullConversation = clipConversationText(
      convo
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n'),
    );

    const structuredPrompt = buildStructuredPrompt(
      fullConversation,
      previousMemory,
      options,
    );

    try {
      const res = await generateText({
        model: myProvider.languageModel(modelId),
        temperature: 0,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        prompt: structuredPrompt,
        experimental_activeTools: [], // Explicitly disable tools for summarizer
        tools: {}, // Ensure no tools are available
      });

      const text = (res?.text || '').trim();
      if (!text) throw new Error('Empty structured summarizer output');

      return parseStructuredOutput(text);
    } catch (error) {
      logAIError('structured-summary', error);

      const simpleSummary = await this.summarizePlain(convo, 'short');

      return {
        summary: simpleSummary,
        core_facts: previousMemory?.core_facts || [],
        relationship_milestones: previousMemory?.relationship_milestones || [],
        major_events: previousMemory?.major_events || [],
        emotional_turns: previousMemory?.emotional_turns || [],
        promises_and_commitments:
          previousMemory?.promises_and_commitments || [],
        relationship_state: previousMemory?.relationship_state || 'Undefined.',
        emotional_state: previousMemory?.emotional_state || 'Neutral.',
        user_preferences: previousMemory?.user_preferences || {
          emotional: [],
          sexual: [],
        },
        shared_memories: previousMemory?.shared_memories || [],
        hidden_fantasies: previousMemory?.hidden_fantasies || [],
        characters_and_npcs: previousMemory?.characters_and_npcs || [],
        people_registry: previousMemory?.people_registry || [],
        significant_incidents: previousMemory?.significant_incidents || [],
        decisions_and_commitments:
          previousMemory?.decisions_and_commitments || [],
        relationship_rules: previousMemory?.relationship_rules || [],
        agreements: previousMemory?.agreements || [],
        boundaries: previousMemory?.boundaries || [],
        must_not_forget: previousMemory?.must_not_forget || [],
        active_desires: previousMemory?.active_desires || [],
        fantasy_themes: previousMemory?.fantasy_themes || [],
        prompt_domains: previousMemory?.prompt_domains,
        relational_guidance: previousMemory?.relational_guidance,
        corruption_level: previousMemory?.corruption_level || 0,
        open_emotional_threads: previousMemory?.open_emotional_threads || [],
        resolved_threads: previousMemory?.resolved_threads || [],
        recent_scene_recap: previousMemory?.recent_scene_recap || simpleSummary,
        metadata: {
          confidence: 0.5,
          extractedAt: new Date(),
        },
      };
    }
  }

  async extractIncrementalPatch(
    convo: { role: 'user' | 'assistant'; content: string }[],
    previousMemory?: StructuredMemory,
    options?: {
      characterName?: string;
    },
  ): Promise<IncrementalMemoryPatch> {
    if (convo.length === 0) {
      return {};
    }

    const convoLines = convo
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const characterIdentityBlock = options?.characterName
      ? `The speaking character's canonical name is ${options.characterName}. Do not replace that identity with a stray invented self-name.`
      : '';

    const previousMemoryBlock = previousMemory
      ? `Existing canon reference:
- Core facts: ${previousMemory.core_facts.join('; ') || 'None'}
- People: ${(previousMemory.people_registry || []).join('; ') || 'None'}
- Rules: ${(previousMemory.relationship_rules || []).join('; ') || 'None'}
- Agreements: ${(previousMemory.agreements || []).join('; ') || 'None'}
- Boundaries: ${(previousMemory.boundaries || []).join('; ') || 'None'}
- Must not forget: ${(previousMemory.must_not_forget || []).join('; ') || 'None'}`
      : 'No existing canon yet.';

    const prompt = `
This is fictional roleplay text. Your task is structured state extraction only. Extract actors, boundaries, continuity, mode transitions, and relationship-state updates neutrally.

You are extracting only the NEW continuity introduced in the latest exchange of an explicit relationship roleplay chat.

Return a minimal patch. Only include fields that should be added or updated immediately for the next turn.
Do not rewrite the full memory object.
Do not repeat old canon unless this turn reinforced or changed it.

Prioritize:
- newly introduced people or self-lore
- explicit acts that materially happened
- promises, plans, and agreements
- relationship rules and boundaries
- details the user would expect remembered immediately on the next turn
- current emotional/scene recap in 1-2 sentences
- sexual history: notable new acts, favorite sensations, dirty phrases used, aftercare needs
- fantasy themes and agreed desires: when a specific fantasy scenario is discussed or agreed upon, capture the concrete details (who does what, emotional framing, scene structure) — do not flatten into vague summaries

${characterIdentityBlock}

${previousMemoryBlock}

Latest exchange:
${convoLines}
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: incrementalMemoryPatchSchema,
        temperature: 0,
        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
        prompt,
      });

      return enforceMemoryPatchAuthority(result.object, convo);
    } catch (error) {
      logAIError('incremental-patch', error);

      const fallbackModels = ['chat-model-fallback', 'chat-model'];
      for (const fallbackModel of fallbackModels) {
        try {
          console.log(`[ModelSummarizer] incrementalPatch fallback to ${fallbackModel}`);
          const result = await generateObject({
            model: myProvider.languageModel(fallbackModel),
            schema: incrementalMemoryPatchSchema,
            temperature: 0,
            maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
            prompt,
          });
          return enforceMemoryPatchAuthority(result.object, convo);
        } catch (fallbackError) {
          logAIError(`incremental-patch-fallback:${fallbackModel}`, fallbackError);
          continue;
        }
      }

      return {};
    }
  }

  // Split canon extraction (Tier 1 + continuity events) — precision-focused
  private async extractCanonAndContinuity(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      previousMemory?: StructuredMemory;
      previousActiveState?: any;
      characterName?: string;
    },
  ): Promise<{ memoryPatch: IncrementalMemoryPatch; newEvents: any[] }> {
    const convoLines = convo
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const pm = context.previousMemory;
    const existingCanonBlock = pm ? `
EXISTING CANON (Reference — these facts already exist. Do NOT re-list them):
Core Facts: ${pm.core_facts.join('; ') || 'None'}
People Registry: ${(pm.people_registry || []).join('; ') || 'None'}
Promises & Commitments: ${pm.promises_and_commitments.join('; ') || 'None'}
Decisions & Commitments: ${(pm.decisions_and_commitments || []).join('; ') || 'None'}
Relationship Rules: ${(pm.relationship_rules || []).join('; ') || 'None'}
Standing Agreements: ${(pm.agreements || []).join('; ') || 'None'}
Boundaries: ${(pm.boundaries || []).join('; ') || 'None'}
Pinned Canon: ${(pm.must_not_forget || []).join('; ') || 'None'}
Major Events: ${pm.major_events.join('; ') || 'None'}
Milestones: ${pm.relationship_milestones.join('; ') || 'None'}
Significant Incidents: ${(pm.significant_incidents || []).join('; ') || 'None'}
Emotional Turns: ${pm.emotional_turns.join('; ') || 'None'}
Fantasy Themes: ${(pm.fantasy_themes || []).join('; ') || 'None'}
Active Desires: ${(pm.active_desires || []).join('; ') || 'None'}
Open Threads: ${pm.open_emotional_threads.join('; ') || 'None'}
Resolved Threads: ${pm.resolved_threads.join('; ') || 'None'}
Sexual History Favorites: ${(pm.sexual_history?.favorite_things || []).join('; ') || 'None'}
Sexual History Acts: ${(pm.sexual_history?.acts || []).join('; ') || 'None'}
` : '';

    const prompt = `
You are a story editor. Your job is to extract what CHANGED in this scene — not just what was loudest.

[CONTEXT]
Character Name: ${context.characterName ?? 'Unknown'}
Third Party Mode: ${context.previousActiveState?.third_party_mode ?? 'closed'}${context.previousActiveState?.third_party_mode && context.previousActiveState.third_party_mode !== 'closed' ? '\nNOTE: This mode records scoped user direction only. Do not infer blanket consent, secrecy permission, durable desire, relationship change, or that every narrated action falls inside the permitted scope.' : ''}

${existingCanonBlock}

[CONVERSATION]
${convoLines}

[TASK — EXTRACT WHAT CHANGED]

IMPORTANT FRAMING: All events, reframes, and dynamics extracted here represent the CHARACTER's perspective only. Never describe or imply the user's feelings, perceptions, or relationship state — the system cannot speak for the user. CHARACTER_REFRAME = how the character sees someone, not objective truth.

AUTHORITY RULES:
- An action is an event, not identity. If it conflicts with established
  character values, preserve both the action and the identity conflict.
- Never infer a relationship rule, agreement, permission, or missing boundary
  from compliance, arousal, silence, repetition, NPC speech, narrator
  instruction, or assistant-generated prose.
- Only explicit user/player agreement can create relationship_rules,
  agreements, or boundaries.
- User-directed scene performance and model-authored inner narration cannot
  create active_desires or fantasy_themes.
- Guilt, apology, time passage, self-improvement, or a calmer scene cannot
  resolve a rupture. Resolution requires explicit evidence from the user.
- Never turn the user's injury into the character's redemption, growth reward,
  reunion, peace, or access to the user.

For every scene, answer:
1. What literally happened? (keep this compact)
2. What was only imagined, threatened, fantasized, roleplayed, or performative?
3. Did the character's perception of another character change? (CHARACTER_REFRAME — always the character's view, not the user's)
4. Did the character's sense of power shift? (POWER_REFRAME — always how the character perceives power, not objective)
5. Did the relationship frame change?
6. Did the event create a new future behavioural rule?
7. Was an earlier event now reinterpreted or repaired?

--- TIER 1: CANON (append-only) ---
Only NEW entries not in the existing canon above:
- core_facts: new durable facts
- people_registry: new people/NPCs
- promises_and_commitments: new promises/plans
- decisions_and_commitments: new decisions
- relationship_rules: new rules
- agreements: new agreements
- boundaries: new boundaries
- must_not_forget: new pinned items
- major_events: new major events
- emotional_turns: new emotional turns
- significant_incidents: new incidents
- fantasy_themes: new fantasies (only if actually discussed/agreed)
- active_desires: new cravings
- open_emotional_threads: new open threads
- resolved_threads: new resolutions
- sexual_history: new acts or favorites

--- CONTINUITY EVENTS (newEvents) ---
Return no more than 6 candidate events. The application will retain the 3 most
important durable or unresolved events.
For each event, classify its actuality. Content type is NOT actuality: an event
that happens inside the roleplay world is canon even when explicit or fictional
in the real world.
- RP_CANON_EVENT: a narrated action that HAPPENED in the roleplay world
- ACTUAL_EVENT: (legacy) something that happened in the scene
- REAL_WORLD_FACT: true in the real world (user's stated real-life facts)
- OOC_INSTRUCTION: out-of-character user scene direction that establishes canon
- RP_CHARACTER_CLAIM: a character DESCRIBES something; not proof it happened
- RP_CHARACTER_LIE: a character claims something false in-world
- RP_HYPOTHETICAL: a "what if" inside the roleplay, not enacted
- NON_CANON_FANTASY: dream/fantasy/hypothetical that must not become canon
- SPOKEN_INTENTION: an intention/plan stated in-scene, not yet performed
- SPOKEN_THREAT: threatened or described, may not have happened
- PERFORMATIVE_SPEECH: said for effect, seduction, teasing, not objective truth
- INTERPRETATION: a character's temporary emotional reading in the moment
- RELATIONAL_TRUTH: a durable relationship meaning confirmed by later events
- CHARACTER_REFRAME / POWER_REFRAME: how a character sees another / power; these
  are PROVISIONAL interpretations, never objective facts
- TEMPORARY_SCENE_AFFECT: short-term state that should decay

Actuality rules:
- RP_CANON_EVENT, ACTUAL_EVENT, OOC_INSTRUCTION, REAL_WORLD_FACT persist as canon.
- RP_CHARACTER_CLAIM and RP_CHARACTER_LIE persist only as claims (truthStatus
  "claimed"), never as confirmed facts.
- NON_CANON_FANTASY, FANTASY_CONTENT, PERFORMATIVE_SPEECH, TEMPORARY_SCENE_AFFECT
  do NOT persist as canon.
- SPOKEN_THREAT, SPOKEN_INTENTION, RP_HYPOTHETICAL persist only if confirmed or
  still unresolved.
- CHARACTER_REFRAME and POWER_REFRAME persist only as low-priority
  interpretations; they must never replace the objective event record.
- RELATIONAL_TRUTH persists if confirmed.
- Never classify explicit or sexual content as fantasy merely because it is
  explicit. Base actuality on whether the act materially happened in the scene.

For CHARACTER_REFRAME events, include:
- character_reframed: who sees differently
- target_character: who is being re-understood
- before_perception: how they saw them before
- after_perception: how they see them now
- trigger_event: what caused the change
- emotional_effect: list of emotions
- future_behavior_guidance: how this changes future behaviour
- do_not_interpret_as: warn against common misinterpretations

For POWER_REFRAME events, include:
- power_holder: who holds power
- old_power_assumption: what was assumed before
- new_power_understanding: what's now understood
- type_of_power: emotional, physical, social, romantic, etc.
- future_behavior_guidance: how this changes behaviour
- do_not_interpret_as: warn against misinterpretations

IMPORTANT: Do NOT preserve intensity. Preserve meaning.
Rank by durable change to character understanding, relationship dynamics, future behaviour relevance, unresolved consequences, or contradiction of prior assumptions.
Do NOT rank by shock, explicitness, drama, violence, or emotional volume.

--- REVISION RULES ---
New evidence can supersede, resolve, or contradict existing state. Check existing canon above:
- If a new event resolves an earlier open thread, mark the earlier thread as resolved (add to resolved_threads).
- If a new event contradicts the existing summary or relationship state, the summary must be REVISED — not appended to. The latest evidence determines the current state, not the most dramatic moment.
- If the same factual event appears multiple times (e.g., "the character confessed to {USER} about an NPC"), output it ONCE with the latest significance. Do not create duplicate events for the same underlying action repeated across turns.
- Later character_reframe events that represent an updated understanding should replace earlier reframes of the same relationship, not be stored alongside them.
- relationship_state and emotional_state in the memory patch should reflect the CURRENT relationship dynamic, not the peak crisis point. If the conversation moved from confession → confrontation → repair → surrender, the state at the end of the window is what matters.
- Current mood never erases durable consequences. Keep unresolved repair,
  responsibility, and damaged trust open until the user explicitly resolves
  them. A time jump alone changes none of these.

If nothing changed, output empty arrays.
`.trim();

    const canonSchema = z.object({
      memoryPatch: incrementalMemoryPatchSchema,
      newEvents: z.array(continuityEventSchema),
    });

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: canonSchema,
        temperature: 0,
        maxOutputTokens: UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS,
        prompt,
      });
      return {
        ...result.object,
        memoryPatch: enforceMemoryPatchAuthority(
          result.object.memoryPatch,
          convo,
          context.previousActiveState?.third_party_mode ?? 'closed',
        ),
        newEvents: selectTopContinuityEvents(result.object.newEvents),
      };
    } catch (error) {
      logAIError('canon', error);
      const fallbackModels = ['summarizer-model-fallback', 'chat-model-fallback', 'chat-model'];
      for (const fb of fallbackModels) {
        try {
          const result = await generateObject({
            model: myProvider.languageModel(fb),
            schema: canonSchema,
            temperature: 0,
            maxOutputTokens: UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS,
            prompt,
          });
          return {
            ...result.object,
            memoryPatch: enforceMemoryPatchAuthority(
              result.object.memoryPatch,
              convo,
              context.previousActiveState?.third_party_mode ?? 'closed',
            ),
            newEvents: selectTopContinuityEvents(result.object.newEvents),
          };
        } catch { continue; }
      }
      return { memoryPatch: {}, newEvents: [] };
    }
  }

  // Split scene state extraction (volatile state + activeState + dynamics) — cheaper model
  private async extractSceneState(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      previousMemory?: StructuredMemory;
      previousActiveState?: any;
      previousDynamics?: any;
      characterName?: string;
    },
  ): Promise<{ summary: string; relationship_state: string; emotional_state: string; recent_scene_recap: string; activeState: any; dynamicsDeltas: any[] }> {
    const convoLines = convo
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const pm = context.previousMemory;
    const prompt = `
You are a story editor. Extract what CHANGED in this scene.

[CONTEXT]
Character Name: ${context.characterName ?? 'Unknown'}
Previous Active State: ${context.previousActiveState ? JSON.stringify(context.previousActiveState) : 'None'}
Previous Dynamics: ${context.previousDynamics ? JSON.stringify(context.previousDynamics) : 'None'}
Previous Summary: ${pm?.summary ?? 'None'}
Previous Emotional State: ${pm?.emotional_state ?? 'None'}

[CONVERSATION]
${convoLines}

[TASK]
IMPORTANT — REVISE, don't just append: The summary, relationship_state, and emotional_state must reflect the CURRENT state at the end of the conversation window — not the peak crisis point. If the conversation moved from crisis → repair → surrender, the current state is surrender, not crisis. The earlier crisis is context, not the headline.

1. Write summary (1-2 sentences): the CURRENT state of things — what is true NOW, not what was true at the most dramatic moment. Later evidence supersedes earlier crisis.
2. relationship_state: current dynamic right now (include any reframes or shifts). REVISE this from the previous state — don't anchor to an earlier crisis.
3. emotional_state: character's current feelings RIGHT NOW, not at the peak of conflict.
4. recent_scene_recap: what just happened (1-2 sentences, compact)
5. Refresh activeState: location, mood, activity, psychological state. Populate "actors". Keep domain_guard "allow". If location, participants, or activity changed from the previous state, REPLACE the old scene state — don't keep stale data.
6. Infer current_arc from the conversation. Choose the best fit:
   playful_flirtation, erotic_escalation, emotional_confession, secret_revealed,
   betrayal, rupture, danger_revealed, character_reframe, power_reframe,
   guilt_and_accountability, repair, trust_rebuilding,
   stable_bond_changed_by_past_event, unresolved_tension,
   ordinary_life_after_major_event
7. dynamicsDeltas: the character's feelings deltas by pair. These represent how the CHARACTER feels toward the other person — never the user's feelings. Only fields that changed.

Be precise. If nothing changed, empty defaults.
`.trim();

    const sceneStateSchema = z.object({
      summary: z.string(),
      relationship_state: z.string(),
      emotional_state: z.string(),
      recent_scene_recap: z.string(),
      activeState: activeStateSchema,
      dynamicsDeltas: z.array(relationshipDeltaSchema).max(5),
    });

    try {
      const result = await generateObject({
        model: myProvider.languageModel('active-state-model'),
        schema: sceneStateSchema,
        temperature: 0,
        maxOutputTokens: UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS,
        prompt,
      });
      return result.object;
    } catch (error) {
      logAIError('scene-state', error);
      try {
        const fallback = await generateObject({
          model: myProvider.languageModel('summarizer-model-fallback'),
          schema: sceneStateSchema,
          temperature: 0,
          maxOutputTokens: UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS,
          prompt,
        });
        return fallback.object;
      } catch (fallbackError) {
        logAIError('scene-state-fallback', fallbackError);
        return {
          summary: pm?.summary ?? '',
          relationship_state: pm?.relationship_state ?? '',
          emotional_state: pm?.emotional_state ?? '',
          recent_scene_recap: pm?.recent_scene_recap ?? '',
          activeState: context.previousActiveState,
          dynamicsDeltas: [],
        };
      }
    }
  }

  async extractUnifiedUpdate(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      previousMemory?: StructuredMemory;
      previousActiveState?: any;
      previousDynamics?: any;
      characterName?: string;
    },
  ): Promise<UnifiedRPUpdate> {
    const [canonResult, sceneResult] = await Promise.all([
      this.extractCanonAndContinuity(convo, {
        previousMemory: context.previousMemory,
        previousActiveState: context.previousActiveState,
        characterName: context.characterName,
      }),
      this.extractSceneState(convo, {
        previousMemory: context.previousMemory,
        previousActiveState: context.previousActiveState,
        previousDynamics: context.previousDynamics,
        characterName: context.characterName,
      }),
    ]);

    // Merge canon patch with volatile state
    const mergedMemoryPatch: IncrementalMemoryPatch = {
      ...canonResult.memoryPatch,
      summary: sceneResult.summary,
      relationship_state: sceneResult.relationship_state,
      emotional_state: sceneResult.emotional_state,
      recent_scene_recap: sceneResult.recent_scene_recap,
    };

    return {
      memoryPatch: mergedMemoryPatch,
      activeState: sceneResult.activeState,
      newEvents: canonResult.newEvents,
      dynamicsDeltas: sceneResult.dynamicsDeltas,
      reasoning: '',
    };
  }

  // New ontology-based extraction — outputs operations instead of prose events
  async extractOntologyUpdate(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      previousMemory?: StructuredMemory;
      previousActiveState?: any;
      previousDynamics?: any;
      characterName?: string;
      previousOntologyItems?: import('@/lib/ai/continuity').OntologyItem[];
      previousPersonModels?: import('@/lib/ai/continuity').PersonModel[];
      historicalEvidence?: string;
    },
  ): Promise<import('@/lib/ai/continuity').UnifiedContinuityUpdate> {
    if (convo.length === 0) {
      return { operations: [], event_families: [], scene_frame: null, relationship: {} };
    }

    const convoLines = convo
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const pm = context.previousMemory;
    const targetAliases = new Map<string, string>();
    const existingItems = (context.previousOntologyItems ?? [])
      .filter(item => item.status === 'active' || item.status === 'provisional')
      .slice(-30)
      .map((item, index) => {
        const alias = `c${index + 1}`;
        if (item.id) targetAliases.set(alias, item.id);
        return `${alias} | ${item.type} | ${item.scope} | ${item.status} | ${item.statement}`;
      })
      .join('\n');
    const existingPeople = (context.previousPersonModels ?? [])
      .map(person => `${person.name} (${person.role}): ${person.known_behaviours.slice(-5).join('; ')} | trajectory=${person.trajectory}`)
      .join('\n');
    const previousStateBlock = pm ? `
Previous Summary: ${pm.summary}
Previous Relationship State: ${pm.relationship_state}
Previous Emotional State: ${pm.emotional_state}
Previous Open Threads: ${pm.open_emotional_threads.join('; ') || 'None'}
Previous Resolved Threads: ${pm.resolved_threads.join('; ') || 'None'}` : 'No previous state.';

    const prompt = `
You are a story editor. Your job is to determine what CHANGED in this scene and output structured state mutations.

[CONTEXT]
Character Name: ${context.characterName ?? 'Unknown'}
Third Party Mode: ${context.previousActiveState?.third_party_mode ?? 'closed'}

${previousStateBlock}

[EXISTING CONTINUITY ITEMS — USE ONLY THE c1/c2 ALIASES AS target_id]
${existingItems || 'None'}

[EXISTING PEOPLE — UPDATE; DO NOT RECREATE OR FORGET]
${existingPeople || 'None'}

${context.historicalEvidence ? `[TARGETED HISTORICAL EVIDENCE — durable canon about entities mentioned in this window. Ground references here; do NOT invent or contradict this history]
${context.historicalEvidence}` : ''}

[CONVERSATION]
${convoLines}

[TASK — OUTPUT STRUCTURED STATE MUTATIONS]

Before outputting operations, run through the EVENT CLASS CHECKLIST below.
For each class, check whether anything in the conversation window matches.
Answer YES or NO for each class. If YES, output the relevant operations.

=== EVENT CLASS CHECKLIST ===

1. PHYSICAL EVENTS (kiss, sex, touching, blowjob, penetration, orgasm)
2. DISCOVERY EVENTS (someone witnessed something, learned a truth, found evidence)
3. SEPARATION EVENTS (someone left, was left behind, walked away, drove away)
4. DECISION EVENTS (chose to stop, chose not to stop, chose to stay, chose to leave, chose to act, froze/paralysis, complied without choosing)
5. BOUNDARY EVENTS (crossed a line, violated an agreement, broke a promise, ignored a boundary)
6. COMMITMENT EVENTS (engagement status change, promise made or broken, future plans altered)
7. RELATIONAL EVENTS (expressed love, expressed rejection, apologized, blamed, accused, forgave)
8. CORRECTION EVENTS (user rejected the model's trajectory, corrected a misunderstanding, redirected the scene)
9. SCENE CHANGE EVENTS (location changed, participants changed, activity changed, scene context fundamentally shifted). When the scene changes, output a new SCENE FRAME and SUPERSEDE the old one entirely — do not keep stale scene state.
10. EVALUATION EVENTS (the character judged someone — lost respect, felt disappointed, saw someone differently, found someone less attractive, trusted less). These are not facts about the other person. They are the character's assessment. Output as type "interpretation" with scope "arc".
10. PERSON MODEL UPDATES — when you detect EVALUATION EVENTS or observe the character learning about someone's character, also output an UPDATE_PERSON operation with:
    - name: the person's name
    - aliases: other names, titles, or relationship labels used for the same person
    - role: their relationship to the companion
    - behaviour: the specific behaviour observed (e.g. "pushed boundaries after being told no", "manipulated guilt")
    - evaluation_delta: how this changes the companion's evaluation of them (respect, trust, safety, attraction — each -50 to +50)
    - trajectory: overall direction (e.g. "respect decreasing", "trust building")
    - current_status: their current involvement in the story
    - linked_event_ids: existing continuity item aliases connected to this person
    Put source excerpts or message references in operation.evidence.
    These accumulate across turns so the model remembers what Isa has learned about each person.

For each YES answer, output an ADD operation with:
- type: "fact"
- perspective: "objective"
- scope: based on significance, BUT consequential events (betrayal, disclosure,
  departure, separation, agreement, agreement violation, engagement/marriage,
  death, pregnancy, injury, identity revelation, irreversible act, first-time
  event, new recurring NPC) must be "durable" or "relationship" — never "scene".
  "scene" is reserved for ephemeral local detail (what's on the table, where
  the cup is). A scene change must never expire a consequential event.
- significance: "high" (relationship-altering), "medium" (arc-level), "low" (scene detail)
- weight: classify how this event affects future interaction:
  - "ordinary" — minor, doesn't change the relationship
  - "important" — changes something, repair possible within scene
  - "identity-changing" — may alter how the character sees herself or the other person
  - "irreversible" — cannot be undone, relationship permanently changed

Not every event needs a weight. Only events with durable consequences.

FACT WRITING RULES:
- Write atomic, literal facts, not recap prose.
- Include the named participants, who did what to whom, and the outcome.
- Preserve an objective record before interpretation: who acted, who was
  affected, who witnessed it, and what outcome was established. Never soften
  that record into justification or character-development prose.
- Keep each actor's meaning, responsibility, and lasting consequences
  separately attributable. They complement the event; they never replace it.
- Preserve concrete sexual acts when they materially occurred; do not replace
  them with euphemisms such as "crossed a line", "became intimate", or
  "shared a charged moment".
- Put meaning in a separate interpretation item. Never substitute meaning for
  the underlying event.
- One statement should remain understandable months later without the scene
  transcript.

PROVENANCE RULES (critical):
- A fact that is SUPPORTED BY EXISTING CANON (see the existing items above) is
  "EXISTING_CANON" — reference it, do not recreate it.
- A fact NARRATED BY THE USER in the window is "USER_NARRATION". It is canon.
- A NEW event that happens in the present scene is canon regardless of who
  narrates it (set source_type to "ASSISTANT_NARRATION" only when the assistant
  alone narrates it and it is NOT a historical backstory).
- A HISTORICAL claim introduced ONLY BY THE ASSISTANT (e.g. a past event the
  assistant invents to explain a reference to an unknown person) is UNSUPPORTED.
  Mark it source_type "ASSISTANT_NARRATION" and status "provisional" — or omit
  it entirely. Never emit it as a durable confirmed fact.
- Never treat assistant prose as historical evidence for past events unless the
  event already exists in the EXISTING CONTINUITY ITEMS or the user confirms it.
- When the character or the user references a known person (see EXISTING PEOPLE),
  ground the fact in the existing person model. Do not invent or contradict
  their established identity, role, or history.

CONSTITUTION ITEMS (agreements / rules / boundaries / commitments):
- When the user and character explicitly establish, change, or revoke an
  agreement, rule, boundary, or commitment, output it as its own item:
    - type: "agreement" | "rule" | "boundary" | "commitment"
    - scope: "durable"
    - statement: one operational sentence ("The companion may explore with
      others.", "Full honesty is required.", "The partner must not dictate the
      companion's choices.")
  These persist until an explicit REVOKE or SUPERSEDE.
- To revoke an established one, output operation REVOKE with target_id set to
  its alias (c1..cN) and resolution describing what replaced it.
- Do NOT re-list existing constitution items unless they were changed this turn.

Also output what is UNCERTAIN about the character's motivation. If the character's reasons for acting are unclear from the conversation, state that explicitly rather than inferring motives.

Example:

Operation: ADD
Item: {
  type: "fact",
  statement: "{USER} witnessed the character with the NPC and immediately left",
  perspective: "objective",
  scope: "durable",
  significance: "high",
  confidence: 1.0,
  evidence: ["{USER} entered the location", "{USER} saw the character and NPC together", "{USER} drove away"]
}

=== TRANSFORMATIONS ===

After event extraction, identify any TRANSFORMATIONS — changes in how the character understands herself, the other person, or the relationship. These are not facts. They are meaning-shifts.

Examples:
- Realized she is capable of betrayal
- Discovered that the other person will stay despite the truth
- Recognized a pattern she hadn't seen before
- Understood the gap between her self-image and her actions
- Felt the weight of a choice for the first time

Output these as type "interpretation" with perspective "character" and scope "arc" (provisional — can change). Write them as operational state ("Isa initially interpreted Kai's request as pressure."), NOT as literary prose ("Isa transforms her abstract shame into a concrete confession."). Never store recap prose as canon.

=== FAILED STRATEGIES ===

If the user explicitly rejected a response approach (verbal apology, self-explanation, asking for instructions, declarations without action), output an ADD with type "failed_strategy" and perspective "objective".

Reminder of available operations:
- ADD: create a new item
- UPDATE: change a numeric value (relationship dimension, trust component)
- SUPERSEDE: mark an old interpretation as replaced by a new one
- RESOLVE: close an open loop that is now resolved
- REVOKE: explicitly remove an established agreement, rule, boundary, or commitment (with target_id or exact statement + resolution)
- EXPIRE: mark a scene-local state as no longer active

ITEM TYPES:
- fact: something objectively true that happened
- agreement: an explicit standing agreement between the characters
- rule: an explicit relationship rule
- boundary: an explicit permission, limit, or condition
- commitment: an explicit promise or commitment
- interpretation: what the character believes an event means (provisional)
- emotional_state: how she feels right now (volatile, can decay)
- relationship_dimension: a relational quality
- open_loop: a genuinely unresolved question, unmet goal, pending decision
- trajectory: a meaningful change over time (before → trigger → now)
- failed_strategy: a response approach the user explicitly rejected

OPEN LOOPS: only include if there IS an unanswered question, unmet goal, deferred consequence, unresolved promise, pending decision, or live disagreement.

EVENT FAMILIES: if the same underlying event appears across multiple turns, group into one event family with developments.

RELATIONSHIP DIMENSIONS: output any changed dimensions under "relationship". Split into:
- durable_bond: attachment, affection, commitment_orientation, relational_centrality
- volatile_state: felt_safety, hurt, jealousy, reassurance_need, openness
- trust_components: honesty_trust, reliability_trust, emotional_safety, romantic_security, surrender_trust

SCENE FRAME: if location, activity, or participants changed, output the new frame. If the scene has materially changed from the previous extraction, REPLACE all old scene state — do not keep stale scene data active. A stale scene frame will cause the character to behave as if they're in the wrong context. Scene frames are scene-scope: a new frame supersedes the old frame but must never touch durable facts, agreements, or person models.

IMPORTANT: Supersede old interpretations when new evidence contradicts them. Do not keep contradictory states active.
`.trim();

    const ontologySchema = z.object({
      operations: z.array(z.object({
        operation: z.enum(['ADD', 'UPDATE', 'SUPERSEDE', 'RESOLVE', 'EXPIRE', 'REVOKE', 'UPDATE_PERSON']),
        target_id: z.string().regex(/^c[1-9][0-9]?$/).optional(),
        item: z.object({
          type: z.enum(['fact', 'agreement', 'rule', 'boundary', 'commitment', 'interpretation', 'emotional_state', 'relationship_dimension', 'open_loop', 'scene_frame', 'trajectory', 'failed_strategy']),
          statement: z.string(),
          scope: z.enum(['scene', 'arc', 'relationship', 'durable']),
          perspective: z.enum(['objective', 'character']),
          status: z.enum(['active', 'superseded', 'resolved', 'provisional']).default('active'),
          confidence: z.number().min(0).max(1).default(0.8),
          evidence: z.array(z.string()).default([]),
          event_family: z.string().optional(),
          significance: z.enum(['high', 'medium', 'low']).optional(),
          weight: z.enum(['ordinary', 'important', 'identity-changing', 'irreversible']).optional(),
          created_turn: z.number().int().min(0).optional().default(0),
          last_updated_turn: z.number().int().min(0).optional().default(0),
          source_type: z.enum(['USER_NARRATION', 'USER_DIALOGUE', 'ASSISTANT_NARRATION', 'ASSISTANT_DIALOGUE', 'OOC_INSTRUCTION', 'EXISTING_CANON', 'INFERRED', 'USER_CONFIRMED']).optional(),
          occurred_in_scene: z.string().optional(),
          persistence_scope: z.enum(['scene', 'arc', 'relationship', 'durable']).optional(),
        }).optional(),
        resolution: z.string().optional(),
        fields: z.record(z.object({
          value: z.number().min(0).max(100),
          trend: z.enum(['improving', 'stable', 'declining']).optional(),
        })).optional(),
        evidence: z.array(z.string()).optional(),
        source_type: z.enum(['USER_NARRATION', 'USER_DIALOGUE', 'ASSISTANT_NARRATION', 'ASSISTANT_DIALOGUE', 'OOC_INSTRUCTION', 'EXISTING_CANON', 'INFERRED', 'USER_CONFIRMED']).optional(),
        person_model: z.object({
          name: z.string(),
          aliases: z.array(z.string()).max(8).optional(),
          role: z.string(),
          behaviour: z.string(),
          evaluation_delta: z.object({
            respect: z.number().min(-50).max(50).optional(),
            trust: z.number().min(-50).max(50).optional(),
            safety: z.number().min(-50).max(50).optional(),
            attraction: z.number().min(-50).max(50).optional(),
          }).optional(),
          trajectory: z.string().optional(),
          current_status: z.string().optional(),
          linked_event_ids: z.array(z.string()).max(12).optional(),
        }).optional(),
      })).max(10),
      event_families: z.array(z.object({
        family: z.string(),
        root_fact: z.string(),
        developments: z.array(z.object({
          turn: z.number(),
          detail: z.string(),
        })).max(10),
        current_status: z.string(),
      })).max(3),
      scene_frame: z.object({
        location: z.string(),
        activity: z.string(),
        participants: z.array(z.string()),
      }).nullable().optional(),
      relationship: z.object({
        durable_bond: z.object({
          attachment: z.number().min(0).max(100).optional(),
          affection: z.number().min(0).max(100).optional(),
          commitment_orientation: z.number().min(0).max(100).optional(),
          relational_centrality: z.number().min(0).max(100).optional(),
        }).optional(),
        volatile_state: z.object({
          felt_safety: z.number().min(0).max(100).optional(),
          hurt: z.number().min(0).max(100).optional(),
          jealousy: z.number().min(0).max(100).optional(),
          reassurance_need: z.number().min(0).max(100).optional(),
          openness: z.number().min(0).max(100).optional(),
        }).optional(),
        trust_components: z.object({
          honesty_trust: z.number().min(0).max(100).optional(),
          reliability_trust: z.number().min(0).max(100).optional(),
          emotional_safety: z.number().min(0).max(100).optional(),
          romantic_security: z.number().min(0).max(100).optional(),
          surrender_trust: z.number().min(0).max(100).optional(),
        }).optional(),
      }).optional(),
    });

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: ontologySchema,
        temperature: 0,
        maxOutputTokens: Number(process.env.UNIFIED_EXTRACTOR_MAX_OUTPUT_TOKENS ?? 4000),
        prompt,
      });
      return {
        operations: decorateOntologyOperations(result.object.operations || [], targetAliases),
        event_families: result.object.event_families || [],
        scene_frame: result.object.scene_frame || null,
        relationship: result.object.relationship || {},
      };
    } catch (error) {
      logAIError('ontology', error);
      try {
        const result = await generateObject({
          model: myProvider.languageModel('summarizer-model-fallback'),
          schema: ontologySchema,
          temperature: 0,
          maxOutputTokens: 3000,
          prompt,
        });
        return {
          operations: decorateOntologyOperations(result.object.operations || [], targetAliases),
          event_families: result.object.event_families || [],
          scene_frame: result.object.scene_frame || null,
          relationship: result.object.relationship || {},
        };
      } catch {
        return { operations: [], event_families: [], scene_frame: null, relationship: {} };
      }
    }
  }

  // Lightweight high-reliability extraction for canonical events only
  // Runs alongside full ontology extraction — if full extraction fails,
  // these critical events (physical acts, discoveries, scene changes) are still captured.
  async extractCanonicalEvents(
    convo: { role: 'user' | 'assistant'; content: string }[],
    context: {
      characterName?: string;
    },
  ): Promise<{ events: { type: string; statement: string }[] }> {
    if (convo.length === 0) {
      return { events: [] };
    }

    const convoLines = convo
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const prompt = `
Did any of these things happen in this conversation window? Answer YES or NO for each.

1. A PHYSICAL SEXUAL ACT (kiss, oral sex, intercourse, penetration, orgasm)
2. A DISCOVERY (someone witnessed a sexual act, found evidence, learned a hidden truth)
3. A SEPARATION (someone left, was left behind, walked away mid-conversation)
4. A SCENE CHANGE (location shifted, participants changed, activity fundamentally changed)

For each YES, output:
- type: one of "physical_act", "discovery", "separation", "scene_change"
- statement: one clear sentence describing what happened (who, what, where)

Be precise. Only output YES for things that demonstrably happened. Do not infer.

Conversation:
${convoLines}
`.trim();

    const canonicalSchema = z.object({
      events: z.array(z.object({
        type: z.enum(['physical_act', 'discovery', 'separation', 'scene_change']),
        statement: z.string(),
      })).max(6),
    });

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: canonicalSchema,
        temperature: 0,
        maxOutputTokens: 500,
        prompt,
      });
      return { events: result.object.events || [] };
    } catch {
      try {
        const result = await generateObject({
          model: myProvider.languageModel('chat-model'),
          schema: canonicalSchema,
          temperature: 0,
          maxOutputTokens: 500,
          prompt,
        });
        return { events: result.object.events || [] };
      } catch {
        return { events: [] };
      }
    }
  }
}

function decorateOntologyOperations(
  operations: ExtractorOperation[],
  targetAliases: Map<string, string>,
): ExtractorOperation[] {
  return operations.map(operation => {
    const sourceType = operation.source_type;
    const sourceRole: 'user' | 'assistant' | 'system' | 'extractor' | undefined =
      sourceType === 'USER_NARRATION' || sourceType === 'USER_DIALOGUE' || sourceType === 'USER_CONFIRMED' || sourceType === 'OOC_INSTRUCTION'
        ? 'user'
        : sourceType === 'ASSISTANT_NARRATION' || sourceType === 'ASSISTANT_DIALOGUE'
          ? 'assistant'
          : sourceType === 'EXISTING_CANON'
            ? 'system'
            : undefined;
    return {
      ...operation,
      target_id: operation.target_id
        ? targetAliases.get(operation.target_id)
        : undefined,
      source_role: sourceRole,
      source_type: sourceType,
      item: operation.item
        ? {
            ...operation.item,
            source_role: operation.item.source_role ?? sourceRole,
            source_type: operation.item.source_type ?? sourceType,
            occurred_in_scene: operation.item.occurred_in_scene,
            persistence_scope: operation.item.persistence_scope,
          }
        : undefined,
      person_model: operation.person_model
        ? {
            ...operation.person_model,
            linked_event_ids: operation.person_model.linked_event_ids
              ?.map(id => targetAliases.get(id) ?? id),
          }
        : undefined,
    };
  });
}

// Helper functions for structured memory extraction
function buildStructuredPrompt(
  fullConversation: string,
  previousMemory?: StructuredMemory,
  options?: {
    characterName?: string;
  },
): string {
  const characterIdentityBlock = options?.characterName
    ? `
FIXED CHARACTER IDENTITY:
The speaking character's canonical name is ${options.characterName}.
Do not overwrite or replace the character's identity with a newly invented self-name unless the user explicitly instructs a rename or identity change.
If the character says an inconsistent name once, treat that as drift/noise unless it is clearly intentional and reinforced.
`
    : '';

  const previousStateBlock = previousMemory
    ? `
PREVIOUS RELATIONSHIP STATE (REFERENCE ONLY):
Summary: ${previousMemory.summary}
Core Facts: ${previousMemory.core_facts.join(', ')}
Milestones: ${previousMemory.relationship_milestones.join(', ')}
Major Events: ${previousMemory.major_events.join(', ')}
Emotional Turns: ${previousMemory.emotional_turns.join(', ')}
Promises: ${previousMemory.promises_and_commitments.join(', ')}
Relationship State: ${previousMemory.relationship_state}
Emotional State: ${previousMemory.emotional_state}
Characters: ${previousMemory.characters_and_npcs.join(', ')}
People Registry: ${(previousMemory.people_registry || []).join(', ')}
Decisions: ${(previousMemory.decisions_and_commitments || []).join(', ')}
Relationship Rules: ${(previousMemory.relationship_rules || []).join(', ')}
Agreements: ${(previousMemory.agreements || []).join(', ')}
Boundaries: ${(previousMemory.boundaries || []).join(', ')}
Must Not Forget: ${(previousMemory.must_not_forget || []).join(', ')}
Active Desires: ${(previousMemory.active_desires || []).join(', ')}
Fantasy Themes: ${(previousMemory.fantasy_themes || []).join(', ')}
Open Threads: ${previousMemory.open_emotional_threads.join(', ')}
Corruption Level: ${previousMemory.corruption_level}/10

INSTRUCTIONS FOR INCREMENTAL UPDATE:
Combine the previous state with new information from the recent conversation. 
Do not lose old milestones, characters, facts, commitments, or major events unless they are explicitly contradicted.
`
    : '';

  const instructions = {
    title: 'Extract Structured RP Memory from Conversation',
    summary: 'Provide a concise 1-2 sentence summary of the current RP state.',
    coreFacts:
      'Extract durable canon facts that must not be forgotten: names, relationships, places, jobs, family members, important status changes, and established truths.',
    milestones:
      'Extract key turning points or major events in the relationship, whether initiated by the user or the character.',
    majorEvents:
      'Extract major scene events or plot-changing incidents that should stay in memory even if they happened only once. Explicit sexual acts, penetrative acts, orgasms, oral acts, restraint, exposure, aftercare, cleanup, and intense physical actions count as major events when they materially happen.',
    emotionalTurns:
      'Extract emotionally important turns: confessions, reassurance, arguments, jealousy, firsts, betrayals, breakthroughs, aftercare, or moments that changed how they feel.',
    commitments:
      'Extract promises, plans, invitations, future intentions, agreements, or things they said they would do. If they discuss what happens later, tomorrow, next, or after this scene, capture it.',
    relationshipState:
      'Describe the current relationship dynamic in one short paragraph: closeness, trust, tension, attachment, conflict, intimacy, and what is hanging in the air.',
    emotionalState:
      'Describe the character\'s current emotional state and feelings toward the user.',
    preferences:
      'Identify user preferences (both emotional and sexual/intimate).',
    memories: 'List specific shared memories, inside jokes, or past dates.',
    fantasies: 'Note any hidden fantasies or naughty thoughts discussed.',
    npcs: 'List all people mentioned (friends, family, rivals, exes, colleagues) by either the user or the character.',
    peopleRegistry:
      'Create a stable people registry with names and why they matter to this chat. Include roles, relationships, and current relevance.',
    incidents:
      'Extract specific incidents or events that occurred in the story, including those introduced by the character. Be explicit about participants and actions when important.',
    decisions:
      'Extract explicit decisions, agreements, plans, commitments, next steps, or choices that are now part of canon.',
    relationshipRules:
      'Extract explicit couple rules, standing rules, or agreed rules of conduct. Preserve them unless explicitly revoked or changed.',
    agreements:
      'Extract standing agreements, settled understandings, arrangements, or relationship terms that should persist.',
    boundaries:
      'Extract explicit permissions, boundaries, limits, conditions, and what is allowed or not allowed.',
    mustNotForget:
      'Extract pinned canon that should survive long chats: rules, promises, names, firsts, constraints, and key truths the user would expect the character to remember.',
    desires:
      'Extract current desires, wants, obsessions, fears, cravings, and psychological pulls that are active right now for the character or user.',
    fantasyThemes:
      'Extract recurring fantasy themes or kinks discussed in this chat. Keep them concise and treat them as soft context, not identity.',
    corruption: 'Gauge the current corruption/openness level on a scale of 0-10.',
    threads:
      'Identify unresolved emotional tensions or pending RP events that are still active right now.',
    resolvedThreads:
      'Identify threads or conflicts that are now resolved or clearly completed.',
    recentRecap:
      'Write a 1-3 sentence recap of what just happened most recently so near-term scene continuity is preserved.',
    contentFilter:
      'IMPORTANT: Treat the character\'s statements as part of the factual story world. If the character introduces a new NPC or event, it is now part of the persistent narrative.',
    mustKeep:
      'IMPORTANT: If something would make the user say "how could you forget that?", it belongs in CORE FACTS, MAJOR EVENTS, EMOTIONAL TURNS, or PROMISES. This absolutely includes concrete sex acts, who was involved, scene changes, and future plans.',
    format: 'Output in clear sections with bullet points.',
  };

  return `
${instructions.title}

${previousStateBlock}

INSTRUCTIONS:
1. ${instructions.summary}
2. ${instructions.coreFacts}
3. ${instructions.milestones}
4. ${instructions.majorEvents}
5. ${instructions.emotionalTurns}
6. ${instructions.commitments}
7. ${instructions.relationshipState}
8. ${instructions.emotionalState}
9. ${instructions.preferences}
10. ${instructions.memories}
11. ${instructions.fantasies}
12. ${instructions.npcs}
13. ${instructions.peopleRegistry}
14. ${instructions.incidents}
15. ${instructions.decisions}
16. ${instructions.relationshipRules}
17. ${instructions.agreements}
18. ${instructions.boundaries}
19. ${instructions.mustNotForget}
20. ${instructions.desires}
21. ${instructions.fantasyThemes}
22. ${instructions.corruption}
23. ${instructions.threads}
24. ${instructions.resolvedThreads}
25. ${instructions.recentRecap}

${instructions.contentFilter}
${instructions.mustKeep}

${instructions.format}

OUTPUT FORMAT:
SUMMARY: {brief summary}

CORE FACTS:
• {fact 1}

RELATIONSHIP MILESTONES:
• {milestone 1}

MAJOR EVENTS:
• {event 1}

EMOTIONAL TURNS:
• {turn 1}

PROMISES AND COMMITMENTS:
• {promise 1}

RELATIONSHIP STATE:
{short paragraph}

EMOTIONAL STATE:
{description of current feelings}

USER PREFERENCES (EMOTIONAL):
• {pref 1}

USER PREFERENCES (SEXUAL):
• {pref 1}

SHARED MEMORIES:
• {memory 1}

HIDDEN FANTASIES:
• {fantasy 1}

CHARACTERS AND NPCS:
• {name/relationship 1}

PEOPLE REGISTRY:
• {person + role + relevance}

SIGNIFICANT INCIDENTS:
• {incident/event 1}

DECISIONS AND COMMITMENTS:
• {decision/plan/agreement 1}

RELATIONSHIP RULES:
• {explicit agreed rule 1}

AGREEMENTS:
• {standing agreement 1}

BOUNDARIES:
• {boundary/permission/limit 1}

MUST NOT FORGET:
• {pinned canon item 1}

ACTIVE DESIRES:
• {active desire/tension/urge 1}

FANTASY THEMES:
• {soft recurring theme 1}

CORRUPTION LEVEL:
{number 0-10}

OPEN EMOTIONAL THREADS:
• {thread 1}

RESOLVED THREADS:
• {resolved 1}

RECENT SCENE RECAP:
{1-3 sentence recap}

Conversation:
${fullConversation}
${characterIdentityBlock}
  `.trim();
}

function parseStructuredOutput(text: string): StructuredMemory {
  const lines = text.split('\n').map((line) => line.trim());

  let summary = '';
  let relationship_state = '';
  let emotional_state = '';
  let recent_scene_recap = '';
  let corruption_level = 0;
  const core_facts: string[] = [];
  const relationship_milestones: string[] = [];
  const major_events: string[] = [];
  const emotional_turns: string[] = [];
  const promises_and_commitments: string[] = [];
  const emotional_prefs: string[] = [];
  const sexual_prefs: string[] = [];
  const shared_memories: string[] = [];
  const hidden_fantasies: string[] = [];
  const characters_and_npcs: string[] = [];
  const people_registry: string[] = [];
  const significant_incidents: string[] = [];
  const decisions_and_commitments: string[] = [];
  const relationship_rules: string[] = [];
  const agreements: string[] = [];
  const boundaries: string[] = [];
  const must_not_forget: string[] = [];
  const active_desires: string[] = [];
  const fantasy_themes: string[] = [];
  const open_emotional_threads: string[] = [];
  const resolved_threads: string[] = [];

  let currentSection:
    | 'summary'
    | 'core_facts'
    | 'milestones'
    | 'major_events'
    | 'emotional_turns'
    | 'commitments'
    | 'relationship_state'
    | 'emotional'
    | 'pref_emotional'
    | 'pref_sexual'
    | 'memories'
    | 'fantasies'
    | 'npcs'
    | 'people_registry'
    | 'incidents'
    | 'decisions'
    | 'relationship_rules'
    | 'agreements'
    | 'boundaries'
    | 'must_not_forget'
    | 'active_desires'
    | 'fantasy_themes'
    | 'corruption'
    | 'threads'
    | 'resolved_threads'
    | 'recent_recap'
    | null = null;

  for (const line of lines) {
    if (!line) continue;

    const upperLine = line.toUpperCase();

    if (upperLine.startsWith('SUMMARY:')) {
      summary = line.substring(8).trim();
      currentSection = 'summary';
    } else if (upperLine.startsWith('CORE FACTS:')) {
      currentSection = 'core_facts';
    } else if (upperLine.startsWith('RELATIONSHIP MILESTONES:')) {
      currentSection = 'milestones';
    } else if (upperLine.startsWith('MAJOR EVENTS:')) {
      currentSection = 'major_events';
    } else if (upperLine.startsWith('EMOTIONAL TURNS:')) {
      currentSection = 'emotional_turns';
    } else if (upperLine.startsWith('PROMISES AND COMMITMENTS:')) {
      currentSection = 'commitments';
    } else if (upperLine.startsWith('RELATIONSHIP STATE:')) {
      currentSection = 'relationship_state';
    } else if (upperLine.startsWith('EMOTIONAL STATE:')) {
      currentSection = 'emotional';
    } else if (upperLine.startsWith('USER PREFERENCES (EMOTIONAL):')) {
      currentSection = 'pref_emotional';
    } else if (upperLine.startsWith('USER PREFERENCES (SEXUAL):')) {
      currentSection = 'pref_sexual';
    } else if (upperLine.startsWith('SHARED MEMORIES:')) {
      currentSection = 'memories';
    } else if (upperLine.startsWith('HIDDEN FANTASIES:')) {
      currentSection = 'fantasies';
    } else if (upperLine.startsWith('CHARACTERS AND NPCS:')) {
      currentSection = 'npcs';
    } else if (upperLine.startsWith('PEOPLE REGISTRY:')) {
      currentSection = 'people_registry';
    } else if (upperLine.startsWith('SIGNIFICANT INCIDENTS:')) {
      currentSection = 'incidents';
    } else if (upperLine.startsWith('DECISIONS AND COMMITMENTS:')) {
      currentSection = 'decisions';
    } else if (upperLine.startsWith('RELATIONSHIP RULES:')) {
      currentSection = 'relationship_rules';
    } else if (upperLine.startsWith('AGREEMENTS:')) {
      currentSection = 'agreements';
    } else if (upperLine.startsWith('BOUNDARIES:')) {
      currentSection = 'boundaries';
    } else if (upperLine.startsWith('MUST NOT FORGET:')) {
      currentSection = 'must_not_forget';
    } else if (upperLine.startsWith('ACTIVE DESIRES:')) {
      currentSection = 'active_desires';
    } else if (upperLine.startsWith('FANTASY THEMES:')) {
      currentSection = 'fantasy_themes';
    } else if (upperLine.startsWith('CORRUPTION LEVEL:')) {
      currentSection = 'corruption';
    } else if (upperLine.startsWith('OPEN EMOTIONAL THREADS:')) {
      currentSection = 'threads';
    } else if (upperLine.startsWith('RESOLVED THREADS:')) {
      currentSection = 'resolved_threads';
    } else if (upperLine.startsWith('RECENT SCENE RECAP:')) {
      currentSection = 'recent_recap';
    } else if (
      line.startsWith('•') ||
      line.startsWith('-') ||
      line.startsWith('*')
    ) {
      const content = line.substring(1).trim();
      if (!content) continue;

      switch (currentSection) {
        case 'core_facts':
          core_facts.push(content);
          break;
        case 'milestones':
          relationship_milestones.push(content);
          break;
        case 'major_events':
          major_events.push(content);
          break;
        case 'emotional_turns':
          emotional_turns.push(content);
          break;
        case 'commitments':
          promises_and_commitments.push(content);
          break;
        case 'pref_emotional':
          emotional_prefs.push(content);
          break;
        case 'pref_sexual':
          sexual_prefs.push(content);
          break;
        case 'memories':
          shared_memories.push(content);
          break;
        case 'fantasies':
          hidden_fantasies.push(content);
          break;
        case 'npcs':
          characters_and_npcs.push(content);
          break;
        case 'people_registry':
          people_registry.push(content);
          break;
        case 'incidents':
          significant_incidents.push(content);
          break;
        case 'decisions':
          decisions_and_commitments.push(content);
          break;
        case 'relationship_rules':
          relationship_rules.push(content);
          break;
        case 'agreements':
          agreements.push(content);
          break;
        case 'boundaries':
          boundaries.push(content);
          break;
        case 'must_not_forget':
          must_not_forget.push(content);
          break;
        case 'active_desires':
          active_desires.push(content);
          break;
        case 'fantasy_themes':
          fantasy_themes.push(content);
          break;
        case 'threads':
          open_emotional_threads.push(content);
          break;
        case 'resolved_threads':
          resolved_threads.push(content);
          break;
      }
    } else {
      // Content without bullet points
      if (currentSection === 'relationship_state') {
        relationship_state += (relationship_state ? ' ' : '') + line;
      } else if (currentSection === 'emotional') {
        emotional_state += (emotional_state ? ' ' : '') + line;
      } else if (currentSection === 'corruption') {
        const num = Number.parseInt(line.replace(/\D/g, ''), 10);
        if (!Number.isNaN(num)) corruption_level = num;
      } else if (currentSection === 'recent_recap') {
        recent_scene_recap += (recent_scene_recap ? ' ' : '') + line;
      } else if (currentSection === 'summary' && !summary) {
        summary = line;
      }
    }
  }

  return {
    summary: summary || 'Current state of the relationship.',
    core_facts,
    relationship_milestones,
    major_events,
    emotional_turns,
    promises_and_commitments,
    relationship_state: relationship_state || 'Developing relationship state.',
    emotional_state: emotional_state || 'Neutral / Developing.',
    user_preferences: {
      emotional: emotional_prefs,
      sexual: sexual_prefs,
    },
    shared_memories,
    hidden_fantasies,
    characters_and_npcs,
    people_registry,
    significant_incidents,
    decisions_and_commitments,
    relationship_rules,
    agreements,
    boundaries,
    must_not_forget,
    active_desires,
    fantasy_themes,
    prompt_domains: undefined,
    corruption_level,
    open_emotional_threads,
    resolved_threads,
    recent_scene_recap:
      recent_scene_recap || summary || 'Recent interaction continued naturally.',
    metadata: {
      confidence: 0.8,
      extractedAt: new Date(),
    },
  };
}

// Validate that summarizer model is available and consistent
function validateSummarizerModel(): void {
  const envModel = process.env.SUMMARIZER_MODEL_ID;
  const defaultModel = envModel || 'x-ai/grok-4.3';

  console.log(`[Summarizer] Using provider alias: summarizer-model (${defaultModel})`);
  console.log(
    '[Summarizer] Fallback chain: chat-model → chat-model-reasoning → artifact-model',
  );
}

export function getSummarizer(): Summarizer {
  validateSummarizerModel();
  return new ModelSummarizer();
}
