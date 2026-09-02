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

const plannerSchema = z.object({
  actionablePossibilities: z
    .array(
      z.object({
        decisionKey: z.string().min(1).max(80),
        title: z.string().max(280),
        reason: z.string().max(300),
        owner: z.enum(['user', 'sophie']),
        dependency: z.string().max(300).nullable(),
      }),
    )
    .max(8),
  externalChecks: z
    .array(
      z.object({
        kind: z.enum(['weather', 'daylight', 'travel', 'human_dependency']),
        check: z.string().max(300),
        reason: z.string().max(300),
        horizon: z.enum(['morning', 'midday', 'afternoon', 'evening', 'day']),
        altersDecisionKeys: z.array(z.string().min(1).max(80)).min(1).max(4),
      }),
    )
    .max(8),
});

const ORIENTATION_POLICY = {
  morning: {
    bias: 'ORIENT',
    direction: 'Help the day take shape without turning it into a checklist.',
  },
  midday: {
    bias: 'RECALIBRATE',
    direction:
      'Notice what changed and lightly reset direction only when useful.',
  },
  afternoon: {
    bias: 'MOVE_RESCUE',
    direction:
      'Help something move or rescue what is slipping, without productivity pressure.',
  },
  evening: {
    bias: 'CLOSE',
    direction:
      'Support closure, transition, reflection, or an enjoyable change of pace.',
  },
  night: {
    bias: 'REST',
    direction:
      'Lower pressure and protect rest unless the user clearly wants depth or action.',
  },
} as const;

