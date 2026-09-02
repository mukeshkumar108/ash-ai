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

export async function scheduleInitiativeOpportunity(input: {
  userId: string;
  chatId: string;
  anchorMessageId: string;
  trigger: 'second_thought' | 'active_idle';
  notBefore: Date;
  context?: Record<string, unknown>;
}) {
  await sql()`
    INSERT INTO "RelationshipOpportunity"
      ("userId", "chatId", "anchorMessageId", trigger, "notBefore", context)
    VALUES (
      ${input.userId}, ${input.chatId}, ${input.anchorMessageId},
      ${input.trigger}, ${input.notBefore},
      ${input.context ? sql().json(input.context as any) : null}
    )
    ON CONFLICT ("anchorMessageId", trigger) DO NOTHING
  `;
}

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
        count(*) FILTER (WHERE trigger IN ('active_idle', 'ambient_scan'))::int AS "idleCount",
        count(*) FILTER (WHERE trigger = 'task_reminder')::int AS "taskReminderCount",
        count(*) FILTER (WHERE trigger = 'calendar_followup')::int AS "calendarFollowupCount"
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
      taskReminderDailyCount: Number(daily.taskReminderCount),
      calendarFollowupDailyCount: Number(daily.calendarFollowupCount),
      unansweredCount: unanswered.length,
      msSinceLatestUnanswered,
      requiredUnansweredGapMs,
    });
    if (eligibility) {
      if (eligibility === 'conversation_changed') {
        await tx`
          UPDATE "RelationshipOpportunity" SET status = 'cancelled'
          WHERE "anchorMessageId" = ${input.anchorMessageId}
            AND trigger = ${input.trigger} AND status = 'scheduled'
        `;
      }
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

    await tx`
      UPDATE "RelationshipOpportunity" SET status = 'claimed', "claimedAt" = ${evaluationNow}
      WHERE "anchorMessageId" = ${input.anchorMessageId}
        AND trigger = ${input.trigger} AND status = 'scheduled'
    `;

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

export async function conversationHistoryForRuntime(chatId: string) {
  const rows = await sql()`
    SELECT id, role, parts, "createdAt" FROM "Message_v2"
    WHERE "chatId" = ${chatId} AND role IN ('user', 'assistant')
    ORDER BY "createdAt" DESC, id DESC LIMIT 14
  `;
  return rows.reverse().flatMap((row) => {
    const content = Array.isArray(row.parts)
      ? row.parts
          .filter((part: any) => part?.type === 'text')
          .map((part: any) => String(part.text ?? ''))
          .join(' ')
          .replace(/\s+/gu, ' ')
          .trim()
          .slice(0, 2_000)
      : '';
    if (!content || (row.role !== 'user' && row.role !== 'assistant'))
      return [];
    return [
      {
        id: String(row.id),
        role: row.role as 'user' | 'assistant',
        content,
        created_at: new Date(row.createdAt).toISOString(),
      },
    ];
  });
}

export async function claimRuntimeInitiative(input: {
  userId: string;
  chatId: string;
  anchorMessageId: string;
  trigger: string;
  decisionId: string;
  evaluationNow: Date;
}): Promise<InitiativeClaim> {
  return sql().begin(async (tx) => {
    const [latest] = await tx`
      SELECT m.id FROM "Message_v2" m JOIN "Chat" c ON c.id = m."chatId"
      WHERE m."chatId" = ${input.chatId} AND c."userId" = ${input.userId}
      ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1 FOR UPDATE OF m
    `;
    if (!latest || latest.id !== input.anchorMessageId) {
      return { ok: false as const, reason: 'conversation_changed' };
    }
    const claimed = await tx`
      INSERT INTO "RelationshipInitiative"
        ("userId", "chatId", trigger, "triggerMessageId", "dedupeKey", "evaluationAt")
      VALUES (${input.userId}, ${input.chatId}, ${input.trigger}, ${input.anchorMessageId},
        ${`runtime:${input.decisionId}`}, ${input.evaluationNow})
      ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id
    `;
    if (!claimed.length) {
      return { ok: false as const, reason: 'duplicate', duplicate: true };
    }
    await tx`
      UPDATE "RelationshipOpportunity" SET status = 'claimed', "claimedAt" = ${input.evaluationNow}
      WHERE "anchorMessageId" = ${input.anchorMessageId}
        AND trigger = ${input.trigger} AND status = 'scheduled'
    `;
    return {
      ok: true as const,
      eventId: String(claimed[0].id),
      recentTopicKeys: [],
    };
  });
}

export async function persistRuntimeInitiativeMessage(input: {
  eventId: string;
  userId: string;
  chatId: string;
  anchorMessageId: string;
  decisionId: string;
  reason: string;
  trace: Record<string, unknown>;
  messageId: string;
  text: string;
  evaluationNow: Date;
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
    const canonical = canonicalInitiativeMessage({
      id: input.messageId,
      chatId: input.chatId,
      text: input.text,
      createdAt: input.evaluationNow,
    });
    await tx`
      INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
      VALUES (${canonical.id}, ${canonical.chatId}, ${canonical.role}, ${tx.json(canonical.parts)}, ${tx.json(canonical.attachments)}, ${canonical.createdAt})
    `;
    await tx`
      UPDATE "RelationshipInitiative" SET status = 'sent', "candidateKind" = 'continue_thread',
        "topicKey" = ${`cortex:${input.decisionId}`}, reason = ${input.reason},
        evidence = ${tx.json(input.trace as any)}, "generatedMessageId" = ${input.messageId},
        "decidedAt" = now(), "sentAt" = ${input.evaluationNow}
      WHERE id = ${input.eventId} AND status = 'evaluating'
    `;
    return {
      id: input.messageId,
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: input.text }],
      metadata: { createdAt: input.evaluationNow.toISOString() },
    };
  });
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
    WITH due_opportunities AS (
      SELECT o."userId", o."chatId", o."anchorMessageId", o.trigger,
        o."notBefore" AS "lastMessageAt", o.context, 0 AS priority
      FROM "RelationshipOpportunity" o
      WHERE o.status = 'scheduled' AND o."notBefore" <= ${evaluationNow}
        AND o."createdAt" >= ${evaluationNow}::timestamp - interval '48 hours'
    )
    , due_task_reminders AS (
      SELECT r."userId", lm."chatId",
        lm."anchorMessageId",
        'task_reminder' AS trigger,
        r."startAt" AS "lastMessageAt",
        json_build_object(
          'reminderId', r.id, 'taskId', t.id, 'taskTitle', t.title,
          'windowEnd', r."endAt", 'windowLabel', r.label, 'dueAt', t."dueAt"
        ) AS context,
        0 AS priority
      FROM "TaskReminder" r
      JOIN "Task" t ON t.id = r."taskId"
      JOIN LATERAL (
        -- Delivery coordinate resolution. Tasks are owner-scoped; the chat is
        -- only the projection coordinate, so chatless (manual/system) tasks
        -- anchor to the user's current best chat at evaluation time. Tasks
        -- with a birth chat keep anchoring there (existing behavior), falling
        -- back to the current best chat only if the birth chat has no message.
        SELECT
          COALESCE(birth."chatId", current."chatId") AS "chatId",
          COALESCE(birth."anchorMessageId", current."anchorMessageId") AS "anchorMessageId"
        FROM (VALUES (1)) AS v
        LEFT JOIN LATERAL (
          SELECT t."chatId" AS "chatId", m.id AS "anchorMessageId"
          FROM "Message_v2" m
          WHERE m."chatId" = t."chatId"
          ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
        ) birth ON t."chatId" IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT c.id AS "chatId", latest_m.id AS "anchorMessageId"
          FROM "Chat" c
          JOIN LATERAL (
            SELECT m.id FROM "Message_v2" m WHERE m."chatId" = c.id
            ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
          ) latest_m ON true
          WHERE c."userId" = t."userId"
          ORDER BY COALESCE(
            (SELECT MAX(m2."createdAt") FROM "Message_v2" m2 WHERE m2."chatId" = c.id),
            c."createdAt"
          ) DESC
          LIMIT 1
        ) current ON true
      ) lm ON lm."anchorMessageId" IS NOT NULL
      WHERE r.status = 'scheduled' AND t.status = 'pending'
        AND r."startAt" <= ${evaluationNow}
        AND (r."endAt" IS NULL OR r."endAt" >= ${evaluationNow})
        AND r."createdAt" >= ${evaluationNow}::timestamp - interval '7 days'
    )
    , due_calendar_followups AS (
      SELECT e."userId", lc."chatId", lc."anchorMessageId",
        'calendar_followup' AS trigger,
        e."endAt" AS "lastMessageAt",
        json_build_object(
          'eventId', e."eventId", 'eventTitle', e.title,
          'endedAt', e."endAt", 'windowEnd', e."followupWindowEnd"
        ) AS context,
        0 AS priority
      FROM "CalendarEventSync" e
      JOIN LATERAL (
        SELECT c.id AS "chatId", latest_m.id AS "anchorMessageId"
        FROM "Chat" c
        JOIN LATERAL (
          SELECT m.id FROM "Message_v2" m WHERE m."chatId" = c.id
          ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1
        ) latest_m ON true
        WHERE c."userId" = e."userId"
        ORDER BY COALESCE(
          (SELECT MAX(m2."createdAt") FROM "Message_v2" m2 WHERE m2."chatId" = c.id),
          c."createdAt"
        ) DESC
        LIMIT 1
      ) lc ON true
      WHERE e.status = 'confirmed'
        AND e."completedAt" IS NOT NULL
        AND e."followupConsumedAt" IS NULL
        AND e."endAt" IS NOT NULL
        AND e."endAt" <= ${evaluationNow}
        AND e."followupWindowEnd" IS NOT NULL
        AND e."followupWindowEnd" >= ${evaluationNow}
    )
    , scan_candidates AS (
      SELECT "userId", "chatId", "anchorMessageId", trigger, "lastMessageAt", context, priority
      FROM due_opportunities
      UNION ALL
      SELECT "userId", "chatId", "anchorMessageId", trigger, "lastMessageAt", context, priority
      FROM due_task_reminders
      UNION ALL
      SELECT "userId", "chatId", "anchorMessageId", trigger, "lastMessageAt", context, priority
      FROM due_calendar_followups
    )
    SELECT DISTINCT ON ("userId") "userId", "chatId", "anchorMessageId", trigger, "lastMessageAt", context
    FROM scan_candidates
    ORDER BY "userId", priority, "lastMessageAt" DESC, "chatId"
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
