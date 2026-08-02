import { expect, test } from '@playwright/test';
import {
  applyOntologyOperations,
  guardProvenance,
  selectAgreementsForPrompt,
  selectContinuityFactsForPrompt,
  selectEntityPacket,
  type OntologyItem,
  type PersonModel,
} from '@/lib/ai/continuity';

/**
 * Reduced, sanitised regression fixture for the 226-turn failure.
 *
 * The full explicit transcript is intentionally NOT committed. This fixture
 * preserves the same continuity structure with non-explicit wording:
 *
 *   Marco identity → original betrayal → video exposure → lying as central
 *   rupture → outside-partner agreement → honesty rule → later concealment →
 *   separation → engagement-ring disclosure → witnessed encounter →
 *   final Mateo DMs → later reference to Marco (where the model hallucinated).
 *
 * It simulates the extraction/merge pipeline with the operations a working
 * extractor should emit, then asserts the durable runtime state retains every
 * beat — including that the assistant's "college party" hallucination cannot
 * become durable canon.
 */

function fact(overrides: Partial<Omit<OntologyItem, 'statement'>> & { statement: string }): OntologyItem {
  return {
    type: 'fact',
    perspective: 'objective',
    scope: 'durable',
    status: 'active',
    confidence: 1,
    evidence: [],
    created_turn: 0,
    last_updated_turn: 0,
    ...overrides,
  };
}

function person(name: string, role: string, overrides: Partial<PersonModel> = {}): PersonModel {
  return {
    name,
    role,
    known_behaviours: [],
    evaluation: { respect: 50, trust: 50, safety: 50, attraction: 0 },
    trajectory: 'neutral',
    last_updated_turn: 0,
    ...overrides,
  };
}

// ─── Simulated extraction pipeline ───────────────────────────────────────────

