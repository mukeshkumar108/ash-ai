export type TrustedSituationalFacts = {
  weather?: unknown;
  routines?: unknown;
  school_or_work?: unknown;
  calendar?: unknown;
  facts?: unknown;
  profile?: unknown;
};

export type InitiativeSituation = {
  now: string;
  timezone: string;
  localDate: string;
  localTime: string;
  weekday: string;
  hour: number;
  daypart: 'morning' | 'afternoon' | 'evening' | 'night';
  elapsedSinceLastInteractionMinutes: number | null;
  lastUserMessageAt: string | null;
  elapsedSinceLastUserMessageMinutes: number | null;
  firstInteractionToday: boolean;
  interactionsToday: number;
  todaysConversation: string;
  trustedFacts: TrustedSituationalFacts | null;
};

export type AmbientCandidate = {
  key: string;
  kind: 'evening_day_recap' | 'simulated_context';
  reason: string;
};

function parts(now: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(values.hour);
  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    localTime: `${values.hour}:${values.minute}`,
    weekday: values.weekday,
    hour,
  };
}

export function initiativeDaypart(
  hour: number,
): InitiativeSituation['daypart'] {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

export function localDateKey(now: Date, timeZone: string) {
  return parts(now, timeZone).localDate;
}

export function buildInitiativeSituation(input: {
  now: Date;
  timeZone: string;
  lastInteractionAt: Date | null;
  lastUserMessageAt?: Date | null;
  interactionsToday: number;
  todaysConversation: string;
  trustedFacts?: TrustedSituationalFacts | null;
}): InitiativeSituation {
  const local = parts(input.now, input.timeZone);
  return {
    now: input.now.toISOString(),
    timezone: input.timeZone,
    ...local,
    daypart: initiativeDaypart(local.hour),
    elapsedSinceLastInteractionMinutes: input.lastInteractionAt
      ? Math.max(
          0,
          Math.floor(
            (input.now.getTime() - input.lastInteractionAt.getTime()) / 60_000,
          ),
        )
      : null,
    lastUserMessageAt: input.lastUserMessageAt?.toISOString() ?? null,
    elapsedSinceLastUserMessageMinutes: input.lastUserMessageAt
      ? Math.max(
          0,
          Math.floor(
            (input.now.getTime() - input.lastUserMessageAt.getTime()) / 60_000,
          ),
        )
      : null,
    firstInteractionToday: input.interactionsToday <= 1,
    interactionsToday: input.interactionsToday,
    todaysConversation: input.todaysConversation.slice(-6_000),
    trustedFacts: input.trustedFacts ?? null,
  };
}

export function ambientCandidateForSituation(
  situation: InitiativeSituation,
): AmbientCandidate | null {
  if (situation.hour < 18 || situation.hour >= 22) return null;
  return {
    key: `evening_day_recap:${situation.localDate}`,
    kind: 'evening_day_recap',
    reason:
      'It is evening locally. The model may consider the user’s day only if today’s conversation makes that natural and non-repetitive.',
  };
}
