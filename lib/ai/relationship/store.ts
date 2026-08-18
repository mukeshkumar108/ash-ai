import 'server-only';

import postgres from 'postgres';

import { getDatabaseUrl } from '@/lib/db/env';
import {
  canonicalInitiativeMessage,
  checkInitiativeEligibility,
  initiativeDedupeKey,
  INITIATIVE_POLICY,
  unansweredFollowUpDelayMs,
} from './policy';
import type { InitiativeDecision, InitiativeTrigger } from './types';
import {
  buildInitiativeSituation,
  localDateKey,
  type TrustedSituationalFacts,
} from './situation';

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;
const sql = () => {
  if (!client) {
    client = postgres(getDatabaseUrl(), { max: 5 });
  }

  return client;
};

export type InitiativeClaim =
  | { ok: true; eventId: string; recentTopicKeys: string[] }
  | {
      ok: false;
      reason: string;
      duplicate?: boolean;
      retryAfterMs?: number;
    };

function decisionEvidence(decision: InitiativeDecision) {
  return {
    items: decision.evidence,
    conversationState: decision.conversationState,
    orientation: decision.orientation,
    posture: decision.posture,
    postureConfidence: decision.postureConfidence,
    postureReason: decision.postureReason,
    holdJustification: decision.holdJustification,
    nudgeJustification: decision.nudgeJustification,
    relationalIntent: decision.relationalIntent,
    beatAssessment: decision.beatAssessment,
  };
}

export async function claimInitiative(input: {
  userId: string;
  chatId: string;
  trigger: InitiativeTrigger;
  anchorMessageId: string;
  evaluationNow?: Date;
  dedupeScopeKey?: string;
}): Promise<InitiativeClaim> {
  const evaluationNow = input.evaluationNow ?? new Date();
  return sql().begin(async (tx) => {
    const [latest] = await tx`
      SELECT m.id, m.role, m."createdAt",
        extract(epoch from (${evaluationNow}::timestamp - m."createdAt")) * 1000 AS "idleForMs"
      FROM "Message_v2" m JOIN "Chat" c ON c.id = m."chatId"
      WHERE m."chatId" = ${input.chatId} AND c."userId" = ${input.userId}
      ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
    `;
    const [daily] = await tx`
      SELECT count(*)::int AS count,
        count(*) FILTER (WHERE trigger IN ('active_idle', 'ambient_scan'))::int AS "idleCount"
      FROM "RelationshipInitiative"
      WHERE "userId" = ${input.userId} AND status = 'sent'
        AND "sentAt" >= date_trunc('day', ${evaluationNow}::timestamp)
        AND "sentAt" <= ${evaluationNow}
    `;
    const unanswered = await tx`
      SELECT id, "sentAt",
        extract(epoch from (${evaluationNow}::timestamp - "sentAt")) * 1000 AS "ageMs"
      FROM "RelationshipInitiative"
      WHERE "userId" = ${input.userId} AND status = 'sent' AND "repliedAt" IS NULL
      ORDER BY "sentAt" DESC LIMIT ${INITIATIVE_POLICY.maxUnanswered}
    `;
    const msSinceLatestUnanswered = unanswered[0]?.sentAt
      ? Number(unanswered[0].ageMs)
      : null;
    const requiredUnansweredGapMs = unansweredFollowUpDelayMs(
      input.anchorMessageId,
    );
    const eligibility = checkInitiativeEligibility({
      trigger: input.trigger,
      anchorMessageId: input.anchorMessageId,
      latestMessageId: latest?.id ?? null,
      latestRole: latest?.role ?? null,
      idleForMs: latest ? Number(latest.idleForMs) : 0,
      dailyCount: Number(daily.count),
      idleDailyCount: Number(daily.idleCount),
      unansweredCount: unanswered.length,
      msSinceLatestUnanswered,
      requiredUnansweredGapMs,
    });
    if (eligibility) {
      const retryAfterMs =
        eligibility === 'unanswered_followup_too_soon' &&
        msSinceLatestUnanswered !== null
          ? Math.max(1_000, requiredUnansweredGapMs - msSinceLatestUnanswered)
          : undefined;
      return { ok: false as const, reason: eligibility, retryAfterMs };
    }

    const dedupeKey = initiativeDedupeKey(input);
    const claimed = await tx`
      INSERT INTO "RelationshipInitiative" ("userId", "chatId", "trigger", "triggerMessageId", "dedupeKey", "evaluationAt")
      VALUES (${input.userId}, ${input.chatId}, ${input.trigger}, ${input.anchorMessageId}, ${dedupeKey}, ${evaluationNow})
      ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id
    `;
    if (!claimed.length)
      return { ok: false as const, reason: 'duplicate', duplicate: true };

    const topics = await tx`
      SELECT "topicKey" FROM "RelationshipInitiative"
      WHERE "userId" = ${input.userId} AND "topicKey" IS NOT NULL
      ORDER BY "createdAt" DESC LIMIT 12
    `;
    return {
      ok: true as const,
      eventId: claimed[0].id,
      recentTopicKeys: topics.map((row) => String(row.topicKey)),
    };
  });
}