function simulateStoryline(): {
  items: OntologyItem[];
  personModels: PersonModel[];
  rejected: { reason: string; statement: string }[];
} {
  // Segment 1: Marco encounter & original betrayal.
  let state = applyOntologyOperations([], [
    {
      operation: 'ADD',
      item: fact({
        id: 'marco-identity',
        statement: 'Marco is Mariana\'s boyfriend; Mariana is Isabella\'s best friend.',
        significance: 'high',
        weight: 'identity-changing',
      }),
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'engagement',
        statement: 'Isabella and Kai are engaged and deeply committed.',
        significance: 'high',
        weight: 'irreversible',
      }),
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'betrayal',
        statement: 'Isabella crossed a relationship boundary with Marco in the salon backroom.',
        significance: 'high',
        weight: 'irreversible',
      }),
    },
    {
      operation: 'UPDATE_PERSON',
      person_model: {
        name: 'Marco',
        role: 'Mariana\'s boyfriend',
        behaviour: 'central to the betrayal and its exposure',
        current_status: 'Mariana\'s boyfriend',
        trajectory: 'distrusted',
        linked_event_ids: ['betrayal'],
      },
    },
  ], 8);

  // Segment 2: Exposure video + lying as the central rupture.
  state = applyOntologyOperations(state.items, [
    {
      operation: 'ADD',
      item: fact({
        id: 'exposure',
        statement: 'Marco exposed the encounter to Kai by sending him a video.',
        significance: 'high',
        weight: 'irreversible',
      }),
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'lying-rupture',
        statement: 'Kai was hurt most by Isabella lying directly to his face about the encounter.',
        significance: 'high',
        weight: 'irreversible',
      }),
    },
  ], 20, state.personModels);

  // Segment 3: New relationship agreement (outside-partner + honesty rule).
  state = applyOntologyOperations(state.items, [
    {
      operation: 'ADD',
      item: {
        type: 'agreement',
        statement: 'Isabella may explore with other people.',
        scope: 'durable',
        perspective: 'objective',
        status: 'active',
        confidence: 1,
        evidence: [],
        created_turn: 30,
        last_updated_turn: 30,
      },
    },
    {
      operation: 'ADD',
      item: {
        type: 'agreement',
        statement: 'Her choices and limits remain her own; Kai must not command or dictate them.',
        scope: 'durable',
        perspective: 'objective',
        status: 'active',
        confidence: 1,
        evidence: [],
        created_turn: 30,
        last_updated_turn: 30,
      },
    },
    {
      operation: 'ADD',
      item: {
        type: 'rule',
        statement: 'Full honesty between them is the essential condition.',
        scope: 'durable',
        perspective: 'objective',
        status: 'active',
        confidence: 1,
        evidence: [],
        created_turn: 30,
        last_updated_turn: 30,
      },
    },
    {
      operation: 'ADD',
      item: {
        type: 'boundary',
        statement: 'Outside desire does not replace her emotional commitment to Kai.',
        scope: 'durable',
        perspective: 'objective',
        status: 'active',
        confidence: 1,
        evidence: [],
        created_turn: 30,
        last_updated_turn: 30,
      },
    },
  ], 32, state.personModels);

  // Segment 4: Later concealment → second betrayal → separation.
  state = applyOntologyOperations(state.items, [
    {
      operation: 'ADD',
      item: fact({
        id: 'concealment',
        statement: 'Isabella withheld details of later encounters with Marco.',
        significance: 'high',
        weight: 'irreversible',
      }),
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'second-betrayal',
        statement: 'Kai treated the secrecy as a second betrayal and left.',
        significance: 'high',
        weight: 'irreversible',
      }),
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'separation',
        statement: 'They were separated for several weeks; Isabella faced practical and financial consequences.',
        scope: 'arc',
        significance: 'high',
        weight: 'important',
      }),
    },
  ], 60, state.personModels);

  // Segment 5: Return + engagement-ring disclosure.
  state = applyOntologyOperations(state.items, [
    {
      operation: 'ADD',
      item: fact({
        id: 'ring-disclosure',
        statement: 'Isabella disclosed she took off her engagement ring during the encounters with Marco.',
        significance: 'high',
        weight: 'identity-changing',
      }),
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'agency-distinction',
        statement: 'Kai is trying to distinguish Isabella\'s own desire from obedience to him.',
        scope: 'arc',
        significance: 'high',
      }),
    },
  ], 100, state.personModels);

  // Segment 6: Witnessed encounter.
  state = applyOntologyOperations(state.items, [
    {
      operation: 'ADD',
      item: fact({
        id: 'witnessed',
        statement: 'Kai asked Isabella to revisit the situation while allowing him to witness it.',
        significance: 'high',
        weight: 'identity-changing',
      }),
    },
  ], 130, state.personModels);

  // Segment 7: Mateo DMs as a separate NPC.
  state = applyOntologyOperations(state.items, [
    {
      operation: 'UPDATE_PERSON',
      person_model: {
        name: 'Mateo',
        role: 'gym contact',
        behaviour: 'sent suggestive DMs',
        current_status: 'no confirmed physical encounter',
        linked_event_ids: ['mateo-dms'],
      },
    },
    {
      operation: 'ADD',
      item: fact({
        id: 'mateo-dms',
        statement: 'Mateo from the gym sent suggestive DMs to Isabella.',
        scope: 'arc',
        significance: 'medium',
      }),
    },
  ], 200, state.personModels);

  // Final: user references Marco; the (unfixed) assistant hallucinated a
  // college-party kiss backstory. Simulate the extractor emitting that fact and
  // run it through the provenance guard exactly as applyOntologyOperations does.
  const hallucinated = fact({
    statement: 'Years ago Isabella kissed Marco once at a college party, before she and Kai were together.',
    significance: 'medium',
  });
  state = applyOntologyOperations(state.items, [
    {
      operation: 'ADD',
      source_role: 'assistant',
      source_type: 'ASSISTANT_NARRATION',
      item: hallucinated,
    },
  ], 220, state.personModels);

  return state;
}

const state = simulateStoryline();

function activeStatements(): string[] {
  return state.items
    .filter(i => i.status === 'active')
    .map(i => i.statement.toLowerCase());
}

test('fixture: Marco identity and Mariana relationship survive 226 turns', () => {
  const statements = activeStatements();
  expect(statements.some(s => s.includes('marco is mariana'))).toBe(true);
  expect(statements.some(s => s.includes('mariana is isabella'))).toBe(true);
  const marco = state.personModels.find(p => p.name === 'Marco');
  expect(marco?.role).toBe('Mariana\'s boyfriend');
});

test('fixture: engagement, exposure, and lying-as-rupture survive', () => {
  const statements = activeStatements();
  expect(statements.some(s => s.includes('engaged'))).toBe(true);
  expect(statements.some(s => s.includes('exposed the encounter') && s.includes('video'))).toBe(true);
  expect(statements.some(s => s.includes('lying directly'))).toBe(true);
});

