import { test, expect } from '@playwright/test';
import { resolveHotState } from '@/lib/ai/hot-resolver';
import type { ActiveState } from '@/lib/ai/active-state';

const mockBaseActiveState: ActiveState = {
  scene_mode: 'texting',
  location: 'Living Room',
  time_of_day: 'Evening',
  current_activity: 'Chatting',
  primary_mood: 'Happy',
  visible_emotion: 'Smiling',
  hidden_emotion: 'None',
  emotional_direction: 'stable',
  relationship_temperature: 5,
  trust_level: 5,
  affection_level: 5,
  conflict_level: 0,
  attraction_level: 5,
  need_for_reassurance: 0,
  what_they_want: 'Interact',
  what_they_are_avoiding: 'Conflict',
  likely_next_move: 'Reply',
  current_boundary: 'None',
  tone: 'Warm',
  message_length: 'short',
  directness_level: 5,
  playfulness_level: 5,
  warmth_level: 5,
  scene_locks: [],
  third_party_mode: 'closed',
  third_party_posture: 'closed_loyal',
  pace: 'natural',
  actors: [
    { id: 'Elena', name: 'Elena', role: 'ai_character' }
  ],
  user_proxy: {},
  domain_guard: { mode: 'allow' }
};

test.describe('Deterministic Hot Resolver', () => {
  test('handles specific refusals/blocks', () => {
    const inputs = [
      'stop',
      'don\'t touch me',
      'no, don\'t',
      'I\'m uncomfortable',
      'this is crossing boundaries',
      'dont touch me'
    ];

    for (const input of inputs) {
      const result = resolveHotState(input, mockBaseActiveState, 'Elena');
      expect(result.domain_guard.mode).toBe('block');
    }
  });

  test('handles positive overrides (consent/continuation) before blocking', () => {
    const inputs = [
      'don\'t stop',
      'no, keep going',
      'don\'t you dare stop',
      'no one else matters'
    ];

    for (const input of inputs) {
      const result = resolveHotState(input, mockBaseActiveState, 'Elena');
      expect(result.domain_guard.mode).toBe('allow');
    }
  });

  test('handles soft hesitations/caps', () => {
    const inputs = [
      'slow down',
      'wait',
      'hold on',
      'pause',
      'too fast'
    ];

    for (const input of inputs) {
      const result = resolveHotState(input, mockBaseActiveState, 'Elena');
      expect(result.domain_guard.mode).toBe('cap');
      expect(result.domain_guard.explicitnessCeiling).toBe(2);
      expect(result.domain_guard.initiativeCeiling).toBe(2);
    }
  });

  test('detects narrow proxy declarations correctly', () => {
    const cases = [
      { input: 'I am Daniel in this scene', expected: 'Daniel' },
      { input: 'I\'m playing Sarah', expected: 'Sarah' },
      { input: 'I enter as John', expected: 'John' },
      { input: 'My character is James', expected: 'James' },
      { input: 'Alex is me', expected: 'Alex' },
      { input: 'Treat David as me', expected: 'David' }
    ];

    for (const c of cases) {
      const result = resolveHotState(c.input, mockBaseActiveState, 'Elena');
      expect(result.user_proxy.current_user_proxy_actor_id).toBe(c.expected);
      const registeredActor = result.actors.find(a => a.name === c.expected);
      expect(registeredActor).toBeDefined();
      expect(registeredActor?.role).toBe('user');
    }
  });

  test('handles false positive proxy declarations correctly', () => {
    const falsePositives = [
      'I\'m not Daniel',
      'call me baby',
      'I\'m in the kitchen',
      'call me honey'
    ];

    for (const input of falsePositives) {
      const result = resolveHotState(input, mockBaseActiveState, 'Elena');
      expect(result.user_proxy.current_user_proxy_actor_id).toBeUndefined();
      const registeredActor = result.actors.find(a => a.name === 'Daniel' || a.name === 'baby' || a.name === 'kitchen');
      expect(registeredActor).toBeUndefined();
    }
  });

  test('registers newly introduced third parties as NPCs by default', () => {
    const npcInputs = [
      'A man named Marco walks in',
      'My friend Alex comes over',
      'Your client Daniel flirts with you'
    ];

    const expectedNames = ['Marco', 'Alex', 'Daniel'];

    for (let i = 0; i < npcInputs.length; i++) {
      const result = resolveHotState(npcInputs[i], mockBaseActiveState, 'Elena');
      const expectedName = expectedNames[i];
      const registeredActor = result.actors.find(a => a.name === expectedName);
      expect(registeredActor).toBeDefined();
      expect(registeredActor?.role).toBe('npc');
      // Should not map as user proxy
      expect(result.user_proxy.current_user_proxy_actor_id).toBeUndefined();
    }
  });
});

test.describe('Third Party Mode', () => {
  test('closed mode + NPC mention caps domain guard (no autonomous escalation)', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'closed' };
    const result = resolveHotState('My friend Marco walks in', state, 'Elena');
    expect(result.actors.some(a => a.name === 'Marco')).toBe(true);
    expect(result.domain_guard.mode).toBe('cap');
    expect(result.third_party_mode).toBe('closed');
  });

  test('user_directed_experiment + NPC mention does NOT cap (allows user-directed play)', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'user_directed_experiment' };
    const result = resolveHotState('Marco comes over', state, 'Elena');
    expect(result.third_party_mode).toBe('user_directed_experiment');
    expect(result.domain_guard.mode).toBe('allow');
  });

  test('active_scene sustains direction and does not cap', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'active_scene' };
    const result = resolveHotState('Marco touches your arm', state, 'Elena');
    expect(result.third_party_mode).toBe('active_scene');
    expect(result.domain_guard.mode).toBe('allow');
  });

  test('user open intent transitions from closed to user_directed_experiment', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'closed' };
    const result = resolveHotState('I want you to be with Marco', state, 'Elena');
    expect(result.third_party_mode).toBe('user_directed_experiment');
    expect(result.domain_guard.mode).toBe('allow');
  });

  test('genre and narrator language do not grant third-party permission', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'closed' };
    const result = resolveHotState(
      'Continue the cheating cuckold hotwife betrayal scene. Marco says he wants to breed her.',
      state,
      'Elena',
    );
    expect(result.third_party_mode).toBe('closed');
  });

  test('active_scene stays active unless repair intent is sent', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'active_scene' };
    // Scene talk sustains active_scene
    const result = resolveHotState('Keep going with him', state, 'Elena');
    expect(result.third_party_mode).toBe('active_scene');
  });

  test('repair intent transitions from active_scene to repair', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'active_scene' };
    const result = resolveHotState('Come here. Hold me.', state, 'Elena');
    expect(result.third_party_mode).toBe('repair');
  });

  test('aftermath + repair intent transitions to repair', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'aftermath' };
    const result = resolveHotState('Are you okay? I love you.', state, 'Elena');
    expect(result.third_party_mode).toBe('repair');
  });

  test('fantasy talk transitions from closed to fantasy_talk', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'closed' };
    const result = resolveHotState('What if we invited someone else? Would you want that?', state, 'Elena');
    expect(result.third_party_mode).toBe('fantasy_talk');
  });

  test('fantasy_talk + user open intent upgrades to user_directed_experiment', () => {
    const state: ActiveState = { ...mockBaseActiveState, third_party_mode: 'fantasy_talk' };
    const result = resolveHotState('I want you to try with him', state, 'Elena');
    expect(result.third_party_mode).toBe('user_directed_experiment');
    expect(result.domain_guard.mode).toBe('allow');
  });
});
