import { createHash } from 'node:crypto';
import type { UserChronology } from '@/lib/agent/chronology';
import type { TemporalSessionResidueRow } from '@/lib/db/queries';

/**
 * Bounded conversational residue from the end of a prior human sitting.
 * This is not a TemporalSession semantic summary and is never authoritative
 * meaning for the sitting as a whole. Cortex state and a durable thread
 * objective may complement it.
 */
export type TemporalSessionSummary = {
  id: string;
  startedAt: string;
  endedAt: string;
  touchedThreadIds: string[];
  importantEvents: string[];
  majorTopics: string[];
  unresolvedOutcomes: string[];
  activeWork: string[];
};

export type BridgeCandidate = {
  id: string;
  sourceSessionId: string;
  kind: 'activity_outcome' | 'unresolved_thread' | 'explicit_plan' | 'recent_life';
  summary: string;
  reasonToUse: string;
};

export type CompanionEntryContext = {
  version: 2;
  timeZone: string;
  chronology: {
    temporalSession: 'same' | 'new';
    userDay: string;
    daypart: UserChronology['daypart'];
    firstContactUserDay: boolean;
    gapMinutes: number | null;
    sessionStartedAt: string;
    sessionsToday: number;
  };
  previousSessionSummary: TemporalSessionSummary | null;
  recentSessionSummaries: TemporalSessionSummary[];
  bridgeCandidates: BridgeCandidate[];
  thread: null | { id: string; title: string | null; durableObjective: string | null };
};

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is { type: string; text?: unknown } =>
      Boolean(part && typeof part === 'object' && 'type' in part),
    )
    .filter((part) => part.type === 'text')
    .map((part) => String(part.text ?? ''))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 220);
}

function compactTopics(turns: Array<{ role: 'user' | 'assistant'; text: string }>) {
  return turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.text)
    .filter(Boolean)
    .slice(-4);
}

function bridgeKind(text: string): BridgeCandidate['kind'] {
  if (/\b(?:walking?|sunset|bats?|deer|dinner|commute|call)\b/iu.test(text)) return 'activity_outcome';
  if (/\b(?:need to|will|going to|plan(?:ning)? to|promise)\b/iu.test(text)) return 'explicit_plan';
  if (/\b(?:bug|runtime|deploy|code|build|fix|document|project)\b/iu.test(text)) return 'unresolved_thread';
  return 'recent_life';
}

export function buildCompanionEntryContext({
  userId,
  chronology,
  timeZone,
  residueRows = [],
  thread,
}: {
  userId: string;
  chronology: UserChronology;
  timeZone: string;
  residueRows?: TemporalSessionResidueRow[];
  thread?: CompanionEntryContext['thread'];
}): CompanionEntryContext {
  const boundedRows = residueRows
    .filter((row) => !Number.isNaN(row.createdAt.getTime()))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-36);
  const sessionRows: TemporalSessionResidueRow[][] = [];
  let lastUserAt: Date | null = null;
  for (const row of boundedRows) {
    if (
      row.role === 'user' &&
      lastUserAt &&
      row.createdAt.getTime() - lastUserAt.getTime() >= 30 * 60_000
    ) {
      sessionRows.push([]);
    }
    if (sessionRows.length === 0) sessionRows.push([]);
    sessionRows.at(-1)?.push(row);
    if (row.role === 'user') lastUserAt = row.createdAt;
  }
  const summaries = sessionRows.slice(-3).map((rows): TemporalSessionSummary | null => {
    const recentTurns = rows
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      text: textFromParts(row.parts),
    }))
    .filter((turn) => turn.text)
    .slice(-4);
    const startedAt = rows.at(0)?.createdAt ?? chronology.previousTemporalSessionStartedAt;
    const endedAt = rows.at(-1)?.createdAt ?? chronology.previousTemporalSessionEndedAt;
    return startedAt && endedAt
      ? {
          id: `ts_${createHash('sha256').update(userId).digest('hex').slice(0, 16)}_${startedAt.getTime()}`,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          touchedThreadIds: [...new Set(rows.map((row) => row.chatId))].slice(0, 4),
          importantEvents: compactTopics(recentTurns),
          majorTopics: compactTopics(recentTurns),
          unresolvedOutcomes: [] as string[],
          activeWork: thread?.durableObjective ? [thread.durableObjective] : [],
        }
      : null;
  }).filter((summary): summary is TemporalSessionSummary => summary !== null);
  const recentSessionSummaries = chronology.newTemporalSession ? summaries : [];
  const previousSessionSummary = recentSessionSummaries.at(-1) ?? null;
  const bridgeCandidates: BridgeCandidate[] = [...recentSessionSummaries]
    .reverse()
    .flatMap((session) => session.importantEvents.slice(-2).map((summary, index) => ({
        id: `${session.id}_bridge_${index}`,
        sourceSessionId: session.id,
        kind: bridgeKind(summary),
        summary,
        reasonToUse: 'Optional historical bridge; use only when it naturally serves the current turn.',
      })));
  if (previousSessionSummary && thread?.durableObjective) {
    bridgeCandidates.push({
      id: `${previousSessionSummary.id}_task`,
      sourceSessionId: previousSessionSummary.id,
      kind: 'unresolved_thread',
      summary: thread.durableObjective,
      reasonToUse: 'Durable task candidate; continue only with positive current-turn evidence.',
    });
  }
  return {
    version: 2,
    timeZone,
    chronology: {
      temporalSession: chronology.newTemporalSession ? 'new' : 'same',
      userDay: chronology.userDayKey,
      daypart: chronology.daypart,
      firstContactUserDay: chronology.isFirstContactUserDay,
      gapMinutes: chronology.inactivityGapMinutes,
      sessionStartedAt: chronology.currentTemporalSessionStartedAt.toISOString(),
      sessionsToday: chronology.temporalSessionsToday,
    },
    previousSessionSummary,
    recentSessionSummaries,
    bridgeCandidates: bridgeCandidates.slice(0, 4),
    thread: thread ?? null,
  };
}
