import { expect, test } from '@playwright/test';
import {
  applyExplicitRevocations,
  applyIncrementalMemoryPatch,
  enforceMemoryPatchAuthority,
  isLowInformationStateValue,
  selectTopContinuityEvents,
  type IncrementalMemoryPatch,
  type StructuredMemory,
} from '@/lib/ai/summarizer';
import {
  applyOntologyOperations,
  deriveConstitutionFromOntology,
  findContradictingCanon,
  filterPersistableEvents,
  guardProvenance,
  isConsequentialStatement,
  normalizeItemScope,
  pruneOntologyItems,
  readContinuityEvents,
  reinforceMemoryWithContinuityEvents,
  selectAgreementsForPrompt,
  selectContinuityFactsForPrompt,
  selectEntityPacket,
  selectInterpretationsForPrompt,
  shouldPersistEvent,
  statementsContradict,
  type OntologyItem,
  type PersonModel,
} from '@/lib/ai/continuity';
import { shouldRunRefresh, serializeRefresh } from '@/lib/ai/chat-continuity';

function makeBaseMemory(overrides: Partial<StructuredMemory> = {}): StructuredMemory {
  return {
    summary: 'Established deep relationship.',
    core_facts: ['Marco is Mariana\'s boyfriend.'],
    relationship_milestones: [],
    major_events: [],
    emotional_turns: [],
    promises_and_commitments: [],
    relationship_state: 'Committed and engaged.',
    emotional_state: 'Loving.',
    user_preferences: { emotional: [], sexual: [] },
    shared_memories: [],
    hidden_fantasies: [],
    characters_and_npcs: [],
    people_registry: [],
    significant_incidents: [],
    decisions_and_commitments: [],
    relationship_rules: ['Full honesty is the essential condition.'],
    agreements: ['Isabella may explore with others.'],
    boundaries: ['Kai must not dictate Isabella\'s choices.'],
    must_not_forget: ['Isabella\'s deepest attachment is to Kai.'],
    active_desires: [],
    fantasy_themes: [],
    corruption_level: 0,
    open_emotional_threads: [],
    resolved_threads: [],
    recent_scene_recap: 'Recent interaction continued naturally.',
    metadata: { confidence: 0.9, extractedAt: new Date() },
    ...overrides,
  };
}

function makeFact(overrides: Partial<OntologyItem> = {}): OntologyItem {
  return {
    type: 'fact',
    statement: 'A concrete event happened.',
    scope: 'durable',
    perspective: 'objective',
    status: 'active',
    confidence: 1,
    evidence: [],
    created_turn: 1,
    last_updated_turn: 1,
    ...overrides,
  };
}

// ─── Refresh scheduling ──────────────────────────────────────────────────────

