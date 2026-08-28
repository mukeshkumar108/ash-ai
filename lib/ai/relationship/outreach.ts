import 'server-only';

import { randomUUID } from 'node:crypto';
import { mirrorAssistantInitiative } from '@/lib/honcho';

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
  completeNoAction,
  completeSuppressed,
  conversationSnapshot,
  failInitiative,
  persistInitiativeMessage,
  recentAssistantTopics,
  serverInitiativeScanCandidates,
  initiativeSituationSnapshot,
} from './store';
import { markTaskReminderFired } from '@/lib/tasks/domain';
import { consumeCalendarFollowup } from '@/lib/calendar/sync';
import type { InitiativeTrigger } from './types';
import {
  ambientCandidateForSituation,
  type AmbientCandidate,
  type InitiativeSituation,
  type TrustedSituationalFacts,
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
  const candidates = await serverInitiativeScanCandidates(
    Number(process.env.RELATIONSHIP_SERVER_SCAN_LIMIT ?? 5),
    evaluationNow,
  );
  let acted = 0;
  for (const candidate of candidates) {
    const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
    const [topics, situation] = await Promise.all([
      recentAssistantTopics(String(candidate.chatId)),
      initiativeSituationSnapshot({
        userId: String(candidate.userId),
        evaluationNow,
        timeZone,
        trustedFacts: options.trustedFacts,
      }),
    ]);
    const continuity = await retrieveInitiativeContinuity({
      userId: String(candidate.userId),
      chatId: String(candidate.chatId),
      timeZone,
      recentlyAddressedTopics: topics,
      evaluationNow,
    });
    const ambientCandidate = ambientCandidateForSituation(situation);
    const hasContinuity = hasPlausibleContinuityCandidate(continuity);
    const scheduledTrigger =
      candidate.trigger === 'second_thought' ||
      candidate.trigger === 'active_idle' ||
      candidate.trigger === 'task_reminder' ||
      candidate.trigger === 'calendar_followup'
        ? candidate.trigger
        : null;
    // Deterministic wake-ups consume their bookkeeping exactly once, before
    // evaluation: an active conversation (claim failure) or a declined send
    // never re-offers the same reminder/callback. Reactive continuity still
    // carries the underlying state.
    let deterministicReason: DeterministicReason | null = null;
    let dedupeScopeKey: string | undefined;
    if (candidate.trigger === 'task_reminder' && candidate.context) {
      const context = candidate.context as Record<string, unknown>;
      const reminderId =
        typeof context.reminderId === 'string' ? context.reminderId : null;
      const taskTitle =
        typeof context.taskTitle === 'string' ? context.taskTitle : 'a task';
      const windowLabel =
        typeof context.windowLabel === 'string' && context.windowLabel
          ? context.windowLabel
          : 'its reminder window';
      if (reminderId) {
        await markTaskReminderFired(reminderId, evaluationNow);
        deterministicReason = {
          kind: 'task_reminder',
          title: taskTitle,
          detail: `The user asked to be reminded about "${taskTitle}" and ${windowLabel} is open now.`,
        };
        dedupeScopeKey = `task_reminder:${reminderId}`;
      }
    } else if (candidate.trigger === 'calendar_followup' && candidate.context) {
      const context = candidate.context as Record<string, unknown>;
      const eventId =
        typeof context.eventId === 'string' ? context.eventId : null;
      const eventTitle =
        typeof context.eventTitle === 'string' && context.eventTitle
          ? context.eventTitle
          : 'their event';
      if (eventId) {
        await consumeCalendarFollowup(
          String(candidate.userId),
          eventId,
          evaluationNow,
        );
        deterministicReason = {
          kind: 'calendar_followup',
          title: eventTitle,
          detail: `"${eventTitle}" on the user's Google Calendar finished within the last few minutes; a bounded follow-up window is open.`,
        };
        dedupeScopeKey = `calendar_followup:${eventId}`;
      }
    }
    if (candidate.trigger === 'task_reminder' && !deterministicReason) continue;
    if (candidate.trigger === 'calendar_followup' && !deterministicReason)
      continue;
    if (!scheduledTrigger && !hasContinuity && !ambientCandidate) continue;
    const selectedAmbientCandidate =
      scheduledTrigger || hasContinuity ? null : ambientCandidate;
    const result = await runRelationshipInitiative({
      userId: String(candidate.userId),
      chatId: String(candidate.chatId),
      trigger:
        scheduledTrigger ?? (hasContinuity ? 'server_scan' : 'ambient_scan'),
      anchorMessageId: String(candidate.anchorMessageId),
      continuityContext: continuity,
      situation,
      ambientCandidate: selectedAmbientCandidate,
      deterministicReason,
      dedupeScopeKey: dedupeScopeKey ?? selectedAmbientCandidate?.key,
      ownedObject:
        candidate.context && typeof candidate.context === 'object'
          ? ((candidate.context as Record<string, unknown>).ownedObject as
              | Record<string, unknown>
              | null
              | undefined)
          : null,
      evaluationNow,
      onTrace: options.onTrace,
    });
    if (result.acted) acted += 1;
  }
  return { enabled: true, scanned: candidates.length, acted };
}
