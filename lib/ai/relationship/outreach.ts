import 'server-only';

import { randomUUID } from 'node:crypto';
import { mirrorAssistantInitiative } from '@/lib/honcho';

import { composeInitiative } from './composer';
import { retrieveRelationshipEvidence } from './evidence';
import { evaluateInitiative } from './evaluator';
import { decisionPolicyRejection } from './policy';
import {
  claimInitiative,
  completeNoAction,
  completeSuppressed,
  conversationSnapshot,
  failInitiative,
  persistInitiativeMessage,
} from './store';
import type { InitiativeTrigger } from './types';

const evidenceCache = new Map<
  string,
  { expiresAt: number; packet: string | null; source: string }
>();

async function evidenceFor(userId: string, chatId: string) {
  const key = `${userId}:${chatId}`;
  const cached = evidenceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const fresh = await retrieveRelationshipEvidence(userId, chatId);
  const value = {
    ...fresh,
    expiresAt:
      Date.now() +
      Number(process.env.RELATIONSHIP_EVIDENCE_CACHE_MS ?? 15 * 60_000),
  };
  evidenceCache.set(key, value);
  return value;
}

export async function runRelationshipInitiative(input: {
  userId: string;
  chatId: string;
  trigger: InitiativeTrigger;
  anchorMessageId: string;
}) {
  const claim = await claimInitiative(input);
  if (!claim.ok)
    return {
      acted: false as const,
      reason: claim.reason,
      duplicate: claim.duplicate ?? false,
      retryAfterMs: claim.retryAfterMs,
    };

  try {
    const [recentConversation, memory] = await Promise.all([
      conversationSnapshot(input.chatId),
      evidenceFor(input.userId, input.chatId),
    ]);
    const signal = AbortSignal.timeout(
      Number(process.env.RELATIONSHIP_EVALUATOR_TIMEOUT_MS ?? 15_000),
    );
    const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
    const localTime = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone,
    }).format(new Date());
    const decision = await evaluateInitiative({
      trigger: input.trigger,
      recentConversation,
      memoryEvidence: memory.packet,
      recentTopicKeys: claim.recentTopicKeys,
      signal,
      localTime,
    });

    if (!decision.act) {
      await completeNoAction(claim.eventId, decision);
      return { acted: false as const, reason: decision.reason };
    }
    const policyRejection = decisionPolicyRejection({
      decision,
      trigger: input.trigger,
      recentTopicKeys: claim.recentTopicKeys,
      hasSensitiveSupport: Boolean(
        memory.packet && decision.evidence.length > 0,
      ),
    });
    if (policyRejection) {
      await completeSuppressed(claim.eventId, decision, policyRejection);
      return { acted: false as const, reason: policyRejection };
    }

    const text = await composeInitiative({
      trigger: input.trigger,
      decision,
      recentConversation,
      memoryEvidence: memory.packet,
      signal: AbortSignal.timeout(
        Number(process.env.RELATIONSHIP_COMPOSER_TIMEOUT_MS ?? 20_000),
      ),
    });
    if (!text) {
      await completeSuppressed(
        claim.eventId,
        decision,
        'composer_failed_message_policy',
      );
      return { acted: false as const, reason: 'composer_failed_policy' };
    }
    const message = await persistInitiativeMessage({
      eventId: claim.eventId,
      userId: input.userId,
      chatId: input.chatId,
      anchorMessageId: input.anchorMessageId,
      decision,
      messageId: randomUUID(),
      text,
    });
    if (!message)
      return {
        acted: false as const,
        reason: 'conversation_changed_before_send',
      };
    void mirrorAssistantInitiative({
      userId: input.userId,
      chatId: input.chatId,
      message: {
        id: message.id,
        text,
        createdAt: message.metadata.createdAt,
      },
    });
    console.info('[relationship] initiative sent', {
      eventId: claim.eventId,
      chatId: input.chatId,
      trigger: input.trigger,
      kind: decision.kind,
      topicKey: decision.topicKey,
      evidenceSource: memory.source,
      messageId: message.id,
    });
    return {
      acted: true as const,
      message,
      decision: { kind: decision.kind, reason: decision.reason },
    };
  } catch (error) {
    await failInitiative(
      claim.eventId,
      error instanceof Error
        ? error.message
        : 'Unknown relationship runtime error',
    );
    console.warn('[relationship] initiative failed closed', {
      eventId: claim.eventId,
      chatId: input.chatId,
      trigger: input.trigger,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { acted: false as const, reason: 'runtime_failed' };
  }
}
