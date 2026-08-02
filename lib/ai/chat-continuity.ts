import 'server-only';

import { convertToUIMessages } from '@/lib/utils';
import {
  getChatById,
  getMessagesByChatId,
  saveChatState,
  withQueryContext,
} from '@/lib/db/queries';
import {
  diffMemoryPatch,
  getSummarizer,
  type StructuredMemory,
  applyIncrementalMemoryPatch,
} from '@/lib/ai/summarizer';
import { measureConversation } from '@/lib/ai/salience';
import { derivePromptDomainState } from '@/lib/ai/prompt-domains';
import {
  detectStateSignals,
  type ActiveState,
} from '@/lib/ai/active-state';
import {
  applyCanonAuditResult,
  applyLaterReframe,
  applyOntologyOperations,
  applyRelationshipDynamicsDelta,
  defaultRelationshipDynamics,
  deriveConstitutionFromOntology,
  extractOntologyFromColumn,
  filterPersistableEvents,
  getContinuityManager,
  getReframeWarnings,
  readRefreshSeq,
  repairOntologyItemIds,
  reinforceMemoryWithContinuityEvents,
  type ContinuityEvent,
  type OntologyItem,
  type RelationshipDynamics,
} from '@/lib/ai/continuity';
import { getCharacterById } from '@/lib/ai/characters';
import { logAIError } from '@/lib/ai/error-log';

function uniqueMerge(current: string[] = [], previous: string[] = []) {
  const merged: string[] = [];

  for (const item of [...previous, ...current]) {
    const normalized = item.trim();
    if (!normalized) continue;
    if (!merged.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
      merged.push(normalized);
    }
  }

  return merged;
}

