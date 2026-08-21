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
  crossedLocalDay: boolean;
  routeReason: string;
  selectedForegroundModel: string;
  manualOverride: boolean;
  richerSteerActive: boolean;
  staleLightweightPhase: boolean;
};

type PriorTurn = {
  role: string;
  createdAt: Date | string;
  text: string;
};

const GOODNIGHT =
  /\b(?:good\s*night|nighty\s*night|sleep well|going to (?:sleep|bed))\b/iu;
const BRB =
  /\b(?:brb|be right back|back in (?:a |one )?(?:sec|second|minute|bit)|talk soon)\b/iu;

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDate(value: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function boundaryClass({
  priorAt,
  priorText,
  now,
  timeZone,
}: {
  priorAt: Date | null;
  priorText: string;
  now: Date;
  timeZone: string;
}): Pick<
  ReentryContext,
  'class' | 'gapMinutes' | 'crossedLocalDay' | 'routeReason'
> {
  if (!priorAt) {
    return {
      class: 'CONTINUATION',
      gapMinutes: null,
      crossedLocalDay: false,
      routeReason: 'No earlier interaction boundary was available.',
    };
  }
  const gapMinutes = Math.max(
    0,
    Math.floor((now.getTime() - priorAt.getTime()) / 60_000),
  );
  const crossedLocalDay =
    localDate(priorAt, timeZone) !== localDate(now, timeZone);
  if (GOODNIGHT.test(priorText) && crossedLocalDay) {
    return {
      class: 'HARD_REENTRY',
      gapMinutes,
      crossedLocalDay,
      routeReason: 'An explicit goodnight was followed by a new local day.',
    };
  }
  if (gapMinutes >= 8 * 60 || (crossedLocalDay && gapMinutes >= 6 * 60)) {
    return {
      class: 'HARD_REENTRY',
      gapMinutes,
      crossedLocalDay,
      routeReason: crossedLocalDay
        ? 'The gap crossed a local-day boundary and lasted at least 6 hours.'
        : 'The interaction gap lasted at least 8 hours.',
    };
  }
  if (gapMinutes <= 15 || (BRB.test(priorText) && gapMinutes <= 90)) {
    return {
      class: 'CONTINUATION',
      gapMinutes,
      crossedLocalDay,
      routeReason: BRB.test(priorText)
        ? 'The user returned shortly after an explicit brief-away boundary.'
        : 'The interaction gap was at most 15 minutes.',
    };
  }
  return {
    class: 'SOFT_REENTRY',
    gapMinutes,
    crossedLocalDay,
    routeReason:
      'The interaction gap was longer than 15 minutes but below the hard re-entry threshold.',
  };
}

export function classifyReentry({
  history,
  externalPriorAt,
  externalPriorText = '',
  totalPriorUserTurns,
  now = new Date(),
  timeZone,
  manualModelOverride,
}: {
  history: PriorTurn[];
  externalPriorAt?: Date | string | null;
  externalPriorText?: string | null;
  totalPriorUserTurns: number;
  now?: Date;
  timeZone: string;
  manualModelOverride?: string | null;
}): ReentryContext {
  const turns = history
    .map((turn) => ({ ...turn, createdAt: validDate(turn.createdAt) }))
    .filter((turn): turn is PriorTurn & { createdAt: Date } =>
      Boolean(turn.createdAt),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const externalAt = validDate(externalPriorAt);
  let sessionStart = 0;
  let boundary = boundaryClass({
    priorAt: externalAt,
    priorText: externalPriorText ?? '',
    now: turns[0]?.createdAt ?? now,
    timeZone,
  });

  for (let index = 1; index < turns.length; index += 1) {
    const candidate = boundaryClass({
      priorAt: turns[index - 1].createdAt,
      priorText: turns[index - 1].text,
      now: turns[index].createdAt,
      timeZone,
    });
    if (candidate.class !== 'CONTINUATION') {
      sessionStart = index;
      boundary = candidate;
    }
  }
  if (turns.length === 0 || sessionStart === 0) {
    const prior = turns.at(-1);
    boundary = boundaryClass({
      priorAt: prior?.createdAt ?? externalAt,
      priorText: prior?.text ?? externalPriorText ?? '',
      now,
      timeZone,
    });
    if (turns.length > 0 && boundary.class === 'CONTINUATION') {
      const firstBoundary = boundaryClass({
        priorAt: externalAt,
        priorText: externalPriorText ?? '',
        now: turns[0].createdAt,
        timeZone,
      });
      if (firstBoundary.class !== 'CONTINUATION') boundary = firstBoundary;
    }
  }

  if (totalPriorUserTurns < 2) {
    boundary = {
      ...boundary,
      class: 'COLD_START',
      routeReason: 'The relationship has fewer than two prior user turns.',
    };
    sessionStart = 0;
  }
  const turnIndex =
    turns.slice(sessionStart).filter((turn) => turn.role === 'user').length + 1;
  const seedTurns =
    boundary.class === 'SOFT_REENTRY'
      ? 1
      : boundary.class === 'HARD_REENTRY' || boundary.class === 'COLD_START'
        ? 2
        : 0;
  const automaticModel =
    turnIndex <= seedTurns ? REENTRY_MODELS.seed : REENTRY_MODELS.ambient;
  const override = manualModelOverride?.trim();
  return {
    ...boundary,
    turnIndex,
    selectedForegroundModel: override || automaticModel,
    manualOverride: Boolean(override),
    richerSteerActive: turnIndex <= seedTurns,
    staleLightweightPhase: boundary.class === 'HARD_REENTRY',
    routeReason: override
      ? `Developer override bypassed automatic routing (${boundary.routeReason})`
      : boundary.routeReason,
  };
}
