import { test, expect } from '@playwright/test';
import { derivePromptDomainState } from '@/lib/ai/prompt-domains';
import type { Character } from '@/lib/ai/characters';
import type { StructuredMemory } from '@/lib/ai/summarizer';
import type { ActiveState } from '@/lib/ai/active-state';
import type { RelationshipDynamics } from '@/lib/ai/continuity';

const mockCharacter: Character = {
  id: 'elena-voss',
  name: 'Elena Voss',
  avatar: '/images/elena.svg',
  description: 'Elena Voss mock',
  greeting: 'Hello',
};

const mockMemory: StructuredMemory = {
  summary: 'Summary',
  core_facts: [],
  relationship_milestones: [],
  major_events: [],
  emotional_turns: [],
  promises_and_commitments: [],
  relationship_state: 'State',
  emotional_state: 'State',
  user_preferences: { emotional: [], sexual: [] },
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
  active_desires: ['sex', 'touch', 'fuck'], // Set desires to push baseline levels up
  fantasy_themes: ['dirty'],
  corruption_level: 0,
  open_emotional_threads: [],
  resolved_threads: [],
  recent_scene_recap: 'Recap',
  metadata: { confidence: 1, extractedAt: new Date() },
};

const mockDynamics: RelationshipDynamics = {
  emotionalIntimacy: 80,
  romanticAttachment: 80,
  trust: 85,
  affection: 80,
  attraction: 90,
  conflict: 0,
  jealousy: 0,
  insecurity: 0,
  playfulness: 80,
  vulnerability: 80,
  reassuranceNeed: 0,
  commitmentOrientation: 80,
};

test.describe('Domain Guard Capping & Blocking', () => {
  test('unconstrained derivation produces high scores when desires/stats are elevated', () => {
    const activeState: ActiveState = {
      scene_mode: 'intimate',
      location: 'Room',
      time_of_day: 'Night',
      current_activity: 'Intimacy',
      primary_mood: 'Aroused',
      visible_emotion: 'Aroused',
      hidden_emotion: 'None',
      emotional_direction: 'stable',
      relationship_temperature: 9,
      trust_level: 8,
      affection_level: 8,
      conflict_level: 0,
      attraction_level: 9,
      need_for_reassurance: 0,
      what_they_want: 'Intimacy',
      what_they_are_avoiding: 'None',
      likely_next_move: 'Closer',
      current_boundary: 'None',
      tone: 'Warm',
      message_length: 'short',
      directness_level: 8,
      playfulness_level: 8,
      warmth_level: 8,
      scene_locks: [],
      third_party_mode: 'closed',
  third_party_posture: 'closed_loyal',
      pace: 'natural',
      actors: [],
      user_proxy: {
        current_user_proxy_actor_id: undefined,
      },
      domain_guard: { mode: 'allow' },
    };

    const domainState = derivePromptDomainState({
      character: mockCharacter,
      memory: mockMemory,
      activeState,
      relationshipDynamics: mockDynamics,
    });

    // Make sure unconstrained scores are high
    expect(domainState.current.horniness).toBeGreaterThan(2);
    expect(domainState.current.filth).toBeGreaterThan(2);
    expect(domainState.current.boldness).toBeGreaterThan(2);
  });

  test('block mode overrides horniness, filth, and boldness to 1', () => {
    const activeState: ActiveState = {
      scene_mode: 'intimate',
      location: 'Room',
      time_of_day: 'Night',
      current_activity: 'Intimacy',
      primary_mood: 'Aroused',
      visible_emotion: 'Aroused',
      hidden_emotion: 'None',
      emotional_direction: 'stable',
      relationship_temperature: 9,
      trust_level: 8,
      affection_level: 8,
      conflict_level: 0,
      attraction_level: 9,
      need_for_reassurance: 0,
      what_they_want: 'Intimacy',
      what_they_are_avoiding: 'None',
      likely_next_move: 'Closer',
      current_boundary: 'None',
      tone: 'Warm',
      message_length: 'short',
      directness_level: 8,
      playfulness_level: 8,
      warmth_level: 8,
      scene_locks: [],
      third_party_mode: 'closed',
  third_party_posture: 'closed_loyal',
      pace: 'natural',
      actors: [],
      user_proxy: {},
      domain_guard: { mode: 'block' }, // block
    };

    const domainState = derivePromptDomainState({
      character: mockCharacter,
      memory: mockMemory,
      activeState,
      relationshipDynamics: mockDynamics,
    });

    expect(domainState.current.horniness).toBe(1);
    expect(domainState.current.filth).toBe(1);
    expect(domainState.current.boldness).toBe(1);
  });

  test('cap mode clamps horniness, filth, and boldness to defined ceilings', () => {
    const activeState: ActiveState = {
      scene_mode: 'intimate',
      location: 'Room',
      time_of_day: 'Night',
      current_activity: 'Intimacy',
      primary_mood: 'Aroused',
      visible_emotion: 'Aroused',
      hidden_emotion: 'None',
      emotional_direction: 'stable',
      relationship_temperature: 9,
      trust_level: 8,
      affection_level: 8,
      conflict_level: 0,
      attraction_level: 9,
      need_for_reassurance: 0,
      what_they_want: 'Intimacy',
      what_they_are_avoiding: 'None',
      likely_next_move: 'Closer',
      current_boundary: 'None',
      tone: 'Warm',
      message_length: 'short',
      directness_level: 8,
      playfulness_level: 8,
      warmth_level: 8,
      scene_locks: [],
      third_party_mode: 'closed',
  third_party_posture: 'closed_loyal',
      pace: 'natural',
      actors: [],
      user_proxy: {},
      domain_guard: {
        mode: 'cap',
        explicitnessCeiling: 2,
        initiativeCeiling: 2,
      },
    };

    const domainState = derivePromptDomainState({
      character: mockCharacter,
      memory: mockMemory,
      activeState,
      relationshipDynamics: mockDynamics,
    });

    expect(domainState.current.horniness).toBeLessThanOrEqual(2);
    expect(domainState.current.filth).toBeLessThanOrEqual(2);
    expect(domainState.current.boldness).toBeLessThanOrEqual(2);
  });
});