export async function conversationSnapshot(chatId: string) {
  const rows = await sql()`
    SELECT role, parts FROM "Message_v2" WHERE "chatId" = ${chatId}
    ORDER BY "createdAt" DESC LIMIT 14
  `;
  return rows
    .reverse()
    .map((row) => {
      const text = Array.isArray(row.parts)
        ? row.parts
            .filter((part: any) => part?.type === 'text')
            .map((part: any) => part.text)
            .join(' ')
        : '';
      return `${row.role}: ${String(text).replace(/\s+/gu, ' ').trim().slice(0, 700)}`;
    })
    .filter((line) => !line.endsWith(': '))
    .join('\n')
    .slice(-6_000);
}

export async function recentAssistantTopics(chatId: string) {
  const rows = await sql()`
    SELECT parts FROM "Message_v2"
    WHERE "chatId" = ${chatId} AND role = 'assistant'
    ORDER BY "createdAt" DESC LIMIT 4
  `;
  return rows
    .map((row) =>
      Array.isArray(row.parts)
        ? row.parts
            .filter((part: any) => part?.type === 'text')
            .map((part: any) => String(part.text ?? ''))
            .join(' ')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 500)
        : '',
    )
    .filter(Boolean);
}

export async function serverInitiativeScanCandidates(
  limit = 20,
  evaluationNow: Date = new Date(),
) {
  return sql()`
    WITH latest_per_chat AS (
      SELECT c."userId", m."chatId", m.id AS "anchorMessageId",
        m.role, m."createdAt" AS "lastMessageAt",
        row_number() OVER (
          PARTITION BY m."chatId"
          ORDER BY m."createdAt" DESC, m.id DESC
        ) AS chat_rank
      FROM "Message_v2" m
      JOIN "Chat" c ON c.id = m."chatId"
    ), eligible AS (
      SELECT * FROM latest_per_chat
      WHERE chat_rank = 1 AND role = 'assistant'
        AND "lastMessageAt" <= ${evaluationNow}::timestamp - (${INITIATIVE_POLICY.idleMs} * interval '1 millisecond')
        AND "lastMessageAt" >= ${evaluationNow}::timestamp - interval '48 hours'
    )
    SELECT DISTINCT ON ("userId") "userId", "chatId", "anchorMessageId", "lastMessageAt"
    FROM eligible
    ORDER BY "userId", "lastMessageAt" DESC, "chatId"
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `;
}

