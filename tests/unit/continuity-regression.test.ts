import { expect, test } from '@playwright/test';
import {
  continuityEventSchema,
  applyOntologyOperations,
  extractOntologyFromColumn,
  repairOntologyItemIds,
  selectContinuityFactsForPrompt,
  selectPeopleForPrompt,
  type OntologyItem,
  type PersonModel,
} from '@/lib/ai/continuity';

test('incident records keep objective facts separate from meaning and responsibility', () => {
  const incident = continuityEventSchema.parse({
    chatId: 'chat-1',
    turnStart: 12,
    turnEnd: 14,
    type: 'conflict',
    summary: 'A consequential incident occurred.',
    participants: ['user', 'companion', 'npc:mark'],
    entities: ['npc:mark'],
    truthStatus: 'confirmed',
    actuality: 'ACTUAL_EVENT',
    emotionalImpact: 'The user felt betrayed.',
    relationshipImpact: 'Trust was damaged.',
    importance: 95,
    unresolved: true,
    createdAt: '2026-07-30T00:00:00.000Z',
    objective_record: 'The companion kissed Mark and the user witnessed it.',
    perspectives: [
      { actor_id: 'user', meaning: 'The relationship was deprioritised.' },
      { actor_id: 'companion', meaning: 'She fears losing the relationship.' },
    ],
    responsibility: [
      { actor_id: 'companion', account: 'Responsible for participating.' },
    ],
    consequences: ['Severe rupture', 'Repair remains unresolved'],
    source_message_ids: ['message-12', 'message-13', 'message-14'],
    scene_id: 'scene-4',
  });

  expect(incident.objective_record).toContain('kissed Mark');
  expect(incident.perspectives?.[0].meaning).not.toBe(
    incident.objective_record,
  );
  expect(incident.responsibility?.[0].actor_id).toBe('companion');
});

test('people registry merges aliases and retrieves a mentioned person first', () => {
  const first = applyOntologyOperations([], [{
    operation: 'UPDATE_PERSON',
    person_model: {
      name: 'Sarah Collins',
      aliases: ['Sarah', 'my sister'],
      role: 'user sister',
      behaviour: 'studies art history',
      current_status: 'visiting tomorrow',
    },
    evidence: ['message-4'],
  }], 4);

  const second = applyOntologyOperations([], [{
    operation: 'UPDATE_PERSON',
    person_model: {
      name: 'Sarah',
      aliases: ['Sis'],
      role: 'user sister',
      behaviour: 'meeting the companion for coffee',
      linked_event_ids: ['event-coffee'],
    },
    evidence: ['message-18'],
  }], 18, first.personModels);

  expect(second.personModels).toHaveLength(1);
  expect(second.personModels[0].person_id).toBeTruthy();
  expect(second.personModels[0].aliases).toEqual(
    expect.arrayContaining(['Sarah', 'my sister', 'Sis']),
  );
  expect(second.personModels[0].evidence).toEqual(['message-4', 'message-18']);

  const other: PersonModel = {
    name: 'Mark',
    role: 'coworker',
    known_behaviours: [],
    evaluation: { respect: 50, trust: 50, safety: 50, attraction: 0 },
    trajectory: 'neutral',
    last_updated_turn: 99,
  };
  expect(
    selectPeopleForPrompt([...second.personModels, other], 'Is Sarah coming?')[0]
      .name,
  ).toBe('Sarah Collins');
});

test('person models accumulate instead of being rebuilt on each refresh', () => {
  const existing: PersonModel[] = [{
    name: 'Marco',
    role: 'friend',
    known_behaviours: ['kept a confidence'],
    evaluation: { respect: 60, trust: 70, safety: 55, attraction: 10 },
    trajectory: 'trust building',
    last_updated_turn: 4,
  }];

  const result = applyOntologyOperations([], [{
    operation: 'UPDATE_PERSON',
    person_model: {
      name: 'Marco',
      role: 'friend',
      behaviour: 'showed up when asked',
      evaluation_delta: { trust: 5 },
    },
  }], 8, existing);

  expect(result.personModels).toHaveLength(1);
  expect(result.personModels[0].known_behaviours).toEqual([
    'kept a confidence',
    'showed up when asked',
  ]);
  expect(result.personModels[0].evaluation.trust).toBe(75);
});

test('v2 continuity wrapper exposes events as well as ontology state', () => {
  const parsed = extractOntologyFromColumn({
    _v: '2',
    items: [],
    relationship: { durable_bond: { attachment: 70 } },
    personModels: [],
    events: [{ id: 'event-1', summary: 'A concrete incident' }],
  });

  expect(parsed?.events).toHaveLength(1);
  expect(parsed?.relationship.durable_bond.attachment).toBe(70);
});

test('important durable facts survive prompt selection when newer trivia accumulates', () => {
  const important: OntologyItem = {
    id: 'important',
    type: 'fact',
    statement: 'A relationship-changing incident happened',
    scope: 'durable',
    perspective: 'objective',
    status: 'active',
    confidence: 1,
    evidence: [],
    created_turn: 1,
    last_updated_turn: 1,
    significance: 'high',
    weight: 'irreversible',
  };
  const trivia: OntologyItem[] = Array.from({ length: 10 }, (_, index) => ({
    ...important,
    id: `scene-${index}`,
    statement: `Scene detail ${index}`,
    scope: 'scene',
    significance: 'low',
    weight: 'ordinary',
    created_turn: index + 2,
    last_updated_turn: index + 2,
  }));

  expect(selectContinuityFactsForPrompt([important, ...trivia], 3))
    .toContainEqual(important);
});

test('repairs runaway model-generated IDs and their references', () => {
  const runawayId = `scene-frame-${'_1'.repeat(3000)}`;
  const items: OntologyItem[] = [{
    id: runawayId,
    type: 'scene_frame',
    statement: 'The scene moved to the kitchen',
    scope: 'scene',
    perspective: 'objective',
    status: 'active',
    confidence: 1,
    evidence: [],
    supersedes: [runawayId],
    created_turn: 2,
    last_updated_turn: 2,
  }];

  const [repaired] = repairOntologyItemIds(items);

  expect(repaired.id?.length).toBeLessThanOrEqual(96);
  expect(repaired.id).not.toContain('_1_1_1');
  expect(repaired.supersedes).toEqual([repaired.id]);
});

test('new ontology IDs are server-owned even if an operation supplies one', () => {
  const result = applyOntologyOperations([], [{
    operation: 'ADD',
    item: {
      id: `model-${'x'.repeat(5000)}`,
      type: 'fact',
      statement: 'A concrete event happened',
      scope: 'durable',
      perspective: 'objective',
      status: 'active',
      confidence: 1,
      evidence: [],
      created_turn: 0,
      last_updated_turn: 0,
    },
  }], 3);

  expect(result.items[0].id?.length).toBeLessThanOrEqual(96);
  expect(result.items[0].id).not.toContain('model-');
});