type Daypart = keyof typeof ORIENTATION_POLICY;

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
  const daypart: Daypart =
    hour < 5
      ? 'night'
      : hour < 11
        ? 'morning'
        : hour < 14
          ? 'midday'
          : hour < 18
            ? 'afternoon'
            : hour < 22
              ? 'evening'
              : 'night';
  return {
    userDay: `${parts.year}-${parts.month}-${parts.day}`,
    daypart,
    hour,
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
    SELECT id, status, editorial FROM "ContinuityBrief" WHERE id = ${briefId} LIMIT 1
  `;
  if (
    existing[0]?.status === 'ready' &&
    (existing[0]?.editorial as Record<string, unknown> | undefined)
      ?.generatedForTimeZone === timeZone
  ) {
    return 'skipped';
  }
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
    const plan = (
      await generateObject({
        model: getLanguageModel(
          process.env.CONTINUITY_PLANNER_MODEL?.trim() ||
            'google/gemini-3.7-flash',
        ),
        schema: plannerSchema,
        system: `You are Sophie's daily Planner. Before conversation begins, identify a small set of evidence-grounded actionable possibilities and declared dependencies for the user day. Do not invent tasks, timing, or obligations. Give every possibility a unique decisionKey. External checks are declarations for later capability execution, not claims that weather, travel, daylight, or another person has actually been checked. Every external check must name one or more altersDecisionKeys from actionablePossibilities so a future result can be routed to the decision it can change.`,
        prompt: JSON.stringify({
          userDay,
          brief: context.brief,
          continuity: context.continuity ?? [],
          openThreads: context.open_threads ?? [],
        }),
      })
    ).object;
    const decisionKeyCounts = plan.actionablePossibilities.reduce(
      (counts, item) =>
        counts.set(item.decisionKey, (counts.get(item.decisionKey) ?? 0) + 1),
      new Map<string, number>(),
    );
    const externalChecks = plan.externalChecks.filter((item) =>
      item.altersDecisionKeys.every((key) => decisionKeyCounts.get(key) === 1),
    );
    const editorial = (
      await generateObject({
        model: getLanguageModel(
          process.env.CONTINUITY_CHIEF_OF_STAFF_MODEL?.trim() ||
            'google/gemini-3.7-flash',
        ),
        schema: editorialSchema,
        system: `You are Sophie's backstage Chief of Staff. Consume the daily Planner output plus typed continuity evidence and produce one compact day packet. This runs before live conversation. The packet is evidence and orientation, never an instruction to contact the user. Unknown/pending never means failed. Do not moralize, score habits, or inventory everything.
Task proposals are derived hypotheses only. Propose a Task only for a discrete, completable action supported by an exact sourceEvidence string present in the packet. A broad objective may yield multiple tasks only when each action is explicitly evidenced; never invent project steps. Habits, routines, feelings, relationships, events and ordinary life narration are not Tasks. Use authority=ask when scope, ownership, timing or intent is uncertain. Return an empty taskProposals array when evidence is insufficient.`,
        prompt: JSON.stringify({
          userDay,
          planner: plan,
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
        editorial = ${sql().json({
          ...editorial,
          taskProposals: proposals,
          plan: { ...plan, externalChecks },
          externalChecks,
          orientations: ORIENTATION_POLICY,
          generatedForTimeZone: timeZone,
        } as never)},
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
  const configuredHour = Number.parseInt(
    process.env.CONTINUITY_DAILY_LOCAL_HOUR?.trim() || '5',
    10,
  );
  const planningHour =
    Number.isInteger(configuredHour) &&
    configuredHour >= 0 &&
    configuredHour <= 23
      ? configuredHour
      : 5;
  // One daily packet is generated in the early-morning slow loop. Live turns
  // only read it; they never rerun Planner or Chief of Staff.
  const owners = await sql()`
    SELECT DISTINCT ON (c."userId") c."userId", c.id AS "chatId",
      COALESCE(u.time_zone, ${process.env.ASH_TIME_ZONE?.trim() || 'Europe/London'}) AS "timeZone"
    FROM "Chat" c
    JOIN "User" u ON u.id = c."userId"
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
    const timeZone = String(owner.timeZone);
    const coordinate = localCoordinates(now, timeZone);
    if (coordinate.hour !== planningHour) {
      skipped += 1;
      continue;
    }
    {
      const daypart = 'daily';
      const briefId = `${userId}:${coordinate.userDay}:daily`;
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
  return { generated, skipped, failed, planningHour };
}

export async function readCurrentContinuityDayPacket(
  userId: string,
  now: Date,
  timeZone: string,
) {
  const coordinate = localCoordinates(now, timeZone);
  let rows: Array<{ editorial?: unknown; generatedAt?: unknown }> = [];
  try {
    rows = await sql()`
      SELECT editorial, "generatedAt"
      FROM "ContinuityBrief"
      WHERE "userId" = ${userId}::uuid AND "userDay" = ${coordinate.userDay}
        AND status = 'ready'
      ORDER BY CASE WHEN daypart = 'daily' THEN 0 ELSE 1 END, "generatedAt" DESC
      LIMIT 1
    `;
  } catch {
    rows = [];
  }
  const editorial = rows[0]?.editorial as Record<string, unknown> | undefined;
  if (
    !editorial ||
    (editorial.generatedForTimeZone !== undefined &&
      editorial.generatedForTimeZone !== timeZone)
  ) {
    return {
      version: 'daily-packet-v1',
      userDay: coordinate.userDay,
      generatedAt: null,
      summary: null,
      priorities: [],
      watchItems: [],
      plan: null,
      externalChecks: [],
      orientation: ORIENTATION_POLICY[coordinate.daypart],
    };
  }
  const orientations = editorial.orientations as
    | Record<string, unknown>
    | undefined;
  return {
    version: 'daily-packet-v1',
    userDay: coordinate.userDay,
    generatedAt: rows[0]?.generatedAt ?? null,
    summary: editorial.summary ?? null,
    priorities: editorial.priorities ?? [],
    watchItems: editorial.watchItems ?? [],
    plan: editorial.plan ?? null,
    externalChecks: editorial.externalChecks ?? [],
    orientation:
      orientations?.[coordinate.daypart] ??
      ORIENTATION_POLICY[coordinate.daypart],
  };
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
