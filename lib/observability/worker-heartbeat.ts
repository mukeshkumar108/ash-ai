import 'server-only';

import postgres from 'postgres';

import { getDatabaseUrl } from '@/lib/db/env';

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;

function sql() {
  if (!client) client = postgres(getDatabaseUrl(), { max: 2 });
  return client;
}

async function recordStart(worker: string, startedAt: Date) {
  await sql()`
    INSERT INTO "RuntimeHeartbeat" (worker, status, "lastStartedAt", "updatedAt")
    VALUES (${worker}, 'running', ${startedAt}, ${startedAt})
    ON CONFLICT (worker) DO UPDATE SET
      status = 'running', "lastStartedAt" = EXCLUDED."lastStartedAt",
      "updatedAt" = EXCLUDED."updatedAt", "lastError" = NULL
  `;
}

async function recordSuccess(
  worker: string,
  startedAt: Date,
  summary: unknown,
) {
  const completedAt = new Date();
  await sql()`
    UPDATE "RuntimeHeartbeat" SET status = 'healthy',
      "lastCompletedAt" = ${completedAt},
      "lastDurationMs" = ${completedAt.getTime() - startedAt.getTime()},
      "lastSummary" = ${sql().json((summary ?? null) as any)},
      "lastError" = NULL, "updatedAt" = ${completedAt}
    WHERE worker = ${worker}
  `;
}

async function recordFailure(worker: string, startedAt: Date, error: unknown) {
  const failedAt = new Date();
  const message =
    error instanceof Error ? error.message : 'Unknown worker error';
  await sql()`
    UPDATE "RuntimeHeartbeat" SET status = 'error',
      "lastFailedAt" = ${failedAt},
      "lastDurationMs" = ${failedAt.getTime() - startedAt.getTime()},
      "lastError" = ${message.slice(0, 1_000)}, "updatedAt" = ${failedAt}
    WHERE worker = ${worker}
  `;
}

export async function withWorkerHeartbeat<T>(
  worker: string,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  await recordStart(worker, startedAt);
  try {
    const result = await run();
    const summary =
      result instanceof Response ? { status: result.status } : result;
    await recordSuccess(worker, startedAt, summary);
    return result;
  } catch (error) {
    await recordFailure(worker, startedAt, error).catch(() => undefined);
    throw error;
  }
}
