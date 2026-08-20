import type { InitiativeDecision, InitiativeTrigger } from './types';
import { repeatsRecentlyAddressedTopic } from './continuity';
import type { InteractionSteer } from '@/lib/ai/interaction/types';

export const INITIATIVE_POLICY = {
  idleMs: Number(process.env.RELATIONSHIP_IDLE_MS ?? 5 * 60_000),
  secondThoughtMs: Number(process.env.RELATIONSHIP_SECOND_THOUGHT_MS ?? 90_000),
  // Emergency runaway ceilings, not target relationship cadence.
  dailyLimit: Number(process.env.RELATIONSHIP_DAILY_LIMIT ?? 24),
  idleDailyLimit: Number(process.env.RELATIONSHIP_IDLE_DAILY_LIMIT ?? 16),
  firstUnansweredFollowUpMinMs: Number(
    process.env.RELATIONSHIP_FIRST_UNANSWERED_FOLLOWUP_MIN_MS ?? 25 * 60_000,
  ),
  firstUnansweredFollowUpJitterMs: Number(
    process.env.RELATIONSHIP_FIRST_UNANSWERED_FOLLOWUP_JITTER_MS ?? 50 * 60_000,
  ),
  maxUnanswered: Number(process.env.RELATIONSHIP_MAX_UNANSWERED ?? 2),
} as const;

export function initiativeOpportunityForSteer(
  steer: InteractionSteer | null,
  createdAt: Date,
) {
  const trigger =
    steer?.initiativePermission && steer.initiativePermission !== 'none'
      ? ('second_thought' as const)
      : ('active_idle' as const);
  const delayMs =
    trigger === 'second_thought'
      ? INITIATIVE_POLICY.secondThoughtMs
      : INITIATIVE_POLICY.idleMs;
  return {
    trigger,
    notBefore: new Date(createdAt.getTime() + delayMs),
  };
}

export function mayUseDecision(input: {
  decision: InitiativeDecision;
  trigger: InitiativeTrigger;
  recentTopicKeys: string[];
  hasSensitiveSupport: boolean;
  recentlyAddressedTopics?: string[];
  explicitlyInvitedFollowUp?: boolean;
}) {
  return decisionPolicyRejection(input) === null;
}

export function decisionPolicyRejection(input: {
  decision: InitiativeDecision;
  trigger: InitiativeTrigger;
  recentTopicKeys: string[];
  hasSensitiveSupport: boolean;
  recentlyAddressedTopics?: string[];
  explicitlyInvitedFollowUp?: boolean;
}) {
  if (!input.decision.act) return 'no_action';
  if (
    input.decision.conversationState.confidence >= 0.7 &&
    ['closing', 'paused', 'busy'].includes(
      input.decision.conversationState.signal,
    ) &&
    !(
      input.explicitlyInvitedFollowUp &&
      input.decision.conversationState.signal === 'paused'
    )
  )
    return 'conversation_boundary';
  if (!input.decision.guidance?.trim()) return 'missing_guidance';
  if (
    input.decision.beatAssessment.previousBeat.awaitingResponse &&
    (input.decision.beatAssessment.proposedBeat.relationToPrevious ===
      'repeats' ||
      !input.decision.beatAssessment.proposedBeat.addsNewValue)
  )
    return 'repeated_unanswered_beat';
  if (
    input.decision.posture === 'hold' &&
    (!input.decision.holdJustification?.trim() ||
      input.decision.postureConfidence < 0.7)
  )
    return 'unjustified_hold';
  if (
    input.decision.posture === 'nudge' &&
    (input.decision.postureConfidence < 0.8 ||
      !input.decision.nudgeJustification?.trim() ||
      input.decision.evidence.length === 0)
  )
    return 'unjustified_nudge';
  if (input.recentTopicKeys.includes(input.decision.topicKey))
    return 'repeated_topic';
  if (
    repeatsRecentlyAddressedTopic(
      `${input.decision.topicKey} ${input.decision.beatAssessment.proposedBeat.summary} ${input.decision.guidance ?? ''}`,
      input.recentlyAddressedTopics ?? [],
    )
  )
    return 'recently_addressed_topic';
  if (input.decision.sensitive && !input.hasSensitiveSupport)
    return 'unsupported_sensitive_topic';
  return null;
}

export function validateInitiativeText(text: string) {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 420) return null;
  return clean;
}

export function initiativeDedupeKey(input: {
  userId: string;
  chatId: string;
  trigger: InitiativeTrigger;
  anchorMessageId: string;
  dedupeScopeKey?: string;
}) {
  if (input.dedupeScopeKey)
    return `${input.userId}:ambient:${input.dedupeScopeKey}`;
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
  const requiredIdleMs =
    input.trigger === 'second_thought'
      ? INITIATIVE_POLICY.secondThoughtMs
      : INITIATIVE_POLICY.idleMs;
  if (input.trigger !== 'post_turn' && input.idleForMs < requiredIdleMs - 5_000)
    return 'not_idle_long_enough';
  if (input.dailyCount >= INITIATIVE_POLICY.dailyLimit) return 'daily_limit';
  if (
    input.trigger !== 'post_turn' &&
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

export function isQuietDaypart(daypart: string | undefined) {
  return daypart === 'night';
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
