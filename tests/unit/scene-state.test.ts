import { expect, test } from '@playwright/test';
import { deriveSceneState } from '@/lib/agent/scene-state';

const london = 'Europe/London';

test('expires an evening walk across a next-day re-entry', () => {
  const scene = deriveSceneState({
    messages: [
      {
        role: 'user',
        text: "I'm just out on my evening walk",
        createdAt: new Date('2026-08-10T19:30:00.000Z'),
      },
    ],
    currentTurn: 'Hi Sophie, just checking in with you.',
    now: new Date('2026-08-11T18:00:00.000Z'),
    timeZone: london,
  });

  expect(scene.current).toEqual([]);
  expect(scene.historical).toEqual([
    expect.objectContaining({ scene: 'walking', status: 'historical' }),
  ]);
});

test('a same-turn walking contradiction overrides the old walk', () => {
  const scene = deriveSceneState({
    messages: [
      {
        role: 'user',
        text: "I'm just out on my evening walk",
        createdAt: new Date('2026-08-10T19:30:00.000Z'),
      },
    ],
    currentTurn: "I haven't gone out on my walk yet.",
    now: new Date('2026-08-11T18:00:00.000Z'),
    timeZone: london,
  });

  expect(scene.current).toEqual([
    expect.objectContaining({
      scene: 'walking',
      status: 'inactive',
      source: 'current_turn',
    }),
  ]);
  expect(scene.historical).toEqual([]);
});

test('the correction remains current on the following turn', () => {
  const scene = deriveSceneState({
    messages: [
      {
        role: 'user',
        text: "I'm just out on my evening walk",
        createdAt: new Date('2026-08-10T19:30:00.000Z'),
      },
      {
        role: 'user',
        text: "I haven't gone out on my walk yet.",
        createdAt: new Date('2026-08-11T18:00:00.000Z'),
      },
    ],
    currentTurn: 'As I just said in my previous message.',
    now: new Date('2026-08-11T18:01:00.000Z'),
    timeZone: london,
  });

  expect(scene.current[0]).toEqual(
    expect.objectContaining({ scene: 'walking', status: 'inactive' }),
  );
});

test('replays the reported walk, fractions, next-day, and correction sequence', () => {
  const walk = {
    role: 'user',
    text: "It's 8.30pm and I'm just out on my evening walk",
    createdAt: new Date('2026-08-10T19:30:00.000Z'),
  };
  const fractions = {
    role: 'user',
    text: 'I am showing a demo to Ashley. Explain fractions for a 14 year old.',
    createdAt: new Date('2026-08-10T22:30:00.000Z'),
  };

  const demoTurn = deriveSceneState({
    messages: [walk],
    currentTurn: fractions.text,
    now: fractions.createdAt,
    timeZone: london,
  });
  expect(demoTurn.current).toEqual([]);
  expect(demoTurn.historical[0]).toEqual(
    expect.objectContaining({ scene: 'walking', status: 'historical' }),
  );

  const nextDay = {
    role: 'user',
    text: "It's seven o'clock in the evening. I haven't gone out on my walk yet.",
    createdAt: new Date('2026-08-11T18:00:00.000Z'),
  };
  const correctionTurn = deriveSceneState({
    messages: [walk, fractions],
    currentTurn: nextDay.text,
    now: nextDay.createdAt,
    timeZone: london,
  });
  expect(correctionTurn.current[0]).toEqual(
    expect.objectContaining({ scene: 'walking', status: 'inactive' }),
  );

  const followingTurn = deriveSceneState({
    messages: [walk, fractions, nextDay],
    currentTurn:
      'As I just said in my previous message, I have not gone out yet.',
    now: new Date('2026-08-11T18:01:00.000Z'),
    timeZone: london,
  });
  expect(followingTurn.current[0]).toEqual(
    expect.objectContaining({ scene: 'walking', status: 'inactive' }),
  );
});