function filterIdentityDrift(items: string[] = [], characterName?: string) {
  if (!characterName) {
    return items;
  }

  const lowerName = characterName.toLowerCase();
  const firstName = characterName
    .replace(/["“”]/g, '')
    .split(/\s+/)[0]
    ?.toLowerCase();
  const aliasMatches = [...characterName.matchAll(/"([^"]+)"/g)].map((match) =>
    match[1].toLowerCase(),
  );

  return items.filter((item) => {
    const lower = item.toLowerCase();

    if (!/\bname\b/.test(lower) && !/\bi am\b/.test(lower) && !/\bi'm\b/.test(lower)) {
      return true;
    }

    return (
      lower.includes(lowerName) ||
      (!!firstName && lower.includes(firstName)) ||
      aliasMatches.some((alias) => lower.includes(alias))
    );
  });
}

export function filterInferredPolicyEntries(items: string[] = []) {
  return items.filter(item => !(
    /\b(?:implicit|unspoken)\s+agreement\b/i.test(item) ||
    /\bhas\s+no\s+boundary\s+against\b/i.test(item) ||
    /\bwill\s+maintain\s+the\s+appearance\b/i.test(item) ||
    /\bprioriti[sz]e\s+keeping\s+the\s+secret\b/i.test(item) ||
    /\bcan\s+summon\b/i.test(item) ||
    /\bdesires?.*\bas\s+evidenced\b/i.test(item) ||
    /\bdesires?.*\bsecret\s+affair\b/i.test(item) ||
    /\bdesires?.*\bkeep\s+both\b/i.test(item)
  ));
}

// ─── Per-chat refresh serialization ──────────────────────────────────────────
// Concurrent background refreshes for the same chat are serialised in-process,
// and each save is additionally guarded by an optimistic-lock sequence number
// so a stale background result can never overwrite newer state.

const refreshQueues = new Map<string, Promise<unknown>>();

export function serializeRefresh<T>(chatId: string, task: () => Promise<T>): Promise<T> {
  const previous = refreshQueues.get(chatId) ?? Promise.resolve();
  const next = previous.then(task, task);
  refreshQueues.set(
    chatId,
    next.catch(() => undefined).finally(() => {
      if (refreshQueues.get(chatId) === next.catch(() => undefined)) {
        refreshQueues.delete(chatId);
      }
    }),
  );
  return next;
}

/**
 * Pure refresh-scheduling decision. Returns true when a refresh should run.
 * Uses elapsed turns since the last successful refresh, never modulo
 * arithmetic, so a missed or failed refresh stays eligible on later turns.
 */
export function shouldRunRefresh({
  assistantTurnCount,
  lastRefreshTurn,
  unifiedRefreshTurns,
  hasNewSalientContent,
  earlyRefreshTurns = 2,
}: {
  assistantTurnCount: number;
  lastRefreshTurn: number;
  unifiedRefreshTurns: number;
  hasNewSalientContent: boolean;
  earlyRefreshTurns?: number;
}): { run: boolean; reason: string } {
  const turnsSinceLastRefresh = Math.max(0, assistantTurnCount - lastRefreshTurn);
  const isScheduledRefresh = turnsSinceLastRefresh >= unifiedRefreshTurns;
  const forceRefresh = lastRefreshTurn === 0 && assistantTurnCount >= unifiedRefreshTurns;
  const earlyRefresh = turnsSinceLastRefresh >= earlyRefreshTurns && hasNewSalientContent;

  if (isScheduledRefresh) return { run: true, reason: 'scheduled-elapsed' };
  if (forceRefresh) return { run: true, reason: 'force-first' };
  if (earlyRefresh) return { run: true, reason: 'early-salient' };
  return {
    run: false,
    reason: `noop (turnsSince=${turnsSinceLastRefresh}, due=${unifiedRefreshTurns}, early=${earlyRefresh})`,
  };
}

/**
 * Build targeted historically-relevant canon for entities mentioned in the
 * recent window. This lets the extractor ground references in durable state
 * instead of hallucinating, without shipping the full transcript.
 */
export function buildHistoricalEvidence(
  items: OntologyItem[],
  personModels: Array<{ name: string; aliases?: string[]; role: string }>,
  windowText: string,
  limit = 14,
): string {
  const lowerWindow = windowText.toLowerCase();
  const mentionedNames = new Set<string>();
  for (const person of personModels) {
    const names = [person.name, ...(person.aliases || [])].filter(name => name.length > 1);
    if (names.some(name => lowerWindow.includes(name.toLowerCase()))) {
      mentionedNames.add(person.name);
    }
  }
  for (const item of items) {
    if (item.status !== 'active') continue;
    for (const word of item.statement.toLowerCase().split(/\W+/)) {
      if (word.length > 2 && lowerWindow.includes(word)) mentionedNames.add(word);
    }
  }
  if (mentionedNames.size === 0) return '';

  const relevant = items.filter(item => {
    if (item.status !== 'active') return false;
    if (item.scope === 'scene') return false;
    const lower = item.statement.toLowerCase();
    return [...mentionedNames].some(name => lower.includes(name.toLowerCase()));
  });

  if (relevant.length === 0) return '';
  return relevant.slice(-limit).map(item => `- [${item.type}/${item.scope}] ${item.statement}`).join('\n');
}

function lowInformationProse(value?: string): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v.length === 0) return true;
  return /^(relationship continuity is beginning to form\.?|early interaction\.?|developing\.?|neutral\.?|current state of the relationship\.?|recent interaction continued naturally\.?)$/.test(v);
}

function stabilizeMemoryCanon({
  previousMemory,
  nextMemory,
  characterName,
}: {
  previousMemory?: StructuredMemory | null;
  nextMemory: StructuredMemory;
  characterName?: string;
}) {
  if (!previousMemory) {
    return {
      ...nextMemory,
      core_facts: filterIdentityDrift(nextMemory.core_facts || [], characterName),
      relationship_rules: filterInferredPolicyEntries(nextMemory.relationship_rules),
      agreements: filterInferredPolicyEntries(nextMemory.agreements),
      boundaries: filterInferredPolicyEntries(nextMemory.boundaries),
      active_desires: filterInferredPolicyEntries(nextMemory.active_desires),
      must_not_forget: uniqueMerge(nextMemory.must_not_forget || []),
    };
  }

  return {
    ...nextMemory,
    core_facts: filterIdentityDrift(
      uniqueMerge(nextMemory.core_facts || [], previousMemory.core_facts || []),
      characterName,
    ),
    people_registry: filterIdentityDrift(
      uniqueMerge(nextMemory.people_registry || [], previousMemory.people_registry || []),
      characterName,
    ),
    decisions_and_commitments: uniqueMerge(
      nextMemory.decisions_and_commitments || [],
      previousMemory.decisions_and_commitments || [],
    ),
    promises_and_commitments: uniqueMerge(
      nextMemory.promises_and_commitments || [],
      previousMemory.promises_and_commitments || [],
    ),
    relationship_rules: filterInferredPolicyEntries(uniqueMerge(
      nextMemory.relationship_rules || [],
      previousMemory.relationship_rules || [],
    )),
    agreements: filterInferredPolicyEntries(uniqueMerge(
      nextMemory.agreements || [],
      previousMemory.agreements || [],
    )),
    boundaries: filterInferredPolicyEntries(uniqueMerge(
      nextMemory.boundaries || [],
      previousMemory.boundaries || [],
    )),
    active_desires: filterInferredPolicyEntries(uniqueMerge(
      nextMemory.active_desires || [],
      previousMemory.active_desires || [],
    )),
    must_not_forget: uniqueMerge(
      nextMemory.must_not_forget || [],
      previousMemory.must_not_forget || [],
    ),
    prompt_domains: previousMemory.prompt_domains ?? nextMemory.prompt_domains,
    relational_guidance:
      nextMemory.relational_guidance ?? previousMemory.relational_guidance,
  };
}

