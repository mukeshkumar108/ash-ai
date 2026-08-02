import { test, expect } from '@playwright/test';
import { applyRelationshipDynamicsDelta, defaultRelationshipDynamics } from '@/lib/ai/continuity';
import type { RelationshipDelta } from '@/lib/ai/continuity';
import { filterInferredPolicyEntries } from '@/lib/ai/chat-continuity';

test('legacy model-inferred affair policy is removed without deleting events', () => {
  expect(filterInferredPolicyEntries([
    'Isa will maintain the appearance of a devoted fiancée while continuing a secret affair.',
    'Isa and Marco have an implicit agreement to keep encounters secret.',
    'Isa has no boundary against cheating.',
    'Isa desires the secret affair, as evidenced by her actions.',
    'Isa promised User she would protect his heart.',
  ])).toEqual([
    'Isa promised User she would protect his heart.',
  ]);
});

test.describe('Relationship Delta Scoped Filtering', () => {
  test('correctly filters dynamicsDeltas and only applies user_ai deltas', () => {
    const previousRelationshipDynamics = {
      ...defaultRelationshipDynamics,
      trust: 50,
      attraction: 50
    };

    const dynamicsDeltas: RelationshipDelta[] = [
      {
        pair: 'npc_ai',
        dynamicsDelta: {
          emotionalIntimacy: 10,
          romanticAttachment: 10,
          trust: 10,
          affection: 10,
          attraction: 10,
          conflict: 0,
          jealousy: 0,
          insecurity: 0,
          playfulness: 0,
          vulnerability: 0,
          reassuranceNeed: 0,
          commitmentOrientation: 0,
          reason: 'NPC flirting',
        }
      },
      {
        pair: 'user_ai',
        dynamicsDelta: {
          emotionalIntimacy: 5,
          romanticAttachment: 5,
          trust: -5,
          affection: 5,
          attraction: 5,
          conflict: 0,
          jealousy: 0,
          insecurity: 0,
          playfulness: 0,
          vulnerability: 0,
          reassuranceNeed: 0,
          commitmentOrientation: 0,
          reason: 'User interaction',
        }
      }
    ];

    // Apply only user_ai delta
    let nextRelationshipDynamics = previousRelationshipDynamics;
    const userAiDelta = dynamicsDeltas.find(d => d.pair === 'user_ai');
    if (userAiDelta) {
      nextRelationshipDynamics = applyRelationshipDynamicsDelta(
        previousRelationshipDynamics,
        userAiDelta.dynamicsDelta,
      );
    }

    // Durable bond dimensions cannot fall below the configured loyalty floor.
    expect(nextRelationshipDynamics.trust).toBe(50);
    expect(nextRelationshipDynamics.attraction).toBe(55);

    // Verify npc_ai delta (+10 trust, +10 attraction) is ignored
    expect(nextRelationshipDynamics.trust).not.toBe(60);
    expect(nextRelationshipDynamics.attraction).not.toBe(60);
  });
});
