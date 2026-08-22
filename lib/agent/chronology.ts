import 'server-only';

export const TEMPORAL_SESSION_GAP_MINUTES = 30;
export const USER_DAY_START_HOUR = 5;

export type UserDaypart = 'night' | 'morning' | 'afternoon' | 'evening';

export type UserChronology = {
  previousUserInteractionAt: Date | null;
  inactivityGapMinutes: number | null;
  sameTemporalSession: boolean;
  newTemporalSession: boolean;
  userDayKey: string;
  crossedUserDayBoundary: boolean;
  isFirstContactUserDay: boolean;
  temporalSessionsToday: number;
  turnIndexInSession: number;
  daypart: UserDaypart;
  /** Gap that opened the current session (null when the session is the first
   *  interaction ever). Locks the behavioral re-entry class for the session. */
  sessionOpeningGapMinutes: number | null;
  /** True when the current TemporalSession spans / began in a different
   *  UserDay than now (05:00 local boundary). */
  sessionCrossedUserDayBoundary: boolean;
  currentTemporalSessionStartedAt: Date;
  previousTemporalSessionStartedAt: Date | null;
  previousTemporalSessionEndedAt: Date | null;
};

type ChronologyTime = {
  createdAt: Date;
};

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * UserDay key (e.g. "2026-08-22") for the user-day starting at
 * USER_DAY_START_HOUR local time. DST-safe: the local wall-clock date and
 * hour are read via Intl in the supplied IANA timezone, never via fixed
 * UTC offsets.
 */
export function userDayKey(value: Date, timeZone: string): string {
  const local = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(value);
  const map: Record<string, string> = {};
  for (const part of local) map[part.type] = part.value;
  const hour = Number(map.hour ?? 12);
  const yyyy = map.year ?? '1970';
  const mm = map.month ?? '01';
  const dd = map.day ?? '01';
  if (hour < USER_DAY_START_HOUR) {
    const prior = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd) - 1));
    return `${prior.getUTCFullYear().toString().padStart(4, '0')}-${(prior.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0')}-${prior.getUTCDate().toString().padStart(2, '0')}`;
  }
  return `${yyyy}-${mm}-${dd}`;
}

function localHour(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(value);
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 12);
}

export function userDaypart(value: Date, timeZone: string): UserDaypart {
  const hour = localHour(value, timeZone);
  if (hour >= USER_DAY_START_HOUR && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/**
 * Single deterministic chronology computation. Canonical authority is the
 * user's authenticated user-role interaction timeline (application PostgreSQL
 * `Message_v2` timestamps) across ALL chats.
 *
 * - TemporalSession identity is purely interaction chronology: a gap >=
 *   TEMPORAL_SESSION_GAP_MINUTES between user interactions starts a new
 *   session. No lexical rules (brb/goodnight/etc) and no thread changes.
 * - UserDay is the independent USER_DAY_START_HOUR local day scope. UserDay
 *   rollover does NOT split a TemporalSession.
 *
 * @param interactionTimes user-role interaction timestamps (any chats) in any
 * order; the current incoming turn is NOT included in the timeline but is
 * passed as `now`.
 */
export function computeUserChronology({
  interactionTimes,
  now,
  timeZone,
}: {
  interactionTimes: ChronologyTime[];
  now: Date;
  timeZone: string;
}): UserChronology {
  const priorTimes = interactionTimes
    .map((entry) => validDate(entry.createdAt))
    .filter((value): value is Date => value !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const previousUserInteractionAt = priorTimes.at(-1) ?? null;
  const inactivityGapMilliseconds =
    previousUserInteractionAt === null
      ? null
      : Math.max(0, now.getTime() - previousUserInteractionAt.getTime());
  const inactivityGapMinutes =
    inactivityGapMilliseconds === null
      ? null
      : Math.floor(inactivityGapMilliseconds / 60_000);
  const nowUserDayKey = userDayKey(now, timeZone);
  const crossedUserDayBoundary =
    previousUserInteractionAt !== null &&
    userDayKey(previousUserInteractionAt, timeZone) !== nowUserDayKey;
  const newTemporalSession =
    inactivityGapMilliseconds === null ||
    inactivityGapMilliseconds >= TEMPORAL_SESSION_GAP_MINUTES * 60_000;

  // Split the combined timeline (prior + current turn) into sessions by gap.
  let sessionStartsToday = 0;
  let sessionStart = 0;
  let turnIndexInSession = 1;
  const timeline = [...priorTimes, now].sort((a, b) => a.getTime() - b.getTime());
  for (let index = 1; index < timeline.length; index += 1) {
    const gapMilliseconds = Math.max(
      0,
      timeline[index].getTime() - timeline[index - 1].getTime(),
    );
    if (gapMilliseconds >= TEMPORAL_SESSION_GAP_MINUTES * 60_000) {
      if (userDayKey(timeline[sessionStart], timeZone) === nowUserDayKey) {
        sessionStartsToday += 1;
      }
      sessionStart = index;
    }
  }
  if (userDayKey(timeline[sessionStart], timeZone) === nowUserDayKey) {
    sessionStartsToday += 1;
  }
  turnIndexInSession = timeline.length - sessionStart;

  const isFirstContactUserDay =
    !priorTimes.some((value) => userDayKey(value, timeZone) === nowUserDayKey);

  let previousSessionStart: Date | null = null;
  if (sessionStart > 0) {
    let index = sessionStart - 1;
    while (
      index > 0 &&
      timeline[index].getTime() - timeline[index - 1].getTime() <
        TEMPORAL_SESSION_GAP_MINUTES * 60_000
    ) {
      index -= 1;
    }
    previousSessionStart = timeline[index];
  }

  return {
    previousUserInteractionAt,
    inactivityGapMinutes,
    sameTemporalSession: !newTemporalSession,
    newTemporalSession,
    userDayKey: nowUserDayKey,
    crossedUserDayBoundary,
    isFirstContactUserDay,
    temporalSessionsToday: sessionStartsToday,
    turnIndexInSession,
    daypart: userDaypart(now, timeZone),
    sessionOpeningGapMinutes:
      sessionStart === 0
        ? null
        : Math.max(
            0,
            Math.floor(
              (timeline[sessionStart].getTime() -
                timeline[sessionStart - 1].getTime()) /
                60_000,
            ),
          ),
    // The current sitting crosses the UserDay boundary when any consecutive
    // pair from the sitting (including the pair that opened it) spans 05:00.
    sessionCrossedUserDayBoundary: (() => {
      for (
        let index = Math.max(0, sessionStart - 1);
        index < timeline.length - 1;
        index += 1
      ) {
        if (
          userDayKey(timeline[index], timeZone) !==
          userDayKey(timeline[index + 1], timeZone)
        ) {
          return true;
        }
      }
      return false;
    })(),
    currentTemporalSessionStartedAt: timeline[sessionStart],
    previousTemporalSessionStartedAt: previousSessionStart,
    previousTemporalSessionEndedAt:
      sessionStart > 0 ? timeline[sessionStart - 1] : null,
  };
}
