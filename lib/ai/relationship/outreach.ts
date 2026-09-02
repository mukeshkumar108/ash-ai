import 'server-only';

import { randomUUID } from 'node:crypto';
import { mirrorAssistantInitiative } from '@/lib/honcho';
import {
  completeCompanionRuntimeProactive,
  executeCompanionRuntimeProactiveTick,
  type CompanionRuntimeProactiveResult,
} from '@/lib/companion-runtime';

import { sweepActiveConversationFollowups } from './followup';
import { composeInitiative } from './composer';
import { retrieveRelationshipEvidence } from './evidence';
import { evaluateInitiative } from './evaluator';
import { decisionPolicyRejection, isQuietDaypart } from './policy';
import {
  hasPlausibleContinuityCandidate,
  hasExplicitlyInvitedFollowUp,
  repeatsRecentlyAddressedTopic,
  retrieveInitiativeContinuity,
  type InitiativeContinuityContext,
} from './continuity';
import {
  claimInitiative,
  claimRuntimeInitiative,
  completeNoAction,
  completeSuppressed,
  conversationSnapshot,
  conversationHistoryForRuntime,
  failInitiative,
  persistInitiativeMessage,
  persistRuntimeInitiativeMessage,
  recentAssistantTopics,
  serverInitiativeScanCandidates,
  initiativeSituationSnapshot,
} from './store';
import { markTaskReminderFired } from '@/lib/tasks/domain';
import { consumeCalendarFollowup } from '@/lib/calendar/sync';
import type { InitiativeTrigger } from './types';
import type {
  AmbientCandidate,
  InitiativeSituation,
  TrustedSituationalFacts,
} from './situation';

export type InitiativeTraceEvent = {
  stage:
    | 'claim'
    | 'context'
    | 'candidate'
    | 'editorial'
    | 'policy'
    | 'dedupe'
    | 'persistence';
  value: unknown;
};

/**
 * Deterministic reason attached to commitment/calendar triggers. The
 * evaluator may act on it, but the decision stays editorial: a reminder is a
 * reason to think, never an instruction to send.
 */
export type DeterministicReason = {
  kind: 'task_reminder' | 'calendar_followup';
  title: string;
  detail: string;
};

type InitiativeRuntimeOptions = {
  /** Logical event time. Omit in production to capture the actual current time. */
  evaluationNow?: Date;
  onTrace?: (event: InitiativeTraceEvent) => void;
  evaluate?: typeof evaluateInitiative;
  compose?: typeof composeInitiative;
  trustedFacts?: TrustedSituationalFacts | null;
};

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

