import type { UserChronology } from '@/lib/agent/chronology';
import { TEMPORAL_SESSION_GAP_MINUTES } from '@/lib/agent/chronology';

export const REENTRY_MODELS = {
  seed: 'google/gemini-3.7-flash',
  ambient: 'nex-agi/nex-n2-mini',
} as const;

export type ReentryClass =
  | 'CONTINUATION'
  | 'SOFT_REENTRY'
  | 'HARD_REENTRY'
  | 'COLD_START';

export type ReentryContext = {
  class: ReentryClass;
  turnIndex: number;
  gapMinutes: number | null;
  /**
   * True when the latest prior user interaction belongs to a different
   * UserDay (05:00 local boundary) than now. Field name preserved for the
   * Companion Runtime / prompt contract; the value now uses the authoritative
   * UserDay boundary.
   */
  crossedLocalDay: boolean;
  routeReason: string;
  selectedForegroundModel: string;
  manualOverride: boolean;
  richerSteerActive: boolean;
  staleLightweightPhase: boolean;
  /** Authoritative chronology facts consumed for classification / routing. */
  chronology: UserChronology;
};

/**
 * Behavioral re-entry classifier. It consumes the authoritative chronology
 * facts (gap, crossed UserDay boundary, session identity, turn-in-session)
 * rather than re-deriving them or using lexical departure phrases.
 *
 * Class mapping (behavioral, preserved):
 * - COLD_START: fewer than two prior user turns.
 * - CONTINUATION: same TemporalSession (gap under the 30-minute boundary).
 * - HARD_REENTRY: gap >= 8h, or crossed a UserDay boundary with gap >= 6h.
 * - SOFT_REENTRY: new TemporalSession below the hard thresholds.
 */
export function classifyReentry({
  totalPriorUserTurns,
  chronology,
  manualModelOverride,
}: {
  totalPriorUserTurns: number;
  chronology: UserChronology;
  manualModelOverride?: string | null;
}): ReentryContext {
  // The behavioral class is locked by the boundary that opened this
  // TemporalSession, not recomputed from the last turn's immediate gap. This
  // preserves the seeded-turn behavior: a session opened overnight stays
  // HARD_REENTRY for its seed turns even as the intra-session gap shrinks.
  const gapMinutes = chronology.sessionOpeningGapMinutes;
  const crossedUserDayBoundary = chronology.sessionCrossedUserDayBoundary;

  let reentryClass: ReentryClass;
  let routeReason: string;
  if (totalPriorUserTurns < 2) {
    reentryClass = 'COLD_START';
    routeReason = 'The relationship has fewer than two prior user turns.';
  } else if (gapMinutes === null) {
    reentryClass = 'CONTINUATION';
    routeReason = 'No earlier interaction boundary was available.';
  } else if (gapMinutes >= 8 * 60) {
    reentryClass = 'HARD_REENTRY';
    routeReason = 'The interaction gap lasted at least 8 hours.';
  } else if (crossedUserDayBoundary && gapMinutes >= 6 * 60) {
    reentryClass = 'HARD_REENTRY';
    routeReason =
      'The gap crossed a UserDay boundary and lasted at least 6 hours.';
  } else if (gapMinutes < TEMPORAL_SESSION_GAP_MINUTES) {
    reentryClass = 'CONTINUATION';
    routeReason =
      'The interaction stayed within the same TemporalSession (gap under the 30-minute boundary).';
  } else {
    reentryClass = 'SOFT_REENTRY';
    routeReason =
      'A new TemporalSession started (gap >= 30 min) but below the hard re-entry thresholds.';
  }

  const turnIndex = chronology.turnIndexInSession;
  const seedTurns =
    reentryClass === 'SOFT_REENTRY'
      ? 1
      : reentryClass === 'HARD_REENTRY' || reentryClass === 'COLD_START'
        ? 2
        : 0;
  const automaticModel =
    turnIndex <= seedTurns ? REENTRY_MODELS.seed : REENTRY_MODELS.ambient;
  const override = manualModelOverride?.trim();
  return {
    class: reentryClass,
    turnIndex,
    gapMinutes: chronology.inactivityGapMinutes,
    crossedLocalDay: crossedUserDayBoundary,
    selectedForegroundModel: override || automaticModel,
    manualOverride: Boolean(override),
    richerSteerActive: turnIndex <= seedTurns,
    staleLightweightPhase: reentryClass === 'HARD_REENTRY',
    chronology,
    routeReason: override
      ? `Developer override bypassed automatic routing (${routeReason})`
      : routeReason,
  };
}