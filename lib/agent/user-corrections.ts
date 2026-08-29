import { createHash } from 'node:crypto';

export type UserCorrection = {
  id: string;
  instruction: string;
  createdAt: string;
  sourceTurnId: string;
};

// Deliberately narrow: only direct instructions governing Sophie's future
// conversational behaviour. Factual corrections continue through the normal
// memory/continuity authorities rather than being guessed from every "no".
const DIRECT_BEHAVIOR_CORRECTION = /^(?:sophie[,:]?\s*)?(?:(?:please|pls)\s+)?(?:(?:do\s+not|don't|never)\s+(?:ask\s+me|tell\s+me|call\s+me|say|suggest|recommend|bring\s+up|mention|assume|mirror|repeat|lecture|patroni[sz]e)|stop\s+(?:asking|telling|calling|saying|suggesting|recommending|bringing\s+up|mentioning|assuming|mirroring|repeating|lecturing|patroni[sz]ing)|(?:i\s+do\s+not|i\s+don't)\s+want\s+you\s+to)\b/iu;

export function extractBehaviorCorrection({
  text,
  sourceTurnId,
  now = new Date(),
}: {
  text: string;
  sourceTurnId: string;
  now?: Date;
}): UserCorrection | null {
  const instruction = text.replace(/\s+/gu, ' ').trim();
  if (!instruction || instruction.length > 500 || !DIRECT_BEHAVIOR_CORRECTION.test(instruction)) {
    return null;
  }
  const id = createHash('sha256').update(instruction.toLocaleLowerCase()).digest('hex').slice(0, 16);
  return { id, instruction, createdAt: now.toISOString(), sourceTurnId };
}

export function mergeBehaviorCorrections(
  existing: unknown,
  incoming: UserCorrection | null,
): UserCorrection[] {
  const valid = Array.isArray(existing)
    ? existing.filter((item): item is UserCorrection => Boolean(
        item && typeof item === 'object' && typeof item.id === 'string' &&
        typeof item.instruction === 'string' && typeof item.createdAt === 'string' &&
        typeof item.sourceTurnId === 'string',
      ))
    : [];
  if (!incoming) return valid.slice(-8);
  return [...valid.filter((item) => item.id !== incoming.id), incoming].slice(-8);
}
