import type { InitiativeDecision, InitiativeTrigger } from './types';

export const INITIATIVE_POLICY = {
  idleMs: Number(process.env.RELATIONSHIP_IDLE_MS ?? 5 * 60_000),
  postTurnDelayMs: Number(process.env.RELATIONSHIP_POST_TURN_DELAY_MS ?? 2_800),
  dailyLimit: Number(process.env.RELATIONSHIP_DAILY_LIMIT ?? 8),
  idleDailyLimit: Number(process.env.RELATIONSHIP_IDLE_DAILY_LIMIT ?? 4),
  firstUnansweredFollowUpMinMs: Number(
    process.env.RELATIONSHIP_FIRST_UNANSWERED_FOLLOWUP_MIN_MS ?? 25 * 60_000,
  ),
  firstUnansweredFollowUpJitterMs: Number(
    process.env.RELATIONSHIP_FIRST_UNANSWERED_FOLLOWUP_JITTER_MS ?? 50 * 60_000,
  ),
  maxUnanswered: Number(process.env.RELATIONSHIP_MAX_UNANSWERED ?? 2),
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
  idleDailyCount?: number;
  unansweredCount: number;
  msSinceLatestUnanswered?: number | null;
  requiredUnansweredGapMs?: number;
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
  if (
    input.trigger === 'active_idle' &&
    (input.idleDailyCount ?? 0) >= INITIATIVE_POLICY.idleDailyLimit
  )
    return 'idle_daily_limit';
  if (input.unansweredCount >= INITIATIVE_POLICY.maxUnanswered)
    return 'unanswered_limit';
  if (
    input.unansweredCount === 1 &&
    (input.msSinceLatestUnanswered ?? 0) <
      (input.requiredUnansweredGapMs ??
        INITIATIVE_POLICY.firstUnansweredFollowUpMinMs)
  )
    return 'unanswered_followup_too_soon';
  return null;
}

export function unansweredFollowUpDelayMs(anchorMessageId: string) {
  let hash = 0;
  for (const character of anchorMessageId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return (
    INITIATIVE_POLICY.firstUnansweredFollowUpMinMs +
    (hash % Math.max(1, INITIATIVE_POLICY.firstUnansweredFollowUpJitterMs))
  );
}

export function hasRecentDepartureSignal(conversation: string) {
  const latestUser = conversation
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('user:'))
    ?.slice(5)
    .trim()
    .toLowerCase();
  if (!latestUser) return false;
  if (
    /\b(?:no|don't)\s+(?:go|leave)|\b(?:stay|keep talking|talk to me|speak to me)\b/u.test(
      latestUser,
    )
  )
    return false;
  return /\b(?:gotta go|got to go|have to go|going to bed|off to bed|good ?night|talk later|speak later|catch you later|i(?:'m| am) going to sleep)\b/u.test(
    latestUser,
  );
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
