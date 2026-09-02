import 'server-only';

import postgres from 'postgres';

import { getDatabaseUrl } from '@/lib/db/env';
import { mirrorAssistantInitiative } from '@/lib/honcho';

type Sql = ReturnType<typeof postgres>;

let client: Sql | null = null;
function sql(): Sql {
  if (!client) client = postgres(getDatabaseUrl(), { max: 5 });
  return client;
}

export type DueActiveWindowRow = {
  id: string;
  userId: string;
  chatId: string;
  anchorMessageId: string;
  anchorText: string;
  anchorCreatedAt: Date;
  trigger: string;
  followupDueAt: Date | null;
  followupSentAt: Date | null;
  finalDueAt: Date | null;
  finalSentAt: Date | null;
  milestone: 'arm' | 'first' | 'final';
};

/** Count of sent active-follow-up messages today for a user (phrase rotation). */
export async function existingSentFollowupCount(
  userId: string,
  chatId: string,
  now: Date,
): Promise<number> {
  const rows = await sql()`
    SELECT count(*)::int AS n
    FROM "RelationshipInitiative"
    WHERE "userId" = ${userId}
      AND "chatId" = ${chatId}
      AND trigger = 'active_idle'
      AND "topicKey" = 'active_followup'
      AND status = 'sent'
      AND "sentAt" >= date_trunc('day', ${now}::timestamp)
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Scheduled active_idle windows that need attention this tick, limited to the
 * finite active window. Milestones are classified in SQL so overlapping cron
 * invocations converge on the same decision:
 *   arm   -> randomized due timestamps not yet persisted
 *   first -> follow-up #1 due, not yet sent
 *   final -> final close due, first sent, final not sent
 *
 * NB: only driver-written timestamps are compared here (anchor createdAt,
 * notBefore, due/sent columns and the `now` parameter), so the postgres.js
 * local-time serialization is consistent across every comparison. SQL-side
 * now() values are never mixed in.
 */
export async function listDueActiveIdleWindows(
  now: Date,
  maxWindowMs = 15 * 60_000,
): Promise<DueActiveWindowRow[]> {
  const rows = await sql()`
    SELECT o.id, o."userId", o."chatId", o."anchorMessageId",
      COALESCE(
        (SELECT m.parts FROM "Message_v2" m WHERE m.id = o."anchorMessageId"),
        '[]'::json
      ) AS "anchorParts",
      m."createdAt" AS "anchorCreatedAt",
      o.trigger, o."followupDueAt", o."followupSentAt", o."finalDueAt", o."finalSentAt",
      CASE
        WHEN o."followupDueAt" IS NULL THEN 'arm'
        WHEN o."followupSentAt" IS NULL AND o."followupDueAt" <= ${now} THEN 'first'
        WHEN o."followupSentAt" IS NOT NULL
             AND o."finalDueAt" IS NOT NULL
             AND o."finalDueAt" <= ${now}
             AND o."finalSentAt" IS NULL THEN 'final'
        ELSE 'none'
      END AS milestone
    FROM "RelationshipOpportunity" o
    JOIN "Message_v2" m ON m.id = o."anchorMessageId"
    WHERE o.trigger = 'active_idle'
      AND o.status = 'scheduled'
      -- Only act once the production idle window (assistant reply + idleMs)
      -- has elapsed; never arm or send before the user had time to reply.
      AND o."notBefore" <= ${now}
      -- Finite window: only genuinely recent conversations are eligible. The
      -- anchor Sophie message is the session's most recent message at arm time.
      AND m."createdAt" >= ${now}::timestamp - (${maxWindowMs} * interval '1 millisecond')
      AND (
        o."followupDueAt" IS NULL
        OR (o."followupSentAt" IS NULL AND o."followupDueAt" <= ${now})
        OR (o."followupSentAt" IS NOT NULL AND o."finalDueAt" IS NOT NULL
            AND o."finalDueAt" <= ${now} AND o."finalSentAt" IS NULL)
      )
    ORDER BY o."createdAt" ASC
    LIMIT 25
  `;
  return rows
    .filter((row: any) => row.milestone !== 'none')
    .map((row: any) => {
      const parts = Array.isArray(row.anchorParts) ? row.anchorParts : [];
      const text = parts
        .filter((p: any) => p?.type === 'text')
        .map((p: any) => String(p.text ?? ''))
        .join(' ')
        .trim();
      return {
        id: String(row.id),
        userId: String(row.userId),
        chatId: String(row.chatId),
        anchorMessageId: String(row.anchorMessageId),
        anchorText: text,
        anchorCreatedAt: row.anchorCreatedAt,
        followupDueAt: row.followupDueAt as Date | null,
        followupSentAt: row.followupSentAt as Date | null,
        finalDueAt: row.finalDueAt as Date | null,
        finalSentAt: row.finalSentAt as Date | null,
        trigger: String(row.trigger),
        milestone: row.milestone as DueActiveWindowRow['milestone'],
      };
    });
}

/**
 * Atomic race-free arm: persists the randomized due timestamps exactly once.
 * Only one overlapping invocation can win the CAS (status still scheduled and
 * due fields still NULL), so repeated ticks never re-randomize or double-arm.
 */
export async function tryArmWindow(input: {
  windowId: string;
  followupDueAt: Date;
  finalDueAt: Date;
}): Promise<boolean> {
  const claimed = await sql()`
    UPDATE "RelationshipOpportunity"
    SET "followupDueAt" = ${input.followupDueAt},
        "finalDueAt" = ${input.finalDueAt}
    WHERE id = ${input.windowId}
      AND status = 'scheduled'
      AND "followupDueAt" IS NULL
      AND "finalDueAt" IS NULL
    RETURNING id
  `;
  return claimed.length === 1;
}

/** Atomic claim that follow-up #1 is due and has not yet been sent. */
export async function tryClaimFirstSend(input: {
  windowId: string;
  now: Date;
}): Promise<boolean> {
  const claimed = await sql()`
    UPDATE "RelationshipOpportunity"
    SET "followupSentAt" = ${input.now}
    WHERE id = ${input.windowId}
      AND status = 'scheduled'
      AND "followupDueAt" IS NOT NULL
      AND "followupDueAt" <= ${input.now}
      AND "followupSentAt" IS NULL
    RETURNING id
  `;
  return claimed.length === 1;
}

/** Atomic claim that the final close is due and not yet sent. */
export async function tryClaimFinalSend(input: {
  windowId: string;
  now: Date;
}): Promise<boolean> {
  const claimed = await sql()`
    UPDATE "RelationshipOpportunity"
    SET "finalSentAt" = ${input.now}
    WHERE id = ${input.windowId}
      AND status = 'scheduled'
      AND "followupSentAt" IS NOT NULL
      AND "finalDueAt" IS NOT NULL
      AND "finalDueAt" <= ${input.now}
      AND "finalSentAt" IS NULL
    RETURNING id
  `;
  return claimed.length === 1;
}

/** Durable cancellation (user replied, or window is stale/non-opening). */
export async function cancelWindow(windowId: string, now: Date) {
  await sql()`
    UPDATE "RelationshipOpportunity"
    SET status = 'cancelled', "closedAt" = ${now}
    WHERE id = ${windowId} AND status = 'scheduled'
  `;
}

/** Mark the window fully closed after the final message. */
export async function closeWindow(windowId: string, now: Date) {
  await sql()`
    UPDATE "RelationshipOpportunity"
    SET status = 'closed', "closedAt" = ${now}
    WHERE id = ${windowId} AND status = 'scheduled'
  `;
}

/**
 * Has the user replied since the anchor? Only a USER message newer than the
 * anchor closes the window — our own deterministic follow-ups are assistant
 * messages and must never cancel it.
 */
export async function anchorStillOpen(input: {
  chatId: string;
  anchorMessageId: string;
}): Promise<boolean> {
  const rows = await sql()`
    SELECT 1
    FROM "Message_v2" m
    WHERE m."chatId" = ${input.chatId}
      AND m.role = 'user'
      AND m."createdAt" > (
        SELECT "createdAt" FROM "Message_v2" WHERE id = ${input.anchorMessageId}
      )
    LIMIT 1
  `;
  return rows.length === 0;
}

/**
 * Persist a deterministic follow-up message as a canonical assistant message
 * and record it in the initiative ledger, then mirror to Honcho best-effort.
 * Returns false if the anchor changed under us (caller must not send).
 */
export async function persistFollowupMessage(input: {
  userId: string;
  chatId: string;
  anchorMessageId: string;
  windowId: string;
  stage: 'first' | 'final';
  messageId: string;
  text: string;
  now: Date;
  phraseSeed: number;
}): Promise<boolean> {
  return sql().begin(async (tx) => {
    // Lock the anchor message so a racing user reply cannot slip between our
    // check and insert. The timestamp comparison stays entirely in SQL (the
    // postgres.js driver applies a session-timezone skew when a timestamp is
    // read into a JS Date and re-serialized, so we never round-trip it).
    const [anchor] = await tx`
      SELECT id FROM "Message_v2" WHERE id = ${input.anchorMessageId}
      FOR UPDATE
    `;
    if (!anchor) {
      await cancelWindow(input.windowId, input.now);
      return false;
    }
    const [userReply] = await tx`
      SELECT 1 AS replied
      FROM "Message_v2" m
      WHERE m."chatId" = ${input.chatId}
        AND m.role = 'user'
        AND m."createdAt" > (
          SELECT "createdAt" FROM "Message_v2" WHERE id = ${input.anchorMessageId}
        )
      LIMIT 1
    `;
    if (userReply) {
      await cancelWindow(input.windowId, input.now);
      return false;
    }
    await tx`
      INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
      VALUES (${input.messageId}, ${input.chatId}, 'assistant',
        ${tx.json([{ type: 'text', text: input.text }])},
        ${tx.json([])}, ${input.now})
    `;
    await tx`
      INSERT INTO "RelationshipInitiative"
        ("userId", "chatId", trigger, "triggerMessageId", "dedupeKey", status,
         "candidateKind", "topicKey", reason, guidance, "generatedMessageId",
         "createdAt", "evaluationAt", "decidedAt", "sentAt")
      VALUES (${input.userId}, ${input.chatId}, 'active_idle', ${input.anchorMessageId},
        ${`followup:${input.windowId}:${input.stage}`}, 'sent',
        'continue_thread', 'active_followup', 'deterministic active-conversation follow-up',
        '', ${input.messageId}, ${input.now}, ${input.now}, ${input.now}, ${input.now})
      ON CONFLICT ("dedupeKey") DO NOTHING
    `;
    void mirrorAssistantInitiative({
      userId: input.userId,
      chatId: input.chatId,
      message: {
        id: input.messageId,
        text: input.text,
        createdAt: input.now,
      },
    });
    return true;
  });
}
