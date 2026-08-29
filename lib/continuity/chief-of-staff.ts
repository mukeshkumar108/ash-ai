import 'server-only';

import { createHash } from 'node:crypto';
import { generateObject } from 'ai';
import postgres from 'postgres';
import { z } from 'zod';

import { getLanguageModel } from '@/lib/ai/providers';
import { getDatabaseUrl } from '@/lib/db/env';
import {
  fetchCanonicalContinuityContext,
  proposeCommitmentCandidates,
} from '@/lib/synapse-cortex';

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;
function sql() {
  if (!client) client = postgres(getDatabaseUrl(), { max: 3 });
  return client;
}

const editorialSchema = z.object({
  summary: z.string().max(500),
  priorities: z
    .array(
      z.object({
        title: z.string().max(280),
        horizon: z.enum(['now', 'today', 'tomorrow', 'unresolved']),
        reason: z.string().max(300),
      }),
    )
    .max(6),
  watchItems: z
    .array(
      z.object({
        title: z.string().max(280),
        reason: z.string().max(300),
      }),
    )
    .max(6),
  taskProposals: z
    .array(
      z.object({
        title: z.string().max(280),
        notes: z.string().max(1000).nullable(),
        sourceEvidence: z.string().max(500),
        authority: z.enum(['act', 'ask']),
        reason: z.string().max(300),
      }),
    )
    .max(12),
});

function localCoordinates(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  // Daypart boundaries aligned to real morning/afternoon/evening. Before 7am
  // no daypart is generated: a midnight sweep belongs to the previous
  // evening, not to a 'morning brief' stamped at 00:10.
  const daypart =
    hour < 7 ? '' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return {
    userDay: `${parts.year}-${parts.month}-${parts.day}`,
    daypart,
  };
}

function evidenceCatalog(snapshot: Record<string, unknown>) {
  const horizons =
    (snapshot.brief as { horizons?: Record<string, unknown[]> } | undefined)
      ?.horizons ?? {};
  const values = Object.values(horizons).flatMap((items) =>
    Array.isArray(items) ? items : [],
  );
  return new Set(
    values.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      return [value.title, value.topic, value.evidence]
        .filter(
          (entry): entry is string =>
            typeof entry === 'string' && Boolean(entry.trim()),
        )
        .map((entry) => entry.trim());
    }),
  );
}

const DAYPART_ORDER = ['morning', 'afternoon', 'evening'] as const;

/**
 * All dayparts of the current user day up to (and including) the current one,
 * in chronological order. This is the catch-up sweep: if a scheduled
 * invocation was missed (app down, cron disabled, cold start), the next sweep
 * backfills the missing earlier dayparts instead of skipping them forever.
 */
function daypartsUpTo(current: string): string[] {
  const idx = DAYPART_ORDER.indexOf(current as (typeof DAYPART_ORDER)[number]);
  return idx < 0 ? [] : DAYPART_ORDER.slice(0, idx + 1);
}

