import { expect, test } from '@playwright/test';
import { classifyReentry, REENTRY_MODELS } from '@/lib/agent/reentry';
import { computeUserChronology, userDayKey } from '@/lib/agent/chronology';

const timeZone = 'Europe/London';
const established = 20;

function chronology({
  prior,
  now,
}: {
  prior: string[];
  now: string;
}) {
  return computeUserChronology({
    interactionTimes: prior.map((createdAt) => ({ createdAt: new Date(createdAt) })),
    now: new Date(now),
    timeZone,
  });
}

function classify(prior: string[], now: string, opts: { total?: number; override?: string } = {}) {
  const c = chronology({ prior, now });
  return {
    c,
    result: classifyReentry({
      totalPriorUserTurns: opts.total ?? established,
      chronology: c,
      manualModelOverride: opts.override ?? null,
    }),
  };
}

test('overnight boundary seeds two turns with Gemini and uses Nex from turn three', () => {
  const first = classify(['2026-08-20T22:30:00Z'], '2026-08-21T15:21:00Z');
  expect(first.result).toMatchObject({
    class: 'HARD_REENTRY',
    turnIndex: 1,
    selectedForegroundModel: REENTRY_MODELS.seed,
    staleLightweightPhase: true,
  });

  const second = classify(
    ['2026-08-20T22:30:00Z', '2026-08-21T15:21:00Z'],
    '2026-08-21T15:23:00Z',
  );
  expect(second.result).toMatchObject({
    class: 'HARD_REENTRY',
    turnIndex: 2,
    selectedForegroundModel: REENTRY_MODELS.seed,
  });

  const third = classify(
    [
      '2026-08-20T22:30:00Z',
      '2026-08-21T15:21:00Z',
      '2026-08-21T15:23:00Z',
    ],
    '2026-08-21T15:25:00Z',
  );
  expect(third.result).toMatchObject({
    class: 'HARD_REENTRY',
    turnIndex: 3,
    selectedForegroundModel: REENTRY_MODELS.ambient,
    richerSteerActive: false,
  });
});

test('soft re-entry, cold start and developer override precedence', () => {
  const soft = classify(['2026-08-21T14:40:00Z'], '2026-08-21T15:21:00Z');
  expect(soft.c.newTemporalSession).toBe(true);
  expect(soft.result).toMatchObject({
    class: 'SOFT_REENTRY',
    selectedForegroundModel: REENTRY_MODELS.seed,
  });

  const cold = classify([], '2026-08-21T06:00:00Z', { total: 1 });
  expect(cold.result.class).toBe('COLD_START');

  const hard = classify(['2026-08-20T22:30:00Z'], '2026-08-21T15:21:00Z', {
    override: 'openai/gpt-5.6-luna-pro',
  });
  expect(hard.result).toMatchObject({
    manualOverride: true,
    selectedForegroundModel: 'openai/gpt-5.6-luna-pro',
  });
});

test('a 25-minute cross-thread continuation stays CONTINUATION', () => {
  const { c, result } = classify(
    ['2026-08-21T15:00:00Z'],
    '2026-08-21T15:25:00Z',
  );
  expect(c.sameTemporalSession).toBe(true);
  expect(result).toMatchObject({ class: 'CONTINUATION' });
});

test('a goodnight crossing still yields HARD_REENTRY through UserDay semantics', () => {
  const { c, result } = classify(
    ['2026-08-20T22:55:00Z'],
    '2026-08-21T06:00:00Z',
  );
  expect(c.crossedUserDayBoundary).toBe(true);
  expect(c.inactivityGapMinutes).toBeGreaterThanOrEqual(6 * 60);
  expect(result).toMatchObject({ class: 'HARD_REENTRY' });
});

test('UserDay key is exposed through the reentry chronology', () => {
  const { c } = classify(['2026-08-20T22:30:00Z'], '2026-08-21T15:21:00Z');
  expect(c.userDayKey).toBe(
    userDayKey(new Date('2026-08-21T15:21:00Z'), timeZone),
  );
});