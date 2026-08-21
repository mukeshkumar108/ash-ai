import { expect, test } from '@playwright/test';
import { classifyReentry, REENTRY_MODELS } from '@/lib/agent/reentry';

const timeZone = 'Europe/London';
const established = 20;

test('overnight boundary seeds two turns with Gemini and uses Nex from turn three', () => {
  const make = (
    history: Array<{ role: string; createdAt: string; text: string }>,
    now: string,
  ) =>
    classifyReentry({
      history,
      externalPriorAt: '2026-08-20T22:30:00Z',
      externalPriorText: 'your turn in the word game',
      totalPriorUserTurns: established,
      now: new Date(now),
      timeZone,
    });
  expect(make([], '2026-08-21T15:21:00Z')).toMatchObject({
    class: 'HARD_REENTRY',
    turnIndex: 1,
    selectedForegroundModel: REENTRY_MODELS.seed,
    staleLightweightPhase: true,
  });
  expect(
    make(
      [
        {
          role: 'user',
          createdAt: '2026-08-21T15:21:00Z',
          text: 'sophieeeeee',
        },
      ],
      '2026-08-21T15:23:00Z',
    ),
  ).toMatchObject({
    class: 'HARD_REENTRY',
    turnIndex: 2,
    selectedForegroundModel: REENTRY_MODELS.seed,
  });
  expect(
    make(
      [
        {
          role: 'user',
          createdAt: '2026-08-21T15:21:00Z',
          text: 'sophieeeeee',
        },
        {
          role: 'assistant',
          createdAt: '2026-08-21T15:22:00Z',
          text: 'hey you',
        },
        {
          role: 'user',
          createdAt: '2026-08-21T15:23:00Z',
          text: 'how are you',
        },
      ],
      '2026-08-21T15:25:00Z',
    ),
  ).toMatchObject({
    class: 'HARD_REENTRY',
    turnIndex: 3,
    selectedForegroundModel: REENTRY_MODELS.ambient,
    richerSteerActive: false,
  });
});

test('soft, brb, goodnight, cold start and developer override precedence', () => {
  const base = { history: [], totalPriorUserTurns: established, timeZone };
  expect(
    classifyReentry({
      ...base,
      externalPriorAt: '2026-08-21T14:40:00Z',
      now: new Date('2026-08-21T15:21:00Z'),
    }),
  ).toMatchObject({
    class: 'SOFT_REENTRY',
    selectedForegroundModel: REENTRY_MODELS.seed,
  });
  expect(
    classifyReentry({
      ...base,
      externalPriorAt: '2026-08-21T14:40:00Z',
      externalPriorText: 'brb',
      now: new Date('2026-08-21T15:21:00Z'),
    }).class,
  ).toBe('CONTINUATION');
  expect(
    classifyReentry({
      ...base,
      externalPriorAt: '2026-08-20T22:55:00Z',
      externalPriorText: 'goodnight Sophie',
      now: new Date('2026-08-21T06:00:00Z'),
    }).class,
  ).toBe('HARD_REENTRY');
  expect(
    classifyReentry({
      ...base,
      totalPriorUserTurns: 1,
      now: new Date('2026-08-21T06:00:00Z'),
    }).class,
  ).toBe('COLD_START');
  expect(
    classifyReentry({
      ...base,
      externalPriorAt: '2026-08-20T22:30:00Z',
      now: new Date('2026-08-21T15:21:00Z'),
      manualModelOverride: 'openai/gpt-5.6-luna-pro',
    }),
  ).toMatchObject({
    manualOverride: true,
    selectedForegroundModel: 'openai/gpt-5.6-luna-pro',
  });
});