export async function refreshChatContinuityState({
  chatId,
  userId,
}: {
  chatId: string;
  userId: string;
}) {
  // Serialise concurrent refreshes per chat so a stale background result
  // cannot overwrite a newer one (belt: in-process queue; suspenders: the CAS
  // sequence guard in saveChatState).
  return serializeRefresh(chatId, () => {
    return withQueryContext('background refreshChatContinuityState', async () => {
  const chat = await getChatById({ id: chatId });

  if (!chat || chat.userId !== userId) {
    return null;
  }

  const messagesFromDb = await getMessagesByChatId({ id: chatId });
  const uiMessages = convertToUIMessages(messagesFromDb);

  const enableMemorySlice = process.env.MEMORY_SLICE !== '0';
  const minTurnsForSummary = Number(process.env.MEMORY_MIN_TURNS ?? 5);
  const UNIFIED_REFRESH_TURNS = Number(
    process.env.UNIFIED_REFRESH_TURNS ?? 3,
  );
  const canonAuditRefreshTurns = Number(
    process.env.CANON_AUDIT_REFRESH_TURNS ?? 30,
  );
  const canonAuditWindowMessages = Number(
    process.env.CANON_AUDIT_WINDOW_MESSAGES ?? 40,
  );

  if (!enableMemorySlice) {
    return {
      status: 'disabled',
    };
  }

  const convo = uiMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: (m.parts?.map?.((p: any) => p.text || '').join(' ') || '')
        .replace(
          /^(Reasoned .*|We need to respond .*|User says .*|Assistant .*):?/i,
          '',
        )
        .trim(),
    }))
    .filter((m) => m.content.length > 0);

  const { tokensApprox, salience } = measureConversation(convo);
  const minTokens = Number(process.env.MEMORY_MIN_TOKENS ?? 400);
  const minSal = Number(process.env.MEMORY_MIN_SALIENCE ?? 3);
  const shouldSummarize = tokensApprox >= minTokens || salience >= minSal;

  if (convo.length < minTurnsForSummary || !shouldSummarize) {
    return {
      status: 'below_threshold',
      turns: convo.length,
      tokensApprox,
      salience,
    };
  }

  const previousMemory = (chat.memoryState as StructuredMemory | null) ?? null;
  const character = getCharacterById(chat.characterId);
  const previousActiveState = (chat.activeState as ActiveState | null) ?? null;
  const previousRelationshipDynamics =
    (chat.relationshipDynamics as RelationshipDynamics | null) ??
    defaultRelationshipDynamics;
  const existingOntology = extractOntologyFromColumn(chat.continuityEvents);
  const existingOntologyItems = repairOntologyItemIds(existingOntology?.items ?? []);
  const previousContinuityEvents = Array.isArray(chat.continuityEvents)
    ? (chat.continuityEvents as ContinuityEvent[])
    : existingOntology?.events ?? [];

  const assistantTurnCount = convo.filter(
    (entry) => entry.role === 'assistant',
  ).length;
  // Consistent, verbatim-favouring window for extraction.
  const recentConversationWindow = convo.slice(-12);
  const heuristicSignals = detectStateSignals(recentConversationWindow);

  // ── Refresh scheduling ────────────────────────────────────────────────────
  // The single refresh counter is `assistantTurnCount`. Scheduling uses
  // elapsed turns since the last successful refresh, never modulo arithmetic,
  // so a missed or failed refresh stays eligible on every later turn.
  const lastRefreshTurn = previousMemory?.metadata?.lastRefreshTurnCount ?? 0;
  const hasNewSalientContent =
    heuristicSignals.hasExplicitAct ||
    heuristicSignals.hasFuturePlan ||
    heuristicSignals.hasSceneShift;

  const refreshDecision = shouldRunRefresh({
    assistantTurnCount,
    lastRefreshTurn,
    unifiedRefreshTurns: UNIFIED_REFRESH_TURNS,
    hasNewSalientContent,
  });
  const shouldRunUnifiedRefresh = refreshDecision.run;

  if (!shouldRunUnifiedRefresh) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[memory] refresh NOOP: ${refreshDecision.reason} (turns=${assistantTurnCount}, lastRefresh=${lastRefreshTurn})`);
    }
    return {
      status: 'noop',
      turns: convo.length,
      tokensApprox,
      salience,
      turnsSinceLastRefresh: Math.max(0, assistantTurnCount - lastRefreshTurn),
      decisionReason: refreshDecision.reason,
    };
  }

  // Stale-write guard: capture the sequence number this refresh is based on.
  // If a newer refresh persists first, this write is rejected via CAS.
  const refreshSeq = Math.max(
    chat.continuitySeq ?? 0,
    readRefreshSeq(chat.continuityEvents),
  );

  // Track consecutive failures for degraded mode
  const prevConsecutiveFails = previousMemory?.metadata?.consecutiveFailures ?? 0;

  // Targeted historical evidence: durable canon about entities mentioned in the
  // extraction window, so the extractor can ground references instead of
  // hallucinating missing history.
  const historicalEvidence = buildHistoricalEvidence(
    existingOntologyItems,
    existingOntology?.personModels ?? [],
    recentConversationWindow.map((entry) => entry.content).join('\n'),
  );

  const [unifiedUpdate, ontologyUpdate, canonicalEvents] = await Promise.all([
    getSummarizer().extractUnifiedUpdate(
      recentConversationWindow,
      {
        previousMemory: previousMemory ?? undefined,
        previousActiveState: previousActiveState ?? undefined,
        previousDynamics: previousRelationshipDynamics,
        characterName: character.name,
      },
    ),
    getSummarizer().extractOntologyUpdate(
      recentConversationWindow,
      {
        previousMemory: previousMemory ?? undefined,
        previousActiveState: previousActiveState ?? undefined,
        previousDynamics: previousRelationshipDynamics,
        characterName: character.name,
        previousOntologyItems: existingOntologyItems,
        previousPersonModels: existingOntology?.personModels ?? [],
        historicalEvidence,
      },
    ).catch(() => ({
      operations: [],
      event_families: [],
      scene_frame: null,
      relationship: {},
    })),
    getSummarizer().extractCanonicalEvents(
      recentConversationWindow,
      {
        characterName: character.name,
      },
    ).catch(() => ({ events: [] })),
  ]) as [any, any, { events: { type: string; statement: string }[] }];

  // Scene frames are durable chronology, not only volatile active state.
  // Supersede the previous frame so old locations/participants remain
  // inspectable without competing with the live scene.
  if (ontologyUpdate.scene_frame) {
    const previousScene = [...existingOntologyItems]
      .reverse()
      .find(item => item.type === 'scene_frame' && item.status === 'active');
    const frame = ontologyUpdate.scene_frame;
    const sceneItem = {
      type: 'scene_frame' as const,
      statement: `${frame.location} | ${frame.activity} | participants: ${frame.participants.join(', ') || 'unknown'}`,
      perspective: 'objective' as const,
      scope: 'scene' as const,
      status: 'active' as const,
      significance: 'medium' as const,
      confidence: 1,
      evidence: recentConversationWindow.slice(-2).map(entry => entry.content.slice(0, 240)),
    };
    ontologyUpdate.operations.push(
      previousScene?.id
        ? { operation: 'SUPERSEDE', target_id: previousScene.id, item: sceneItem }
        : { operation: 'ADD', item: sceneItem },
    );
  }

  // Merge canonical events into ontology operations if not already captured
  if (canonicalEvents.events.length > 0) {
    const existingStatements = new Set(
      (ontologyUpdate.operations || []).filter((op: any) => op.item?.statement).map((op: any) => op.item!.statement.toLowerCase()),
    );
    for (const event of canonicalEvents.events) {
      if (!existingStatements.has(event.statement.toLowerCase())) {
        ontologyUpdate.operations.push({
          operation: 'ADD',
          item: {
            type: 'fact' as const,
            statement: event.statement,
            perspective: 'objective' as const,
            scope: (event.type === 'scene_change' ? 'scene' : 'durable') as any,
            significance: 'high' as const,
            confidence: 1.0,
            evidence: [],
          },
        });
      }
    }
  }

  const extractionFailed = unifiedUpdate.reasoning?.includes('failed');
  const consecutiveFailures = extractionFailed ? prevConsecutiveFails + 1 : 0;

  // If 2+ consecutive failures, preserve previous state and set degraded flag
  const isDegraded = consecutiveFailures >= 2;

  let enhancedMemory: StructuredMemory;
  let nextActiveState: any;
  let nextContinuityEvents: ContinuityEvent[];
  let nextRelationshipDynamics: RelationshipDynamics;
  // Load ontology items from v2 wrapper in continuityEvents column if present
  let nextOntologyItems: OntologyItem[] = existingOntologyItems;
  let nextRelationshipDimensions: Record<string, any> =
    existingOntology?.relationship || {};
  if (ontologyUpdate.relationship) {
    nextRelationshipDimensions = {
      ...nextRelationshipDimensions,
      ...ontologyUpdate.relationship,
      durable_bond: {
        ...nextRelationshipDimensions.durable_bond,
        ...ontologyUpdate.relationship.durable_bond,
      },
      volatile_state: {
        ...nextRelationshipDimensions.volatile_state,
        ...ontologyUpdate.relationship.volatile_state,
      },
      trust_components: {
        ...nextRelationshipDimensions.trust_components,
        ...ontologyUpdate.relationship.trust_components,
      },
    };
  }

  if (isDegraded) {
    console.warn('[memory] degraded mode: 2+ consecutive extraction failures, preserving previous state');
    return {
      status: 'degraded',
      turns: convo.length,
      tokensApprox,
      salience,
      consecutiveFailures,
    };
  }

  // 1. Patch Memory
  enhancedMemory = applyIncrementalMemoryPatch(
    previousMemory,
    unifiedUpdate.memoryPatch,
  );

  // 2. Update Active State (ensure domain_guard is reset to allow)
  // Prefer LLM-extracted third_party_mode when non-closed (means LLM saw the scene shift),
  // otherwise fall back to the hot-resolved value from the last request.
  nextActiveState = {
    ...unifiedUpdate.activeState,
    domain_guard: { mode: 'allow' },
    third_party_mode:
      unifiedUpdate.activeState?.third_party_mode &&
      unifiedUpdate.activeState.third_party_mode !== 'closed'
        ? unifiedUpdate.activeState.third_party_mode
        : (previousActiveState?.third_party_mode ?? 'closed'),
    third_party_posture: previousActiveState?.third_party_posture ?? 'closed_loyal',
    pace: previousActiveState?.pace ?? 'natural',
  };
  if (ontologyUpdate.scene_frame) {
    nextActiveState.location = ontologyUpdate.scene_frame.location;
    nextActiveState.current_activity = ontologyUpdate.scene_frame.activity;
  }

  // Scene freshness check: if location, participants, or activity changed, replace scene-local state
  if (previousActiveState && unifiedUpdate.activeState) {
    const prevLoc = previousActiveState.location;
    const nextLoc = unifiedUpdate.activeState.location;
    const prevAct = previousActiveState.current_activity;
    const nextAct = unifiedUpdate.activeState.current_activity;
    const prevActors = (previousActiveState.actors || []).map((a: any) => a.name).sort().join(',');
    const nextActors = (unifiedUpdate.activeState.actors || []).map((a: any) => a.name).sort().join(',');
    const sceneChanged = (prevLoc !== nextLoc) || (prevAct !== nextAct) || (prevActors !== nextActors);
    if (sceneChanged) {
      // Scene has moved — reset scene-local state, keep durable state
      nextActiveState.scene_locks = [];
    }
  }

  // 3. Update Continuity Events — with meaning-based persistence and later-reframe
  nextContinuityEvents = previousContinuityEvents;
  if (unifiedUpdate.newEvents.length > 0) {
    const rawEvents: ContinuityEvent[] = unifiedUpdate.newEvents;
    const validEvents = rawEvents.map((e: ContinuityEvent) => ({
      ...e,
      chatId,
      id: e.id || `${e.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: e.createdAt || new Date().toISOString(),
    }));

    // Apply later-reframe: if a new event reframes an old one, update the old one
    nextContinuityEvents = applyLaterReframe(previousContinuityEvents, validEvents);

    // Filter out non-persistable events (fantasies, performative speech, etc.)
    const filtered = filterPersistableEvents(validEvents);
    if (filtered.length < validEvents.length) {
      const dropped = validEvents.filter((e: ContinuityEvent) => !filterPersistableEvents([e]).length);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[memory] dropped ${dropped.length} non-persistable events (${dropped.map((e: ContinuityEvent) => e.actuality || e.type).join(', ')})`);
      }
    }

    // Merge filtered events with semantic deduplication
    for (const event of filtered) {
      // Check if a semantically similar event already exists (same type + core topic match)
      const eventWords = new Set(
        (event.summary || '')
          .toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 4),
      );
      const duplicate = nextContinuityEvents.find(e => {
        if (e.type !== event.type) return false;
        if (e.id === event.id) return true;
        // Compare by core word overlap — if >50% of significant words match, it's the same event
        const existingWords = (e.summary || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
        if (existingWords.length === 0 || eventWords.size === 0) return false;
        const overlap = [...eventWords].filter(w => existingWords.includes(w)).length;
        return overlap / Math.max(eventWords.size, existingWords.length) > 0.4;
      });

      if (duplicate) {
        // Update the existing event with new information (higher importance, updated status)
        const idx = nextContinuityEvents.indexOf(duplicate);
        nextContinuityEvents[idx] = {
          ...duplicate,
          importance: Math.max(duplicate.importance || 0, event.importance || 0),
          unresolved: event.unresolved ?? duplicate.unresolved,
          truthStatus: event.truthStatus || duplicate.truthStatus,
          summary: event.summary || duplicate.summary,
          turnEnd: Math.max(duplicate.turnEnd || 0, event.turnEnd || 0),
          participants: [...new Set([...(duplicate.participants || []), ...(event.participants || [])])],
        };
      } else if (!nextContinuityEvents.some(e => e.id === event.id)) {
        nextContinuityEvents.push(event);
      }
    }
    nextContinuityEvents = nextContinuityEvents.slice(-30);

    enhancedMemory = reinforceMemoryWithContinuityEvents(enhancedMemory, nextContinuityEvents);

    // Store reframe warnings in memory metadata for prompt injection
    const warnings = getReframeWarnings(nextContinuityEvents);
    if (warnings.length > 0 && enhancedMemory.metadata) {
      enhancedMemory.metadata.reframeWarnings = warnings;
    }
  }

  // 4. Update Dynamics (apply only user_ai deltas)
  nextRelationshipDynamics = previousRelationshipDynamics;
  const userAiDelta = (unifiedUpdate.dynamicsDeltas || []).find((d: any) => d.pair === 'user_ai');
  if (userAiDelta) {
    nextRelationshipDynamics = applyRelationshipDynamicsDelta(
      previousRelationshipDynamics,
      userAiDelta.dynamicsDelta,
    );
  }

  // Apply ontology operations
  let nextPersonModels = existingOntology?.personModels || [];
  let rejected: { reason: string; statement: string }[] = [];
  try {
    const ontologyItems = ontologyUpdate?.operations ? applyOntologyOperations(
      nextOntologyItems,
      ontologyUpdate.operations,
      assistantTurnCount,
      nextPersonModels,
    ) : { items: nextOntologyItems, relationshipUpdate: null, personModels: nextPersonModels, rejected: [] };
    nextOntologyItems = ontologyItems.items;
    rejected = ontologyItems.rejected ?? [];
    if (ontologyItems.relationshipUpdate) {
      nextRelationshipDimensions = {
        ...nextRelationshipDimensions,
        ...ontologyItems.relationshipUpdate,
        durable_bond: {
          ...nextRelationshipDimensions.durable_bond,
          ...ontologyItems.relationshipUpdate.durable_bond,
        },
        volatile_state: {
          ...nextRelationshipDimensions.volatile_state,
          ...ontologyItems.relationshipUpdate.volatile_state,
        },
        trust_components: {
          ...nextRelationshipDimensions.trust_components,
          ...ontologyItems.relationshipUpdate.trust_components,
        },
      };
    }
    nextPersonModels = ontologyItems.personModels;
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[memory] ontology: ${ontologyUpdate?.operations?.length || 0} ops applied, ${ontologyItems.items.length} total items, ${ontologyItems.personModels.length} person models, ${rejected.length} rejected`);
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      logAIError('ontology-merge', e);
    }
  }

  // Stabilize and derive domains
  enhancedMemory = stabilizeMemoryCanon({
    previousMemory,
    nextMemory: enhancedMemory,
    characterName: character.name,
  });

  // The ontology is the canonical source for the relationship constitution;
  // derive the memoryState view so the two representations never diverge.
  enhancedMemory = deriveConstitutionFromOntology(enhancedMemory, nextOntologyItems);

  enhancedMemory = {
    ...enhancedMemory,
    prompt_domains: derivePromptDomainState({
      character,
      memory: enhancedMemory,
      activeState: nextActiveState,
      relationshipDynamics: nextRelationshipDynamics,
    }),
    relational_guidance: previousMemory?.relational_guidance, // Preserve for now or unify later
    metadata: {
      ...enhancedMemory.metadata,
      lastRefreshTurnCount: assistantTurnCount,
      lastRefreshSalience: salience,
      lastRefreshDate: new Date().toISOString(),
      lastRefreshSeq: refreshSeq + 1,
      consecutiveFailures,
      rejectedClaims: rejected.length > 0 ? rejected : undefined,
    },
  };

  // Log memory diff in development
  if (process.env.NODE_ENV !== 'production') {
    const patch = unifiedUpdate.memoryPatch;
    const tier1Fields = ['core_facts', 'people_registry', 'promises_and_commitments', 'decisions_and_commitments', 'relationship_rules', 'agreements', 'boundaries', 'must_not_forget', 'major_events', 'emotional_turns', 'significant_incidents', 'fantasy_themes', 'active_desires', 'open_emotional_threads', 'resolved_threads'] as const;
    for (const field of tier1Fields) {
      const val = (patch as any)[field];
      if (Array.isArray(val) && val.length > 0) {
        console.log(`[memory] +${field}: ${val.join('; ')}`);
      }
    }
    const changes = diffMemoryPatch(previousMemory, enhancedMemory);
    if (changes.length > 0) {
      console.log(`[memory] refresh diff:\n${changes.map(c => `  ${c}`).join('\n')}`);
    }
  }

  // Run Canon Audit on a slower cycle (elapsed-turn, like the main refresh)
  const turnsSinceLastRefresh = Math.max(0, assistantTurnCount - lastRefreshTurn);
  const isCanonAuditTurn = turnsSinceLastRefresh >= canonAuditRefreshTurns;
  if (isCanonAuditTurn) {
    const auditResult = await getContinuityManager().auditCanonConsistency({
      recentConversation: convo.slice(-canonAuditWindowMessages),
      memory: enhancedMemory,
      activeState: nextActiveState ?? undefined,
      continuityEvents: nextContinuityEvents,
      characterName: character.name,
      ontologyItems: nextOntologyItems,
      personModels: nextPersonModels,
    });

    if (auditResult) {
      enhancedMemory = applyCanonAuditResult(enhancedMemory, auditResult);
    }
  }

  // Optimistic-lock save: only persist if no newer refresh has won since this
  // refresh read its input. A stale background write is dropped, not applied.
  const nextSeq = refreshSeq + 1;
  const saveResult = await saveChatState({
    chatId,
    memoryState: enhancedMemory,
    activeState: nextActiveState,
    relationshipDynamics: nextRelationshipDynamics,
    continuityEvents: nextContinuityEvents,
    continuityItems: nextOntologyItems.length > 0 ? nextOntologyItems : undefined,
    relationshipDimensions: nextRelationshipDimensions,
    personModels: nextPersonModels.length > 0 ? nextPersonModels : undefined,
    expectedContinuitySeq: refreshSeq,
    nextContinuitySeq: nextSeq,
    refreshSeq: nextSeq,
  });

  if (saveResult?.stale) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[memory] refresh stale-write guard: dropped refresh based on seq ${refreshSeq} (newer state already persisted)`);
    }
    return {
      status: 'stale',
      turns: convo.length,
      tokensApprox,
      salience,
      refreshSeq,
    };
  }

  return {
    status: 'saved',
    turns: convo.length,
    tokensApprox,
    salience,
    unifiedUpdate,
    eventsCount: nextContinuityEvents.length,
    refreshSeq: nextSeq,
    rejected,
  };
    });
  });
}