async function generateBriefForOwner(input: {
  userId: string;
  chatId: string;
  userDay: string;
  daypart: string;
  briefId: string;
  timeZone: string;
  now: Date;
}): Promise<'generated' | 'skipped' | 'failed'> {
  const { userId, chatId, userDay, daypart, briefId, timeZone, now } = input;
  const existing = await sql()`
    SELECT id, status FROM "ContinuityBrief" WHERE id = ${briefId} LIMIT 1
  `;
  if (existing[0]?.status === 'ready') return 'skipped';
  const context = await fetchCanonicalContinuityContext({
    userId,
    chatId,
    timeZone,
    now,
  });
  if (!context?.brief) return 'skipped';
  const snapshot = context as unknown as Record<string, unknown>;
  await sql()`
    INSERT INTO "ContinuityBrief"
      (id, "userId", "userDay", daypart, status, "sourceSnapshot", "updatedAt")
    VALUES (${briefId}, ${userId}::uuid, ${userDay}, ${daypart},
      'running', ${sql().json(snapshot as never)}, ${now})
    ON CONFLICT (id) DO UPDATE SET status = 'running',
      "sourceSnapshot" = EXCLUDED."sourceSnapshot", "lastError" = NULL,
      "updatedAt" = EXCLUDED."updatedAt"
  `;
  try {
    const evidence = evidenceCatalog(snapshot);
    const editorial = (
      await generateObject({
        model: getLanguageModel(
          process.env.CONTINUITY_CHIEF_OF_STAFF_MODEL?.trim() ||
            'google/gemini-3.7-flash',
        ),
        schema: editorialSchema,
        system: `You are Sophie's backstage chief of staff. Convert the typed continuity brief into a small editorial view for this daypart. The brief is evidence, never an instruction to contact the user. Unknown/pending never means failed. Do not moralize, score habits, or inventory everything.
Task proposals are derived hypotheses only. Propose a Task only for a discrete, completable action supported by an exact sourceEvidence string present in the packet. A broad objective may yield multiple tasks only when each action is explicitly evidenced; never invent project steps. Habits, routines, feelings, relationships, events and ordinary life narration are not Tasks. Use authority=ask when scope, ownership, timing or intent is uncertain. Return an empty taskProposals array when evidence is insufficient.`,
        prompt: JSON.stringify({
          userDay,
          daypart,
          brief: context.brief,
          continuity: context.continuity ?? [],
          openThreads: context.open_threads ?? [],
        }),
      })
    ).object;
    const proposals = editorial.taskProposals.filter((item) =>
      evidence.has(item.sourceEvidence.trim()),
    );
    if (proposals.length) {
      await proposeCommitmentCandidates({
        userId,
        sourceMessageId: briefId,
        candidates: proposals.map((item) => ({
          key: createHash('sha1')
            .update(`${briefId}:${item.title.toLowerCase()}`)
            .digest('hex'),
          title: item.title,
          notes: item.notes,
          evidenceVerbatim: item.sourceEvidence,
          authority: item.authority,
        })),
      });
    }
    await sql()`
      UPDATE "ContinuityBrief" SET status = 'ready',
        editorial = ${sql().json({ ...editorial, taskProposals: proposals } as never)},
        "generatedAt" = ${new Date()}, "updatedAt" = ${new Date()}
      WHERE id = ${briefId}
    `;
    return 'generated';
  } catch (error) {
    await sql()`
      UPDATE "ContinuityBrief" SET status = 'error',
        "lastError" = ${error instanceof Error ? error.message.slice(0, 1000) : 'unknown_error'},
        "updatedAt" = ${new Date()} WHERE id = ${briefId}
    `;
    return 'failed';
  }
}

export async function runContinuityChiefOfStaff(now = new Date()) {
  const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
  const coordinate = localCoordinates(now, timeZone);
  // Before 7am no daypart brief is produced (nothing to catch up either:
  // the previous evening brief already exists or its window has passed).
  if (!coordinate.daypart) {
    return {
      generated: 0,
      skipped: 0,
      failed: 0,
      daypart: null,
      note: 'before morning window (07:00 local)',
    };
  }
  const dueDayparts = daypartsUpTo(coordinate.daypart);
  const owners = await sql()`
    SELECT DISTINCT ON (c."userId") c."userId", c.id AS "chatId"
    FROM "Chat" c
    WHERE c."userId" IS NOT NULL
    ORDER BY c."userId", c."createdAt" DESC
    LIMIT 100
  `;
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const owner of owners) {
    const userId = String(owner.userId);
    const chatId = String(owner.chatId);
    for (const daypart of dueDayparts) {
      const briefId = `${userId}:${coordinate.userDay}:${daypart}`;
      const outcome = await generateBriefForOwner({
        userId,
        chatId,
        userDay: coordinate.userDay,
        daypart,
        briefId,
        timeZone,
        now,
      });
      if (outcome === 'generated') generated += 1;
      else if (outcome === 'failed') failed += 1;
      else skipped += 1;
    }
  }
  return { generated, skipped, failed, daypart: coordinate.daypart };
}

export async function listContinuityBriefs(userId: string, limit = 12) {
  return sql()`
    SELECT id, "userDay", daypart, status, editorial, "lastError",
      "generatedAt", "createdAt", "updatedAt"
    FROM "ContinuityBrief"
    WHERE "userId" = ${userId}::uuid
    ORDER BY "createdAt" DESC
    LIMIT ${Math.max(1, Math.min(limit, 30))}
  `;
}