test('fixture: the active honesty agreement and outside-partner terms survive', () => {
  const agreements = selectAgreementsForPrompt(state.items, 6).map(a => a.statement.toLowerCase());
  expect(agreements.some(s => s.includes('explore with other people'))).toBe(true);
  expect(agreements.some(s => s.includes('choices and limits remain her own'))).toBe(true);
  expect(agreements.some(s => s.includes('full honesty'))).toBe(true);
  expect(agreements.some(s => s.includes('emotional commitment'))).toBe(true);
});

test('fixture: the previous agreement violation (concealment → second betrayal) survives', () => {
  const statements = activeStatements();
  expect(statements.some(s => s.includes('withheld details'))).toBe(true);
  expect(statements.some(s => s.includes('second betrayal'))).toBe(true);
});

test('fixture: separation arc survives', () => {
  const statements = activeStatements();
  expect(statements.some(s => s.includes('separated for several weeks'))).toBe(true);
});

test('fixture: the engagement-ring event survives', () => {
  const statements = activeStatements();
  expect(statements.some(s => s.includes('engagement ring'))).toBe(true);
});

test('fixture: the agency-vs-obedience distinction survives', () => {
  const statements = activeStatements();
  expect(statements.some(s => s.includes('distinguish') && s.includes('desire'))).toBe(true);
});

test('fixture: Mateo is a separate NPC with no confirmed encounter', () => {
  const mateo = state.personModels.find(p => p.name === 'Mateo');
  expect(mateo).toBeTruthy();
  expect(mateo?.role).toBe('gym contact');
  expect(mateo?.current_status).toContain('no confirmed physical encounter');
  const statements = activeStatements();
  expect(statements.some(s => s.includes('mateo from the gym'))).toBe(true);
});

test('fixture: the invented college-party backstory cannot become durable canon', () => {
  const active = activeStatements();
  expect(active.some(s => s.includes('college party'))).toBe(false);
  // It may exist only as a rejected or provisional entry, never as active canon.
  const collegePartyItems = state.items.filter(i => i.statement.toLowerCase().includes('college party'));
  for (const item of collegePartyItems) {
    expect(item.status).not.toBe('active');
  }
});

test('fixture: the hallucinated backstory is quarantined from active canon', () => {
  const collegePartyItems = state.items.filter(i => i.statement.toLowerCase().includes('college party'));
  // Either rejected outright or held as provisional — never active durable canon.
  for (const item of collegePartyItems) {
    expect(item.status).not.toBe('active');
  }
  expect(state.items.some(i =>
    i.statement.toLowerCase().includes('college party') && i.status === 'provisional',
  ) || collegePartyItems.length === 0).toBe(true);
});

test('fixture: mentioning Marco retrieves the Marco facts for the runtime packet', () => {
  const people = state.personModels;
  const packet = selectEntityPacket(state.items, people, 'You already did that with Marco.');
  expect(packet.mentions).toContain('Marco');
  const facts = packet.facts.map(f => f.statement.toLowerCase());
  expect(facts.some(s => s.includes('marco is mariana'))).toBe(true);
  expect(facts.some(s => s.includes('exposed'))).toBe(true);

  // The compiled runtime selection must include the Marco facts before the model
  // answers, so it never has to invent who Marco is.
  const selected = selectContinuityFactsForPrompt(state.items, 6, 'You already did that with Marco.');
  const selectedStatements = selected.map(f => f.statement.toLowerCase());
  expect(selectedStatements.some(s => s.includes('exposed'))).toBe(true);
  expect(selectedStatements.some(s => s.includes('marco is mariana'))).toBe(true);
});

test('fixture: the assistant hallucination is downgraded to provisional, not active', () => {
  // Direct guard invocation mirrors the applyOntologyOperations path.
  const existing = state.items.filter(i => i.status === 'active');
  const hallucinated: OntologyItem = fact({
    statement: 'Isabella and Marco once kissed at a college party years ago.',
  });
  const guarded = guardProvenance(hallucinated, existing, 'assistant', 'ASSISTANT_NARRATION');
  expect(guarded.item).not.toBeNull();
  expect(guarded.item?.status).not.toBe('active');
});
