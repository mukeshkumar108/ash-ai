import { expect, test } from '@playwright/test';

import { resolveInteractionSteer } from '@/lib/ai/interaction/steer';
import type {
  InteractionJudgment,
  InteractionSteer,
} from '@/lib/ai/interaction/types';

const curiosity: InteractionSteer = {
  posture: 'ask',
  phase: 'curiosity',
  objective: 'Understand what making things gives the user beyond achievement.',
  strength: 'medium',
  turnsRemaining: 4,
  initiativePermission: 'medium',
  expressionShape: 'single',
  reason: 'The user opened a meaningful personal thread.',
  lastTactic: 'Asked which part of the project felt most alive.',
};

function apply(
  state: InteractionSteer | null,
  ...judgments: InteractionJudgment[]
) {
  return judgments.reduce<InteractionSteer | null>(
    (current, judgment) => resolveInteractionSteer(judgment, current),
    state,
  );
}

test('trajectory: curiosity survives an ordinary low-signal reply', () => {
  const state = apply(curiosity, {
    action: 'none',
    interpretation: 'No new intervention is needed.',
    steer: null,
  });
  expect(state).toMatchObject({ phase: 'curiosity', turnsRemaining: 3 });
});

test('trajectory: failed question tactic adapts without dropping curiosity', () => {
  const state = apply(curiosity, {
    action: 'adapt',
    interpretation: 'Another question would feel like an interview.',
    steer: {
      ...curiosity,
      posture: 'expand',
      lastTactic: 'Contribute a tentative observation and leave room.',
    },
  });
  expect(state).toMatchObject({
    phase: 'curiosity',
    posture: 'expand',
    turnsRemaining: 3,
  });
});

test('trajectory: explicit question boundary stops the active phase', () => {
  const state = apply(curiosity, {
    action: 'stop',
    interpretation: 'The user asked Sophie to stop asking questions.',
    steer: null,
  });
  expect(state).toBeNull();
});

test('trajectory: stronger emotional need can replace curiosity with witness', () => {
  const witness: InteractionSteer = {
    ...curiosity,
    posture: 'hold',
    phase: 'witness',
    objective: 'Stay alongside the loss without moving into explanation.',
    initiativePermission: 'low',
    reason: 'The user disclosed something painful.',
    lastTactic: null,
  };
  const state = apply(curiosity, {
    action: 'replace',
    interpretation: 'The disclosure supersedes the lighter curiosity.',
    steer: witness,
  });
  expect(state).toMatchObject({ phase: 'witness', turnsRemaining: 4 });
});

test('negative control: ordinary factual turn starts no phase', () => {
  const state = apply(null, {
    action: 'none',
    interpretation: 'A direct answer is the whole job.',
    steer: null,
  });
  expect(state).toBeNull();
});
