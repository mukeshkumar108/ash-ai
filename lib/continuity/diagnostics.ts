import 'server-only';

import postgres from 'postgres';

import { getDatabaseUrl } from '@/lib/db/env';

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;

function sql() {
  if (!client) client = postgres(getDatabaseUrl(), { max: 3 });
  return client;
}

export type ContinuityDeliveryDiagnostics = {
  generatedAt: string;
  initiativeOpportunities: Array<Record<string, unknown>>;
  initiativeDecisions: Array<Record<string, unknown>>;
  cortexDeliveries: Array<Record<string, unknown>>;
  workerHeartbeats: Array<Record<string, unknown>>;
  continuityBriefs: Array<Record<string, unknown>>;
};

/** Authenticated owner read model for dogfood inspection. */
export async function getContinuityDeliveryDiagnostics(
  userId: string,
): Promise<ContinuityDeliveryDiagnostics> {
  const now = new Date();
  const [opportunities, initiatives, outbox, heartbeats, briefs] =
    await Promise.all([
      sql()`
      SELECT o.id, o.trigger, o.status, o."notBefore", o."createdAt",
        o."claimedAt", o."chatId", o.context,
        CASE
          WHEN o.status = 'scheduled' AND o."notBefore" < ${now}::timestamp - interval '5 minutes'
          THEN true ELSE false
        END AS stuck
      FROM "RelationshipOpportunity" o
      WHERE o."userId" = ${userId}
      ORDER BY o."createdAt" DESC
      LIMIT 100
    `,
      sql()`
      SELECT i.id, i.trigger, i.status, i."candidateKind", i."topicKey",
        i.reason, i.evidence, i.guidance, i."createdAt", i."evaluationAt",
        i."decidedAt", i."sentAt", i."repliedAt", i."chatId"
      FROM "RelationshipInitiative" i
      WHERE i."userId" = ${userId}
      ORDER BY i."createdAt" DESC
      LIMIT 100
    `,
      sql()`
      SELECT o.id, o.status, o.attempts,
        o."last_attempt_at" AS "lastAttemptAt",
        o."next_attempt_at" AS "nextAttemptAt",
        o."last_status_code" AS "lastStatusCode",
        o."last_error" AS "lastError",
        o."degraded_delivery" AS "degradedDelivery",
        o."delivered_at" AS "deliveredAt",
        o."created_at" AS "createdAt",
        o."app_message_id" AS "appMessageId"
      FROM "CortexOutbox" o
      JOIN "Message_v2" m ON m.id = o."app_message_id"
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE c."userId" = ${userId}
      ORDER BY o."created_at" DESC
      LIMIT 100
    `,
      sql()`
      SELECT worker, status, "lastStartedAt", "lastCompletedAt",
        "lastFailedAt", "lastDurationMs", "lastSummary", "lastError",
        "updatedAt",
        CASE
          WHEN "lastCompletedAt" IS NULL THEN true
          WHEN "lastCompletedAt" < ${now}::timestamp - interval '3 minutes' THEN true
          ELSE false
        END AS stale
      FROM "RuntimeHeartbeat"
      ORDER BY worker ASC
    `,
      sql()`
      SELECT id, "userDay", daypart, status, editorial, "lastError",
        "generatedAt", "createdAt", "updatedAt"
      FROM "ContinuityBrief"
      WHERE "userId" = ${userId}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 30
    `,
    ]);

  return {
    generatedAt: now.toISOString(),
    initiativeOpportunities: opportunities,
    initiativeDecisions: initiatives,
    cortexDeliveries: outbox,
    workerHeartbeats: heartbeats,
    continuityBriefs: briefs,
  };
}
