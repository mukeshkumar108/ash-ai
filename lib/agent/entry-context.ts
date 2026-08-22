import { createHash } from 'node:crypto';
import type { UserChronology } from '@/lib/agent/chronology';
import type { TemporalSessionResidueRow } from '@/lib/db/queries';

/**
 * Bounded conversational residue from the end of a prior human sitting.
 * This is not a TemporalSession semantic summary and is never authoritative
 * meaning for the sitting as a whole. Cortex state and a durable thread
 * objective may complement it.
 */
export type PreviousSittingResidue = {
  id: string;
  endedAt: string;
  touchedThreadIds: string[];
  recentTurns: Array<{ role: 'user' | 'assistant'; text: string }>;
};

export type CompanionEntryContext = {
  version: 1;
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
  previousSittingResidue: PreviousSittingResidue | null;
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
  const recentTurns = residueRows
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      text: textFromParts(row.parts),
    }))
    .filter((turn) => turn.text)
    .slice(-4);
  const previousSittingResidue =
    chronology.newTemporalSession &&
    chronology.previousTemporalSessionStartedAt &&
    chronology.previousTemporalSessionEndedAt
      ? {
          id: `ts_${createHash('sha256').update(userId).digest('hex').slice(0, 16)}_${chronology.previousTemporalSessionStartedAt.getTime()}`,
          endedAt: chronology.previousTemporalSessionEndedAt.toISOString(),
          touchedThreadIds: [...new Set(residueRows.map((row) => row.chatId))].slice(0, 4),
          recentTurns,
        }
      : null;
  return {
    version: 1,
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
    previousSittingResidue,
    thread: thread ?? null,
  };
}