export async function initiativeSituationSnapshot(input: {
  userId: string;
  evaluationNow: Date;
  timeZone: string;
  trustedFacts?: TrustedSituationalFacts | null;
}) {
  const rows = await sql()`
    SELECT m.role, m.parts, m."createdAt", m."chatId"
    FROM "Message_v2" m
    JOIN "Chat" c ON c.id = m."chatId"
    WHERE c."userId" = ${input.userId}
      AND m."createdAt" <= ${input.evaluationNow}
      AND m."createdAt" >= ${input.evaluationNow}::timestamp - interval '36 hours'
    ORDER BY m."createdAt" DESC, m.id DESC
    LIMIT 100
  `;
  const today = localDateKey(input.evaluationNow, input.timeZone);
  const todaysRows = rows
    .filter(
      (row) => localDateKey(new Date(row.createdAt), input.timeZone) === today,
    )
    .reverse();
  const conversation = todaysRows
    .slice(-24)
    .map((row) => {
      const text = Array.isArray(row.parts)
        ? row.parts
            .filter((part: any) => part?.type === 'text')
            .map((part: any) => String(part.text ?? ''))
            .join(' ')
            .replace(/\s+/gu, ' ')
            .trim()
            .slice(0, 500)
        : '';
      return text ? `${row.role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
  const latestUserRow = rows.find((row) => row.role === 'user');
  return buildInitiativeSituation({
    now: input.evaluationNow,
    timeZone: input.timeZone,
    lastInteractionAt: rows[0]?.createdAt ? new Date(rows[0].createdAt) : null,
    lastUserMessageAt: latestUserRow?.createdAt
      ? new Date(latestUserRow.createdAt)
      : null,
    interactionsToday: todaysRows.filter((row) => row.role === 'user').length,
    todaysConversation: conversation,
    trustedFacts: input.trustedFacts,
  });
}

export async function completeNoAction(
  eventId: string,
  decision: InitiativeDecision,
) {
  await sql()`UPDATE "RelationshipInitiative" SET status = 'no_action', "candidateKind" = ${decision.kind}, "topicKey" = ${decision.topicKey}, reason = ${decision.reason}, evidence = ${sql().json(decisionEvidence(decision))}, guidance = ${decision.guidance}, "decidedAt" = now() WHERE id = ${eventId}`;
}

export async function completeSuppressed(
  eventId: string,
  decision: InitiativeDecision,
  reason: string,
) {
  await sql()`UPDATE "RelationshipInitiative" SET status = 'suppressed', "candidateKind" = ${decision.kind}, "topicKey" = ${decision.topicKey}, reason = ${reason}, evidence = ${sql().json(decisionEvidence(decision))}, guidance = ${decision.guidance}, "decidedAt" = now() WHERE id = ${eventId}`;
}

export async function failInitiative(eventId: string, reason: string) {
  await sql()`UPDATE "RelationshipInitiative" SET status = 'error', reason = ${reason.slice(0, 500)}, "decidedAt" = now() WHERE id = ${eventId}`;
}

export async function persistInitiativeMessage(input: {
  eventId: string;
  userId: string;
  chatId: string;
  anchorMessageId: string;
  decision: InitiativeDecision;
  messageId: string;
  text: string;
  evaluationNow?: Date;
}) {
  return sql().begin(async (tx) => {
    const [latest] = await tx`
      SELECT m.id FROM "Message_v2" m JOIN "Chat" c ON c.id = m."chatId"
      WHERE m."chatId" = ${input.chatId} AND c."userId" = ${input.userId}
      ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1 FOR UPDATE OF m
    `;
    if (!latest || latest.id !== input.anchorMessageId) {
      await tx`UPDATE "RelationshipInitiative" SET status = 'suppressed', reason = 'conversation_changed_before_send', "decidedAt" = now() WHERE id = ${input.eventId}`;
      return null;
    }
    const createdAt = input.evaluationNow ?? new Date();
    const canonical = canonicalInitiativeMessage({
      id: input.messageId,
      chatId: input.chatId,
      text: input.text,
      createdAt,
    });
    await tx`
      INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
      VALUES (${canonical.id}, ${canonical.chatId}, ${canonical.role}, ${tx.json(canonical.parts)}, ${tx.json(canonical.attachments)}, ${canonical.createdAt})
    `;
    await tx`
      UPDATE "RelationshipInitiative" SET status = 'sent', "candidateKind" = ${input.decision.kind},
        "topicKey" = ${input.decision.topicKey}, reason = ${input.decision.reason}, evidence = ${tx.json(decisionEvidence(input.decision))},
        guidance = ${input.decision.guidance}, "generatedMessageId" = ${input.messageId}, "decidedAt" = now(), "sentAt" = ${createdAt}
      WHERE id = ${input.eventId} AND status = 'evaluating'
    `;
    return {
      id: input.messageId,
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: input.text }],
      metadata: { createdAt: createdAt.toISOString() },
    };
  });
}

export async function markLatestInitiativeReplied(input: {
  userId: string;
  chatId: string;
  replyMessageId: string;
  repliedAt: Date;
}) {
  await sql()`
    UPDATE "RelationshipInitiative" SET "repliedAt" = ${input.repliedAt}, "replyMessageId" = ${input.replyMessageId}
    WHERE id = (
      SELECT id FROM "RelationshipInitiative" WHERE "userId" = ${input.userId} AND "chatId" = ${input.chatId}
        AND status = 'sent' AND "repliedAt" IS NULL
        AND "generatedMessageId" = (
          SELECT id FROM "Message_v2" WHERE "chatId" = ${input.chatId} AND id <> ${input.replyMessageId}
          ORDER BY "createdAt" DESC, id DESC LIMIT 1
        )
        ORDER BY "sentAt" DESC LIMIT 1
    )
  `;
}
