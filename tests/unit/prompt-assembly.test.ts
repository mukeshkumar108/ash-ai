import { test, expect } from '@playwright/test';
import { formatActiveStateToPrompt } from '@/lib/ai/active-state';
import type { ActiveState } from '@/lib/ai/active-state';

const baseActiveState: ActiveState = {
  scene_mode: 'texting',
  location: 'Kitchen',
  time_of_day: 'Morning',
  current_activity: 'Cooking',
  primary_mood: 'Calm',
  visible_emotion: 'Calm',
  hidden_emotion: 'None',
  emotional_direction: 'stable',
  relationship_temperature: 5,
  trust_level: 5,
  affection_level: 5,
  conflict_level: 0,
  attraction_level: 5,
  need_for_reassurance: 0,
  what_they_want: 'Cook',
  what_they_are_avoiding: 'None',
  likely_next_move: 'Stir',
  current_boundary: 'None',
  tone: 'Neutral',
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

test.describe('Prompt Assembly / Actor State Prompt Injection', () => {
  test('injects ACTOR STATE block with default values when no proxy or NPCs exist', () => {
    const output = formatActiveStateToPrompt(baseActiveState, 'Elena');
    
    expect(output).toContain('[ACTIVE SCENE]');
    expect(output).toContain('NPCs=None');
    expect(output).toContain('Frame: Kitchen | Cooking | Elena + User');
  });

  test('correctly lists current user proxy and NPCs in ACTOR STATE block', () => {
    const activeState: ActiveState = {
      ...baseActiveState,
      actors: [
        { id: 'Elena', name: 'Elena', role: 'ai_character' },
        { id: 'Daniel', name: 'Daniel', role: 'user' },
        { id: 'Marco', name: 'Marco', role: 'npc' },
        { id: 'Alex', name: 'Alex', role: 'npc' }
      ],
      user_proxy: {
        current_user_proxy_actor_id: 'Daniel'
      }
    };

    const output = formatActiveStateToPrompt(activeState, 'Elena');

    expect(output).toContain('[ACTIVE SCENE]');
    expect(output).toContain('UserProxy=Daniel');
    expect(output).toContain('NPCs=Marco, Alex');
    expect(output).toContain('Frame: Kitchen | Cooking | Elena + User + Marco, Alex');
  });
});