export async function runRelationshipInitiative(
  input: {
    userId: string;
    chatId: string;
    trigger: InitiativeTrigger;
    anchorMessageId: string;
    continuityContext?: InitiativeContinuityContext | null;
    situation?: InitiativeSituation | null;
    ambientCandidate?: AmbientCandidate | null;
    ownedObject?: Record<string, unknown> | null;
    deterministicReason?: DeterministicReason | null;
    dedupeScopeKey?: string;
  } & InitiativeRuntimeOptions,
) {
  const evaluationNow = input.evaluationNow ?? new Date();
  const claim = await claimInitiative({ ...input, evaluationNow });
  input.onTrace?.({ stage: 'claim', value: claim });
  input.onTrace?.({
    stage: 'dedupe',
    value: {
      claimed: claim.ok,
      duplicate: !claim.ok && Boolean(claim.duplicate),
    },
  });
  if (!claim.ok)
    return {
      acted: false as const,
      reason: claim.reason,
      duplicate: claim.duplicate ?? false,
      retryAfterMs: claim.retryAfterMs,
    };

  try {
    const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
    const [recentConversation, memory, assistantTopics, situation] =
      await Promise.all([
        conversationSnapshot(input.chatId),
        evidenceFor(input.userId, input.chatId),
        recentAssistantTopics(input.chatId),
        input.situation
          ? Promise.resolve(input.situation)
          : initiativeSituationSnapshot({
              userId: input.userId,
              evaluationNow,
              timeZone,
              trustedFacts: input.trustedFacts,
            }),
      ]);
    const continuity =
      input.continuityContext ??
      (await retrieveInitiativeContinuity({
        userId: input.userId,
        chatId: input.chatId,
        timeZone,
        recentlyAddressedTopics: assistantTopics,
        evaluationNow,
      }));
    input.onTrace?.({
      stage: 'context',
      value: {
        continuity,
        situation,
        ambientCandidate: input.ambientCandidate ?? null,
        honcho: { packet: memory.packet, source: memory.source },
      },
    });
    input.onTrace?.({
      stage: 'candidate',
      value: {
        plausible: hasPlausibleContinuityCandidate(continuity),
        ambient: input.ambientCandidate ?? null,
        quietHours: isQuietDaypart(continuity?.now?.daypart),
      },
    });
    if (
      (input.trigger === 'server_scan' || input.trigger === 'ambient_scan') &&
      (!hasPlausibleContinuityCandidate(continuity) ||
        isQuietDaypart(continuity?.now?.daypart)) &&
      !input.ambientCandidate
    ) {
      await completeNoAction(claim.eventId, {
        conversationState: {
          signal: 'unclear',
          confidence: 1,
          reason: 'Deterministic server prefilter.',
        },
        orientation: 'unclear',
        posture: 'hold',
        postureConfidence: 1,
        postureReason: 'No model evaluation was warranted.',
        holdJustification:
          'No timely continuity candidate, or local quiet hours.',
        nudgeJustification: null,
        relationalIntent: null,
        beatAssessment: {
          previousBeat: { summary: 'Not evaluated', awaitingResponse: false },
          proposedBeat: {
            summary: 'No candidate',
            relationToPrevious: 'new',
            addsNewValue: false,
            reason: 'Prefiltered',
          },
        },
        act: false,
        kind: 'continue_thread',
        reason: 'server_prefilter_no_candidate',
        guidance: null,
        evidence: [],
        topicKey: 'server_prefilter',
        sensitive: false,
      });
      input.onTrace?.({ stage: 'editorial', value: null });
      input.onTrace?.({
        stage: 'policy',
        value: { accepted: false, reason: 'server_prefilter_no_candidate' },
      });
      input.onTrace?.({
        stage: 'persistence',
        value: { status: 'no_action', eventId: claim.eventId },
      });
      return { acted: false as const, reason: 'server_prefilter_no_candidate' };
    }
    const signal = AbortSignal.timeout(
      Number(process.env.RELATIONSHIP_EVALUATOR_TIMEOUT_MS ?? 15_000),
    );
    const localTime = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone,
    }).format(evaluationNow);
    const decision = await (input.evaluate ?? evaluateInitiative)({
      trigger: input.trigger,
      recentConversation,
      memoryEvidence: memory.packet,
      recentTopicKeys: claim.recentTopicKeys,
      signal,
      localTime,
      continuityContext: continuity,
      situation,
      ambientCandidate: input.ambientCandidate,
      ownedObject: input.ownedObject,
      deterministicReason: input.deterministicReason,
    });
    input.onTrace?.({ stage: 'editorial', value: decision });

    if (!decision.act) {
      await completeNoAction(claim.eventId, decision);
      input.onTrace?.({
        stage: 'policy',
        value: { accepted: false, reason: decision.reason },
      });
      input.onTrace?.({
        stage: 'persistence',
        value: { status: 'no_action', eventId: claim.eventId },
      });
      return { acted: false as const, reason: decision.reason };
    }
    const policyRejection = decisionPolicyRejection({
      decision,
      trigger: input.trigger,
      recentTopicKeys: claim.recentTopicKeys,
      hasSensitiveSupport: Boolean(
        memory.packet && decision.evidence.length > 0,
      ),
      recentlyAddressedTopics: continuity?.recently_addressed_topics,
      explicitlyInvitedFollowUp: hasExplicitlyInvitedFollowUp(continuity),
    });
    if (policyRejection) {
      await completeSuppressed(claim.eventId, decision, policyRejection);
      input.onTrace?.({
        stage: 'policy',
        value: { accepted: false, reason: policyRejection },
      });
      input.onTrace?.({
        stage: 'persistence',
        value: { status: 'suppressed', eventId: claim.eventId },
      });
      return { acted: false as const, reason: policyRejection };
    }
    input.onTrace?.({
      stage: 'policy',
      value: { accepted: true, reason: null },
    });

    const text = await (input.compose ?? composeInitiative)({
      trigger: input.trigger,
      decision,
      recentConversation: `[SITUATIONAL PACKET]\n${JSON.stringify(situation)}\n\n[AMBIENT CANDIDATE]\n${JSON.stringify(input.ambientCandidate ?? null)}\n\n${recentConversation}`,
      memoryEvidence: memory.packet,
      continuityContext: continuity,
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
      input.onTrace?.({
        stage: 'persistence',
        value: {
          status: 'suppressed',
          reason: 'composer_failed_message_policy',
          eventId: claim.eventId,
        },
      });
      return { acted: false as const, reason: 'composer_failed_policy' };
    }
    if (
      repeatsRecentlyAddressedTopic(
        text,
        continuity?.recently_addressed_topics ?? assistantTopics,
      )
    ) {
      await completeSuppressed(
        claim.eventId,
        decision,
        'composed_message_repeats_recent_assistant',
      );
      input.onTrace?.({
        stage: 'policy',
        value: {
          accepted: false,
          reason: 'composed_message_repeats_recent_assistant',
        },
      });
      input.onTrace?.({
        stage: 'persistence',
        value: { status: 'suppressed', eventId: claim.eventId },
      });
      return { acted: false as const, reason: 'repeated_recent_assistant' };
    }
    const message = await persistInitiativeMessage({
      eventId: claim.eventId,
      userId: input.userId,
      chatId: input.chatId,
      anchorMessageId: input.anchorMessageId,
      decision,
      messageId: randomUUID(),
      text,
      evaluationNow,
    });
    if (!message) {
      input.onTrace?.({
        stage: 'persistence',
        value: {
          status: 'suppressed',
          reason: 'conversation_changed_before_send',
          eventId: claim.eventId,
        },
      });
      return {
        acted: false as const,
        reason: 'conversation_changed_before_send',
      };
    }
    input.onTrace?.({
      stage: 'persistence',
      value: { status: 'sent', eventId: claim.eventId, message },
    });
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

export async function runServerInitiativeScan(
  options: InitiativeRuntimeOptions = {},
) {
  if (process.env.RELATIONSHIP_SERVER_INITIATIVE_ENABLED === 'false') {
    return { enabled: false, scanned: 0, acted: 0 };
  }
  const evaluationNow = options.evaluationNow ?? new Date();
  // Deterministic active-conversation follow-up lifecycle: zero model calls.
  // Runs first so a fresh eligible conversation window is armed/driven by the
  // cheap phrase-bank path, never by the expensive model-backed loop below.
  const deterministic = await sweepActiveConversationFollowups({
    now: evaluationNow,
    timeZone: process.env.ASH_TIME_ZONE?.trim() || 'Europe/London',
  });
  const candidates = await serverInitiativeScanCandidates(
    Number(process.env.RELATIONSHIP_SERVER_SCAN_LIMIT ?? 5),
    evaluationNow,
  );
  let acted = 0;
  for (const candidate of candidates) {
    if (candidate.trigger === 'active_idle') {
      // Owned by the deterministic follow-up lifecycle above. Skip the model
      // path entirely: active_idle must never reach an LLM provider.
      continue;
    }
    const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
    const userId = String(candidate.userId);
    const chatId = String(candidate.chatId);
    const anchorMessageId = String(candidate.anchorMessageId);
    const history = await conversationHistoryForRuntime(chatId);
    let runtimeDecision: CompanionRuntimeProactiveResult | null = null;
    try {
      runtimeDecision = await executeCompanionRuntimeProactiveTick({
        request_id: randomUUID(),
        user_id: userId,
        conversation_id: chatId,
        anchor_message_id: anchorMessageId,
        trigger: String(candidate.trigger),
        now: evaluationNow.toISOString(),
        timezone: timeZone,
        recent_history: history,
      });
    } catch (error) {
      console.warn('[relationship] proactive runtime failed closed', {
        chatId,
        trigger: candidate.trigger,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      continue;
    }
    if (
      !runtimeDecision ||
      !runtimeDecision.should_appear ||
      !runtimeDecision.outbound_text ||
      !runtimeDecision.decision_id
    )
      continue;
    const decisionId = runtimeDecision.decision_id;
    const completion = async (delivered: boolean, reason?: string) => {
      await completeCompanionRuntimeProactive({
        user_id: userId,
        conversation_id: chatId,
        decision_id: decisionId,
        occurrence_id: runtimeDecision.occurrence_id,
        delivered,
        now: evaluationNow.toISOString(),
        reason,
      });
    };
    const claim = await claimRuntimeInitiative({
      userId,
      chatId,
      anchorMessageId,
      trigger: String(candidate.trigger),
      decisionId,
      evaluationNow,
    });
    if (!claim.ok) {
      await completion(false, claim.reason);
      continue;
    }
    try {
      const message = await persistRuntimeInitiativeMessage({
        eventId: claim.eventId,
        userId,
        chatId,
        anchorMessageId,
        decisionId,
        reason: runtimeDecision.reason,
        trace: runtimeDecision.trace,
        messageId: randomUUID(),
        text: runtimeDecision.outbound_text,
        evaluationNow,
      });
      if (!message) {
        await completion(false, 'conversation_changed_before_send');
        continue;
      }
      await completion(true);
      if (candidate.trigger === 'task_reminder' && candidate.context) {
        const reminderId = (candidate.context as Record<string, unknown>)
          .reminderId;
        if (typeof reminderId === 'string')
          await markTaskReminderFired(reminderId, evaluationNow);
      } else if (
        candidate.trigger === 'calendar_followup' &&
        candidate.context
      ) {
        const eventId = (candidate.context as Record<string, unknown>).eventId;
        if (typeof eventId === 'string')
          await consumeCalendarFollowup(userId, eventId, evaluationNow);
      }
      void mirrorAssistantInitiative({
        userId,
        chatId,
        message: {
          id: message.id,
          text: runtimeDecision.outbound_text,
          createdAt: message.metadata.createdAt,
        },
      });
      acted += 1;
    } catch (error) {
      await failInitiative(
        claim.eventId,
        error instanceof Error ? error.message : 'Unknown delivery error',
      );
      try {
        await completion(false, 'delivery_failed');
      } catch (completionError) {
        console.warn('[relationship] proactive completion failed', {
          decisionId: runtimeDecision.decision_id,
          error:
            completionError instanceof Error
              ? completionError.message
              : 'Unknown error',
        });
      }
    }
  }
  return {
    enabled: true,
    scanned: candidates.length,
    acted,
    deterministic,
  };
}