test.describe('Refresh scheduling', () => {
  test('a missed modulo turn still refreshes later (elapsed-turn scheduling)', () => {
    // The 226-turn failure: assistant turn 107 refreshed, then no refresh for
    // turns 108–113 because 112 % 3 === 1. With elapsed-turn scheduling the
    // refresh becomes due at turn 110 (3 turns after 107) and stays eligible.
    // Turn 108 (modulo-aligned but only 1 turn after) must NOT fire — proving
    // the schedule is elapsed-based, not modulo-based.
    const beforeDue = shouldRunRefresh({
      assistantTurnCount: 108,
      lastRefreshTurn: 107,
      unifiedRefreshTurns: 3,
      hasNewSalientContent: false,
    });
    expect(beforeDue.run).toBe(false);

    for (const turn of [110, 111, 112, 113]) {
      const decision = shouldRunRefresh({
        assistantTurnCount: turn,
        lastRefreshTurn: 107,
        unifiedRefreshTurns: 3,
        hasNewSalientContent: false,
      });
      expect(decision.run).toBe(true);
    }
  });

  test('a failed refresh remains eligible on subsequent turns', () => {
    // lastRefreshTurn stays 107 (a refresh failed at 110). Turn 111 must retry.
    const decision = shouldRunRefresh({
      assistantTurnCount: 111,
      lastRefreshTurn: 107,
      unifiedRefreshTurns: 3,
      hasNewSalientContent: false,
    });
    expect(decision.run).toBe(true);
  });

  test('counters use the same unit (assistant turns, not messages)', () => {
    // 2 assistant turns after a refresh at 5 → not due (early only if salient).
    const notDue = shouldRunRefresh({
      assistantTurnCount: 7,
      lastRefreshTurn: 5,
      unifiedRefreshTurns: 3,
      hasNewSalientContent: false,
    });
    expect(notDue.run).toBe(false);

    // 3 assistant turns after → due regardless of salience.
    const due = shouldRunRefresh({
      assistantTurnCount: 8,
      lastRefreshTurn: 5,
      unifiedRefreshTurns: 3,
      hasNewSalientContent: false,
    });
    expect(due.run).toBe(true);
  });

  test('stale background result cannot overwrite newer state (CAS contract)', () => {
    // Mirrors the optimistic-lock guard implemented in saveChatState: a write
    // only applies when the sequence it read is still the current one.
    const store = { seq: 0, value: 'initial' };
    const casWrite = (expected: number, next: number, value: string) => {
      if (store.seq !== expected) return { stale: true };
      store.seq = next;
      store.value = value;
      return { stale: false };
    };

    // Two concurrent refreshes both read seq 0.
    const readSeqA = store.seq;
    const readSeqB = store.seq;

    // Refresh A wins the write.
    expect(casWrite(readSeqA, readSeqA + 1, 'from-A').stale).toBe(false);

    // Refresh B is stale and must be dropped.
    expect(casWrite(readSeqB, readSeqB + 1, 'from-B').stale).toBe(true);
    expect(store.value).toBe('from-A');
    expect(store.seq).toBe(1);
  });

  test('serializeRefresh runs concurrent refreshes in order', async () => {
    const order: string[] = [];
    const first = serializeRefresh('chat-1', async () => {
      order.push('a-start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('a-end');
      return 'a';
    });
    const second = serializeRefresh('chat-1', async () => {
      order.push('b-start');
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push('b-end');
      return 'b';
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});

// ─── Patch semantics ─────────────────────────────────────────────────────────

test.describe('Patch semantics (non-destructive)', () => {
  test('omitted agreements preserve existing agreements', () => {
    const base = makeBaseMemory();
    const next = applyIncrementalMemoryPatch(base, {});
    expect(next.agreements).toEqual(base.agreements);
    expect(next.relationship_rules).toEqual(base.relationship_rules);
    expect(next.boundaries).toEqual(base.boundaries);
  });

  test('an empty array in a patch does not clear existing state', () => {
    const base = makeBaseMemory();
    const next = applyIncrementalMemoryPatch(base, {
      agreements: [],
      boundaries: [],
      relationship_rules: [],
    });
    expect(next.agreements).toEqual(['Isabella may explore with others.']);
    expect(next.boundaries).toEqual(['Kai must not dictate Isabella\'s choices.']);
    expect(next.relationship_rules).toEqual(['Full honesty is the essential condition.']);
  });

  test('an unsupported new agreement is rejected without deleting old agreements', () => {
    const base = makeBaseMemory();
    const patch: IncrementalMemoryPatch = {
      agreements: ['She will maintain a secret affair.'],
      boundaries: ['She has no boundary against cheating.'],
    };
    const safe = enforceMemoryPatchAuthority(patch, [
      { role: 'user', content: 'Continue the scene.' },
    ]);
    expect(safe.agreements).toBeUndefined();
    expect(safe.boundaries).toBeUndefined();

    const next = applyIncrementalMemoryPatch(base, safe);
    expect(next.agreements).toEqual(['Isabella may explore with others.']);
    expect(next.boundaries).toEqual(['Kai must not dictate Isabella\'s choices.']);
  });

  test('an explicit revocation removes an agreement', () => {
    const base = makeBaseMemory();
    const next = applyIncrementalMemoryPatch(base, {
      revoke_agreements: ['Isabella may explore with others.'],
    });
    expect(next.agreements).toEqual([]);
    // Other canon is untouched.
    expect(next.relationship_rules).toEqual(['Full honesty is the essential condition.']);
  });

  test('revocations are exact-match and case-insensitive', () => {
    expect(applyExplicitRevocations(
      ['Isabella may explore with others.'],
      ['ISABELLA MAY EXPLORE WITH OTHERS.'],
    )).toEqual([]);
    expect(applyExplicitRevocations(
      ['Isabella may explore with others.'],
      ['something else'],
    )).toEqual(['Isabella may explore with others.']);
  });

  test('low-information state values do not overwrite established canon', () => {
    const base = makeBaseMemory();
    const next = applyIncrementalMemoryPatch(base, {
      summary: 'Relationship continuity is beginning to form.',
      relationship_state: 'Early interaction.',
      emotional_state: 'Developing.',
    });
    expect(next.summary).toBe('Established deep relationship.');
    expect(next.relationship_state).toBe('Committed and engaged.');
    expect(next.emotional_state).toBe('Loving.');
    expect(isLowInformationStateValue('Relationship continuity is beginning to form.')).toBe(true);
    expect(isLowInformationStateValue('')).toBe(true);
    expect(isLowInformationStateValue('A real summary about the current state.')).toBe(false);
  });
});

// ─── RP actuality taxonomy ───────────────────────────────────────────────────

test.describe('RP actuality: content type is not actuality', () => {
  test('a user-narrated RP action becomes a persistable RP_CANON_EVENT', () => {
    expect(shouldPersistEvent({
      actuality: 'RP_CANON_EVENT',
      truthStatus: 'confirmed',
    } as any)).toBe(true);
    expect(filterPersistableEvents([
      { actuality: 'RP_CANON_EVENT', truthStatus: 'confirmed' } as any,
    ])).toHaveLength(1);
  });

  test('character fantasy remains non-canon', () => {
    expect(shouldPersistEvent({ actuality: 'NON_CANON_FANTASY', truthStatus: 'fantasy' } as any)).toBe(false);
    expect(shouldPersistEvent({ actuality: 'FANTASY_CONTENT', truthStatus: 'fantasy' } as any)).toBe(false);
  });

  test('a character lie persists as a claim, not objective fact', () => {
    // Persisted (so later confirmation can promote it), but the truthStatus
    // stays "claimed" — never treated as confirmed canon.
    expect(shouldPersistEvent({ actuality: 'RP_CHARACTER_LIE', truthStatus: 'claimed' } as any)).toBe(true);
    expect(shouldPersistEvent({ actuality: 'RP_CHARACTER_CLAIM', truthStatus: 'claimed' } as any)).toBe(true);
  });

  test('OOC scene direction becomes canon where appropriate', () => {
    expect(shouldPersistEvent({ actuality: 'OOC_INSTRUCTION', truthStatus: 'confirmed' } as any)).toBe(true);
  });

  test('explicit content is not automatically dropped as fantasy', () => {
    // An explicit sexual act that materially happened is an ACTUAL_EVENT /
    // RP_CANON_EVENT and must persist regardless of content category.
    expect(shouldPersistEvent({ actuality: 'ACTUAL_EVENT', truthStatus: 'confirmed' } as any)).toBe(true);
    expect(shouldPersistEvent({ actuality: 'RP_CANON_EVENT', truthStatus: 'confirmed' } as any)).toBe(true);
  });

  test('event selection does not penalise RP canon events', () => {
    const selected = selectTopContinuityEvents([
      { id: 'rp', summary: 'Isabella was with Marco in the salon', importance: 80, actuality: 'RP_CANON_EVENT', persist: true },
      { id: 'fantasy', summary: 'A dream she had', importance: 90, actuality: 'NON_CANON_FANTASY', persist: false },
      { id: 'lie', summary: 'She claimed she never met him', importance: 60, actuality: 'RP_CHARACTER_LIE', persist: true },
    ], 2);
    expect(selected.map(e => e.id)).toEqual(['rp', 'lie']);
  });
});

// ─── Scope semantics ─────────────────────────────────────────────────────────

test.describe('Consequential events are not scene-scoped', () => {
  test('room position expires on scene change but betrayal does not', () => {
    const room = makeFact({ id: 'room-1', statement: 'They are in the motel room.', scope: 'scene', type: 'scene_frame' });
    const betrayal = makeFact({ id: 'betrayal-1', statement: 'Marco exposed Isabella\'s betrayal to Kai using a video.', scope: 'durable' });

    const { items } = applyOntologyOperations([room, betrayal], [
      { operation: 'EXPIRE', target_id: 'room-1' },
    ], 10);

    const roomAfter = items.find(i => i.statement === 'They are in the motel room.');
    const betrayalAfter = items.find(i => i.statement.includes('exposed'));
    expect(roomAfter?.status).toBe('resolved');
    expect(betrayalAfter?.status).toBe('active');
  });

  test('a betrayal statement is normalised to durable scope', () => {
    expect(normalizeItemScope({
      statement: 'Marco exposed Isabella\'s encounter to Kai with a video.',
      scope: 'scene',
      type: 'fact',
    })).toBe('durable');
  });

  test('a new NPC identity does not expire', () => {
    const { personModels } = applyOntologyOperations([], [{
      operation: 'UPDATE_PERSON',
      person_model: {
        name: 'Mateo',
        role: 'gym contact',
        behaviour: 'sent suggestive DMs',
        current_status: 'separate NPC',
      },
    }], 5);
    expect(personModels).toHaveLength(1);
    expect(personModels[0].name).toBe('Mateo');
  });

  test('a relationship agreement does not expire', () => {
    const agreement = makeFact({
      type: 'agreement',
      statement: 'Isabella may explore with others.',
      scope: 'durable',
    });
    const { items } = applyOntologyOperations([agreement], [
      { operation: 'EXPIRE', target_id: agreement.id },
    ], 10);
    expect(items.find(i => i.statement === 'Isabella may explore with others.')?.status).toBe('active');
  });

  test('separation remains arc-level', () => {
    expect(normalizeItemScope({
      statement: 'Kai left and they were separated for several weeks.',
      scope: 'scene',
      type: 'fact',
    })).toBe('durable');
    expect(isConsequentialStatement('Kai drove away without fighting.')).toBe(true);
  });

  test('engagement-ring revelation remains durable', () => {
    expect(normalizeItemScope({
      statement: 'Isabella took off her engagement ring during the encounter with Marco.',
      scope: 'scene',
      type: 'fact',
    })).toBe('durable');
  });

  test('pruning preserves durable state while dropping scene ephemera', () => {
    const durable = makeFact({ statement: 'The exposure video exists.', scope: 'durable', significance: 'high' });
    const scenes = Array.from({ length: 200 }, (_, i) =>
      makeFact({ id: `scene-${i}`, statement: `Scene detail ${i}`, scope: 'scene', type: 'scene_frame' }),
    );
    const pruned = pruneOntologyItems([durable, ...scenes], 120);
    expect(pruned).toHaveLength(120);
    expect(pruned.some(i => i.statement === 'The exposure video exists.')).toBe(true);
  });
});

// ─── Provenance ──────────────────────────────────────────────────────────────

test.describe('Provenance guards', () => {
  test('an assistant-only invented historical claim cannot become durable canon', () => {
    const existing = [
      makeFact({ statement: 'Marco is Mariana\'s boyfriend; Mariana is Isabella\'s best friend.' }),
    ];
    const hallucinated = makeFact({
      statement: 'Years ago Isabella kissed another man at a college party before they were together.',
      scope: 'durable',
    });
    const guarded = guardProvenance(hallucinated, existing, 'assistant', 'ASSISTANT_NARRATION');
    expect(guarded.item).not.toBeNull();
    expect(guarded.item?.status).toBe('provisional');
    expect(guarded.item?.created_by).toBe('ASSISTANT_NARRATION');
  });

  test('a user confirmation can promote a provisional claim', () => {
    const existing = [
      makeFact({ statement: 'Marco is Mariana\'s boyfriend.' }),
    ];
    const claim = makeFact({
      statement: 'Isabella kissed Marco once at a college party years ago.',
      scope: 'durable',
    });
    const guarded = guardProvenance(claim, existing, 'user', 'USER_CONFIRMED');
    expect(guarded.item?.status).toBe('active');
  });

  test('a contradiction against a known NPC identity is rejected', () => {
    const existing = [
      makeFact({ statement: 'Marco is Mariana\'s boyfriend.' }),
    ];
    const contradictory = makeFact({
      statement: 'Marco is a stranger Isabella met once at a college party.',
      scope: 'durable',
    });
    expect(findContradictingCanon(contradictory, existing)).toHaveLength(1);
    const guarded = guardProvenance(contradictory, existing, 'assistant', 'ASSISTANT_NARRATION');
    expect(guarded.item).toBeNull();
    expect(guarded.reason).toContain('contradicts-existing-canon');
  });

  test('statementsContradict detects partner-vs-stranger claims', () => {
    expect(statementsContradict(
      'Marco is Mariana\'s boyfriend.',
      'Marco is a stranger from a college party.',
    )).toBe(true);
    expect(statementsContradict(
      'Marco is Mariana\'s boyfriend.',
      'Mateo is a gym contact.',
    )).toBe(false);
  });

  test('a new present-tense assistant event is allowed', () => {
    const existing: OntologyItem[] = [];
    const event = makeFact({
      statement: 'Isabella told Kai that Mateo sent her suggestive DMs.',
      scope: 'durable',
    });
    const guarded = guardProvenance(event, existing, 'assistant', 'ASSISTANT_NARRATION');
    expect(guarded.item?.status).toBe('active');
  });

  // Generic provenance invariants. These are NOT scenario-specific: the same
  // guard must protect any character/NPC identity, family role, or life state.
  test('a family relationship rewritten as a recent acquaintance stays provisional', () => {
    const existing = [
      makeFact({ statement: 'Priya is Rohan\'s mother.' }),
    ];
    const claim = makeFact({
      statement: 'Priya is a woman Rohan met recently at a cafe.',
      scope: 'durable',
    });
    const guarded = guardProvenance(claim, existing, 'assistant', 'ASSISTANT_NARRATION');
    // Unsupported assistant history about a known person → never active canon.
    expect(guarded.item).not.toBeNull();
    expect(guarded.item?.status).not.toBe('active');
    // The original identity survives.
    expect(existing.some(i => i.statement === 'Priya is Rohan\'s mother.')).toBe(true);
  });

  test('a business owner rewritten as an employee stays provisional', () => {
    const existing = [
      makeFact({ statement: 'Elena owns the bakery.' }),
    ];
    const claim = makeFact({
      statement: 'Elena was an employee at the bakery before.',
      scope: 'durable',
    });
    const guarded = guardProvenance(claim, existing, 'assistant', 'ASSISTANT_NARRATION');
    expect(guarded.item).not.toBeNull();
    expect(guarded.item?.status).not.toBe('active');
    expect(existing.some(i => i.statement === 'Elena owns the bakery.')).toBe(true);
  });

  test('a historically deceased NPC casually described as alive is rejected', () => {
    const existing = [
      makeFact({ statement: 'Hendricks died last winter.' }),
    ];
    const claim = makeFact({
      statement: 'Hendricks is still alive and runs the hardware store.',
      scope: 'durable',
    });
    expect(statementsContradict('Hendricks died last winter.', 'Hendricks is still alive and runs the hardware store.')).toBe(true);
    const guarded = guardProvenance(claim, existing, 'assistant', 'ASSISTANT_NARRATION');
    expect(guarded.item).toBeNull();
    expect(guarded.reason).toContain('contradicts-existing-canon');
    // The deceased status is untouched.
    expect(existing.some(i => i.statement === 'Hendricks died last winter.')).toBe(true);
  });

  test('name overlap alone is not evidence (no active promotion on shared names)', () => {
    // Both statements name Priya, but the new claim shares almost no content
    // with established canon, so it must not be promoted to active.
    const existing = [
      makeFact({ statement: 'Priya is Rohan\'s mother.' }),
    ];
    const claim = makeFact({
      statement: 'Priya visited the seaside town of Nuestra years ago.',
      scope: 'durable',
    });
    const guarded = guardProvenance(claim, existing, 'assistant', 'ASSISTANT_NARRATION');
    expect(guarded.item).not.toBeNull();
    expect(guarded.item?.status).not.toBe('active');
  });

  test('contradicting assistant historical claims are rejected inside applyOntologyOperations', () => {
    const existing = [
      makeFact({ id: 'm1', statement: 'Marco is Mariana\'s boyfriend.' }),
    ];
    const { items, rejected } = applyOntologyOperations(existing, [{
      operation: 'ADD',
      source_role: 'assistant',
      source_type: 'ASSISTANT_NARRATION',
      item: {
        type: 'fact',
        statement: 'Marco is a stranger Isabella met at a college party, not Mariana\'s boyfriend.',
        scope: 'durable',
        perspective: 'objective',
        status: 'active',
        confidence: 0.9,
        evidence: ['assistant narration'],
        created_turn: 0,
        last_updated_turn: 0,
      },
    }], 10);
    expect(rejected).toHaveLength(1);
    expect(items.some(i => i.statement.includes('stranger Isabella met'))).toBe(false);
    expect(items.some(i => i.statement === 'Marco is Mariana\'s boyfriend.')).toBe(true);
  });
});

// ─── Runtime retrieval ───────────────────────────────────────────────────────

test.describe('Exact-entity retrieval', () => {
  const canon: OntologyItem[] = [
    makeFact({ id: 'm1', statement: 'Marco is Mariana\'s boyfriend; Mariana is Isabella\'s best friend.', scope: 'durable', weight: 'identity-changing' }),
    makeFact({ id: 'm2', statement: 'Marco exposed Isabella\'s betrayal to Kai using a video.', scope: 'durable', weight: 'irreversible' }),
    makeFact({ id: 'm3', statement: 'Mateo from the gym sent suggestive DMs.', scope: 'arc' }),
  ];
  const people: PersonModel[] = [
    { name: 'Marco', role: 'Mariana\'s boyfriend', known_behaviours: ['exposed the betrayal'], evaluation: { respect: 30, trust: 20, safety: 25, attraction: 40 }, trajectory: 'distrusted', last_updated_turn: 40, linked_event_ids: ['m1', 'm2'] },
    { name: 'Mateo', role: 'gym contact', known_behaviours: ['sent DMs'], evaluation: { respect: 60, trust: 40, safety: 50, attraction: 10 }, trajectory: 'neutral', last_updated_turn: 107 },
  ];

  test('mentioning Marco retrieves the Marco facts', () => {
    const packet = selectEntityPacket(canon, people, 'You already did that with Marco.');
    expect(packet.mentions).toContain('Marco');
    const statements = packet.facts.map(f => f.statement);
    expect(statements.some(s => s.includes('Mariana'))).toBe(true);
    expect(statements.some(s => s.includes('exposed'))).toBe(true);
  });

  test('category-budget selection keeps foundational history when Marco is mentioned', () => {
    const facts = selectContinuityFactsForPrompt(canon, 3, 'You already did that with Marco.');
    const statements = facts.map(f => f.statement);
    expect(statements.some(s => s.includes('Marco'))).toBe(true);
    expect(statements.some(s => s.includes('exposed'))).toBe(true);
  });

  test('recent trivia cannot crowd out durable history in the budget', () => {
    const trivia: OntologyItem[] = Array.from({ length: 20 }, (_, i) =>
      makeFact({ id: `t${i}`, statement: `Mateo update ${i}`, scope: 'arc', last_updated_turn: 100 + i }),
    );
    const facts = selectContinuityFactsForPrompt([...trivia, ...canon], 5);
    expect(facts.some(f => f.statement.includes('Marco'))).toBe(true);
    expect(facts.some(f => f.statement.includes('exposed'))).toBe(true);
  });

  test('constitution selection always surfaces active agreements', () => {
    const agreement = makeFact({ id: 'a1', type: 'agreement', statement: 'Full honesty is the essential condition.', scope: 'durable' });
    const interpretation = makeFact({ id: 'i1', type: 'interpretation', statement: 'Isabella perceives a power shift.', scope: 'arc' });
    const selected = selectAgreementsForPrompt([interpretation, agreement], 3);
    expect(selected.some(a => a.statement === 'Full honesty is the essential condition.')).toBe(true);
  });
});

// ─── Narrative pollution ─────────────────────────────────────────────────────

test.describe('Interpretation quarantine', () => {
  test('interpretive prose cannot overwrite objective event fields', () => {
    const base = makeBaseMemory();
    const events = [
      {
        chatId: 'c', turnStart: 1, turnEnd: 1, type: 'character_reframe',
        summary: 'Isabella perceives Kai as a demanding authority figure.',
        participants: [], entities: [], truthStatus: 'claimed',
        actuality: 'CHARACTER_REFRAME', emotionalImpact: '', relationshipImpact: '',
        importance: 5, unresolved: true, persist: true, createdAt: '2026-01-01',
      } as any,
      {
        chatId: 'c', turnStart: 1, turnEnd: 1, type: 'major_event',
        summary: 'Isabella disclosed that she withheld details from Kai.',
        participants: [], entities: [], truthStatus: 'confirmed',
        actuality: 'ACTUAL_EVENT', emotionalImpact: '', relationshipImpact: '',
        importance: 90, unresolved: true, persist: true, createdAt: '2026-01-01',
      } as any,
    ];
    const reinforced = reinforceMemoryWithContinuityEvents(base, events);
    // The reframe interpretation must NOT leak into open threads / major events.
    expect(reinforced.open_emotional_threads.some(t => t.includes('authority figure'))).toBe(false);
    expect(reinforced.major_events.some(t => t.includes('authority figure'))).toBe(false);
    expect(reinforced.open_emotional_threads.some(t => t.includes('withheld'))).toBe(true);
    expect(reinforced.major_events.some(t => t.includes('withheld'))).toBe(true);
  });

  test('interpretations have lower selection priority than agreements', () => {
    const agreement = makeFact({ id: 'a1', type: 'agreement', statement: 'Isabella may explore with others.', scope: 'durable' });
    const interpretation = makeFact({ id: 'i1', type: 'interpretation', statement: 'Kai holds the leverage of judgment.', scope: 'arc', last_updated_turn: 999 });
    // Interpretations never appear in the facts budget.
    const facts = selectContinuityFactsForPrompt([interpretation, agreement], 3);
    expect(facts.some(f => f.type === 'interpretation')).toBe(false);
    // And only a single provisional interpretation is surfaced.
    expect(selectInterpretationsForPrompt([interpretation], 1)).toHaveLength(1);
  });

  test('recent interpretations cannot displace the active honesty agreement', () => {
    const agreement = makeFact({ id: 'a1', type: 'agreement', statement: 'Full honesty is the essential condition.', scope: 'durable' });
    const interpretations = Array.from({ length: 10 }, (_, i) =>
      makeFact({ id: `i${i}`, type: 'interpretation', statement: `Interpretive prose ${i}`, scope: 'arc', last_updated_turn: 200 + i }),
    );
    const selected = selectAgreementsForPrompt([...interpretations, agreement], 3);
    expect(selected.map(s => s.statement)).toContain('Full honesty is the essential condition.');
  });

  test('deriveConstitutionFromOntology keeps the ontology as the source of truth', () => {
    const base = makeBaseMemory();
    const ontology: OntologyItem[] = [
      makeFact({ type: 'agreement', statement: 'Isabella may explore with others.', scope: 'durable' }),
      makeFact({ type: 'rule', statement: 'Full honesty is required.', scope: 'durable' }),
    ];
    const derived = deriveConstitutionFromOntology(base, ontology);
    expect(derived.agreements).toContain('Isabella may explore with others.');
    expect(derived.relationship_rules).toContain('Full honesty is required.');
  });
});

// ─── Inspector schema ────────────────────────────────────────────────────────

test.describe('Inspector v2 schema', () => {
  test('a v2 container displays its events correctly', () => {
    const events = readContinuityEvents({
      _v: '2',
      items: [],
      events: [{ id: 'e1', summary: 'Marco exposed the betrayal.' }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Marco exposed the betrayal.');
  });

  test('a v1 flat array is still read correctly', () => {
    expect(readContinuityEvents([{ id: 'e1', summary: 'An event.' }])).toHaveLength(1);
  });

  test('empty state is only shown when the events array is genuinely empty', () => {
    expect(readContinuityEvents({ _v: '2', items: [], events: [] })).toEqual([]);
    expect(readContinuityEvents({ _v: '2', items: [], events: [{ id: 'x' }] })).toHaveLength(1);
    expect(readContinuityEvents(null)).toEqual([]);
  });
});
