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
  if (judgment.action === 'stop') return null;
  if (judgment.action === 'start' || judgment.action === 'replace')
    return judgment.steer;
  if (!existing) return judgment.steer;
  // NONE means no new intervention. It must not silently erase an already
  // active conversational intention. The existing phase still consumes one
  // turn of its bounded horizon.
  if (judgment.action === 'none') {
    const turnsRemaining = Math.max(0, existing.turnsRemaining - 1);
    return turnsRemaining > 0 ? { ...existing, turnsRemaining } : null;
  }
  const next = judgment.steer ?? existing;
  const turnsRemaining = Math.min(
    next.turnsRemaining,
    Math.max(0, existing.turnsRemaining - 1),
  );
  return turnsRemaining > 0 ? { ...next, turnsRemaining } : null;
}

export function compileInteractionSteer(steer: InteractionSteer): string {
  const phaseContract = steer.phase
    ? {
        excavate: [
          'Active phase: EXCAVATE.',
          'Make one precise conversational move: react briefly, surface one tension, hidden assumption, or contradiction, then ask one sharp consequential question and stop.',
          'Do not solve, stack questions, paraphrase the user at length, or repeat the previous probe. Let the next beat belong to the user.',
        ],
        witness: [
          'Active phase: WITNESS.',
          'Stay alongside the concrete moment. Be relatively short. Do not solve, manufacture a hidden meaning, or force movement.',
          'A question is optional, not expected. Make room while remaining warm and present.',
        ],
        curiosity: [
          'Active phase: CURIOSITY.',
          'Follow one specific thing Sophie genuinely finds interesting. React and contribute something of your own as well as inviting the user onward.',
          'Do not interview, stack generic questions, or repeat the last tactic. A question is not required on every turn.',
        ],
      }[steer.phase]
    : [];
  return [
    '[INTERACTION STEER]',
    `Posture: ${steer.posture.toUpperCase()}.`,
    ...phaseContract,
    steer.objective,
    steer.lastTactic
      ? `Previous phase tactic: ${steer.lastTactic} Vary the next move rather than repeating it.`
      : '',
    steer.strength === 'light'
      ? 'Use this as a light orientation, not a script.'
      : steer.strength === 'strong'
        ? 'Take clear initiative while respecting explicit user boundaries.'
        : 'Let this guide the next conversational move without forcing an outcome.',
    steer.expressionShape === 'single'
      ? ''
      : `Expression may be a ${steer.expressionShape === 'short_burst' ? 'short burst of 2–3 natural bubbles' : 'brief expressive burst of 3–6 natural bubbles'} when that genuinely fits; do not chop one paragraph mechanically.`,
    steer.phase
      ? 'Default to one natural conversational move, not a complete treatment of the subject. Trust that another beat can follow.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
