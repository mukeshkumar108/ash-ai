import type { InitiativeDecision, InitiativeTrigger } from './types';

export const INITIATIVE_POLICY = {
  idleMs: Number(process.env.RELATIONSHIP_IDLE_MS ?? 5 * 60_000),
  postTurnDelayMs: Number(process.env.RELATIONSHIP_POST_TURN_DELAY_MS ?? 2_800),
  dailyLimit: Number(process.env.RELATIONSHIP_DAILY_LIMIT ?? 3),
  unansweredCooldownMs: Number(
    process.env.RELATIONSHIP_UNANSWERED_COOLDOWN_MS ?? 12 * 60 * 60_000,
  ),
} as const;

export function mayUseDecision(input: {
  decision: InitiativeDecision;
  trigger: InitiativeTrigger;
  recentTopicKeys: string[];
  hasSensitiveSupport: boolean;
}) {
  if (!input.decision.act) return false;
  if (!input.decision.guidance?.trim()) return false;
  if (input.recentTopicKeys.includes(input.decision.topicKey)) return false;
  if (input.decision.sensitive && !input.hasSensitiveSupport) return false;
  return true;
}

export function enforceSingleQuestion(text: string) {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 420) return null;
  const questionCount = (clean.match(/\?/gu) ?? []).length;
  return questionCount <= 1 ? clean : null;
}

export function initiativeDedupeKey(input: {
  userId: string;
  chatId: string;
  trigger: InitiativeTrigger;
  anchorMessageId: string;
}) {
  return `${input.userId}:${input.chatId}:${input.trigger}:${input.anchorMessageId}`;
}

export function checkInitiativeEligibility(input: {
  trigger: InitiativeTrigger;
  anchorMessageId: string;
  latestMessageId: string | null;
  latestRole: string | null;
  idleForMs: number;
  dailyCount: number;
  hasRecentUnanswered: boolean;
}) {
  if (input.latestMessageId !== input.anchorMessageId)
    return 'conversation_changed';
  if (input.latestRole !== 'assistant') return 'latest_message_not_assistant';
  if (
    input.trigger === 'active_idle' &&
    input.idleForMs < INITIATIVE_POLICY.idleMs - 5_000
  )
    return 'not_idle_long_enough';
  if (input.dailyCount >= INITIATIVE_POLICY.dailyLimit) return 'daily_limit';
  if (input.hasRecentUnanswered) return 'recent_unanswered_initiative';
  return null;
}

export function canonicalInitiativeMessage(input: {
  id: string;
  chatId: string;
  text: string;
  createdAt: Date;
}) {
  return {
    id: input.id,
    chatId: input.chatId,
    role: 'assistant' as const,
    parts: [{ type: 'text' as const, text: input.text }],
    attachments: [],
    createdAt: input.createdAt,
  };
}
