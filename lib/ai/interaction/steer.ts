import type { ChatMessage } from '@/lib/types';
import {
  interactionSteerSchema,
  type InteractionJudgment,
  type InteractionSteer,
} from './types';

export function latestInteractionSteer(
  messages: ChatMessage[],
): InteractionSteer | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    const part = message.parts.find(
      (candidate) => candidate.type === 'data-interactionSteer',
    );
    if (!part || part.type !== 'data-interactionSteer') return null;
    const parsed = interactionSteerSchema.safeParse(part.data);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function resolveInteractionSteer(
  judgment: InteractionJudgment,
  existing: InteractionSteer | null,
): InteractionSteer | null {
  if (judgment.action === 'stop' || judgment.action === 'none') return null;
  if (judgment.action === 'start') return judgment.steer;
  if (!existing) return judgment.steer;
  const next = judgment.steer ?? existing;
  const turnsRemaining = Math.min(
    next.turnsRemaining,
    Math.max(0, existing.turnsRemaining - 1),
  );
  return turnsRemaining > 0 ? { ...next, turnsRemaining } : null;
}

export function compileInteractionSteer(steer: InteractionSteer): string {
  return [
    '[INTERACTION STEER]',
    `Posture: ${steer.posture.toUpperCase()}.`,
    steer.objective,
    steer.strength === 'light'
      ? 'Use this as a light orientation, not a script.'
      : steer.strength === 'strong'
        ? 'Take clear initiative while respecting explicit user boundaries.'
        : 'Let this guide the next conversational move without forcing an outcome.',
    steer.expressionShape === 'single'
      ? ''
      : `Expression may be a ${steer.expressionShape === 'short_burst' ? 'short burst of 2–3 natural bubbles' : 'brief expressive burst of 3–6 natural bubbles'} when that genuinely fits; do not chop one paragraph mechanically.`,
  ]
    .filter(Boolean)
    .join('\n');
}
