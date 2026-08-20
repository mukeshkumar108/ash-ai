import { expect, test } from '@playwright/test';

import { evaluateInteraction } from '@/lib/ai/interaction/judge';
import {
  compileInteractionSteer,
  resolveInteractionSteer,
} from '@/lib/ai/interaction/steer';
import type { InteractionSteer } from '@/lib/ai/interaction/types';

const sadSteer: InteractionSteer = {
  posture: 'hold',
  objective:
    'Stay close without demanding an explanation or immediately turning this into solutions. Do not interrogate.',
  strength: 'medium',
  turnsRemaining: 3,
  initiativePermission: 'high',
  expressionShape: 'short_burst',
  reason: 'The user disclosed diffuse sadness and uncertainty.',
};

test('ordinary factual request can remain unsteered', async () => {
  const decision = await evaluateInteraction({
    currentTurn: 'What is 7 × 8?',
    recentContext: '',
    existingSteer: null,
    signal: AbortSignal.timeout(1_000),
    generate: async () => ({
      action: 'none',
      interpretation: 'A direct factual request needs no relational overlay.',
      steer: null,
    }),
  });
  expect(resolveInteractionSteer(decision, null)).toBeNull();
});

test('sad disclosure can create a bounded low-pressure steer', async () => {
  const decision = await evaluateInteraction({
    currentTurn:
      'Everything feels pointless and I do not know if I am progressing.',
    recentContext: 'user: i dont know. im sad',
    existingSteer: null,
    signal: AbortSignal.timeout(1_000),
    generate: async () => ({
      action: 'start',
      interpretation:
        'An emotionally exposed moment needs presence, not an interview.',
      steer: sadSteer,
    }),
  });
  const active = resolveInteractionSteer(decision, null);
  expect(active).toEqual(sadSteer);
  const compiled = compileInteractionSteer(active!);
  expect(compiled).toContain('[INTERACTION STEER]');
  expect(compiled).toContain('Do not interrogate');
  expect(compiled.length).toBeLessThan(700);
});

test('continuing a steer consumes its short turn horizon', async () => {
  const decision = await evaluateInteraction({
    currentTurn: 'yeah, it is hard to explain',
    recentContext: '',
    existingSteer: sadSteer,
    signal: AbortSignal.timeout(1_000),
    generate: async () => ({
      action: 'continue',
      interpretation: 'The same moment is still active.',
      steer: sadSteer,
    }),
  });
  expect(resolveInteractionSteer(decision, sadSteer)?.turnsRemaining).toBe(2);
});

test('an explicit boundary immediately stops an existing steer', async () => {
  const decision = await evaluateInteraction({
    currentTurn: 'Leave me alone. Not now.',
    recentContext: '',
    existingSteer: sadSteer,
    signal: AbortSignal.timeout(1_000),
    generate: async () => ({
      action: 'stop',
      interpretation: 'The user explicitly asked for space.',
      steer: null,
    }),
  });
  expect(resolveInteractionSteer(decision, sadSteer)).toBeNull();
});

test('direct-answer preference drops a tutoring steer', async () => {
  const tutoring = { ...sadSteer, posture: 'steer' as const };
  const decision = await evaluateInteraction({
    currentTurn: 'Just give me the answer.',
    recentContext: '',
    existingSteer: tutoring,
    signal: AbortSignal.timeout(1_000),
    generate: async () => ({
      action: 'stop',
      interpretation: 'The user overrode the teaching sequence.',
      steer: null,
    }),
  });
  expect(resolveInteractionSteer(decision, tutoring)).toBeNull();
});
