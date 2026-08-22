import { expect, test } from '@playwright/test';
import {
  computeUserChronology,
  userDayKey,
  TEMPORAL_SESSION_GAP_MINUTES,
} from '@/lib/agent/chronology';

const timeZone = 'Europe/London';

function times(...iso: string[]) {
  return iso.map((value) => ({ createdAt: new Date(value) }));
}

test('TemporalSession boundary: 29m59s gap is same session', () => {
  const now = new Date('2026-08-20T10:30:00Z');
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T10:00:01Z'),
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(false);
  expect(c.sameTemporalSession).toBe(true);
  expect(c.turnIndexInSession).toBe(2);
});

test('TemporalSession boundary: exactly 30 minutes is a new session', () => {
  const now = new Date('2026-08-20T10:30:00Z');
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T10:00:00Z'),
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(true);
  expect(c.inactivityGapMinutes).toBe(TEMPORAL_SESSION_GAP_MINUTES);
});

test('TemporalSession boundary: 31 minutes is a new session', () => {
  const now = new Date('2026-08-20T10:31:00Z');
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T10:00:00Z'),
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(true);
});

test('cross-thread: 25-minute sequence across four threads is one TemporalSession', () => {
  const now = new Date('2026-08-20T10:26:00Z');
  const c = computeUserChronology({
    interactionTimes: times(
      '2026-08-20T10:00:00Z',
      '2026-08-20T10:08:00Z',
      '2026-08-20T10:13:00Z',
      '2026-08-20T10:19:00Z',
    ),
    now,
    timeZone,
  });
  expect(c.sameTemporalSession).toBe(true);
  expect(c.newTemporalSession).toBe(false);
  expect(c.turnIndexInSession).toBe(5);
});

test('cross-thread: same user returns two hours later in a different Chat is a new TemporalSession', () => {
  const now = new Date('2026-08-20T13:40:00Z');
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T10:26:00Z'),
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(true);
});

test('cross-thread: thread reopened days later is same Thread, new TemporalSession', () => {
  const now = new Date('2026-08-24T09:00:00Z');
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T10:26:00Z'),
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(true);
  expect(c.crossedUserDayBoundary).toBe(true);
});

test('cross-thread: ten newly created Chats within one 20-minute period is one TemporalSession', () => {
  const now = new Date('2026-08-20T10:30:00Z');
  const sequence: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    sequence.push(
      new Date(now.getTime() - (10 - index) * 2 * 60_000).toISOString(),
    );
  }
  const c = computeUserChronology({
    interactionTimes: times(...sequence),
    now,
    timeZone,
  });
  expect(c.sameTemporalSession).toBe(true);
  expect(c.turnIndexInSession).toBe(11);
});

test('UserDay: 04:50 -> 05:10 with contiguous messages stays one TemporalSession across a new UserDay', () => {
  // BST (+01:00): 03:50Z == 04:50 local, 04:00Z == 05:00 local.
  const now = new Date('2026-08-20T04:10:00Z');
  const c = computeUserChronology({
    interactionTimes: times(
      '2026-08-20T03:50:00Z',
      '2026-08-20T03:55:00Z',
      '2026-08-20T04:00:00Z',
      '2026-08-20T04:05:00Z',
    ),
    now,
    timeZone,
  });
  expect(c.sameTemporalSession).toBe(true);
  expect(c.newTemporalSession).toBe(false);
  // The immediate previous turn (04:05Z == 05:05 local) is already inside the
  // new UserDay, but the session itself began before 05:00 local, so the
  // session crossed the UserDay boundary.
  expect(c.sessionCrossedUserDayBoundary).toBe(true);
});

test('UserDay: 04:45 -> 05:10 with a 25-minute gap stays one TemporalSession across the UserDay', () => {
  // 04:45 local = 03:45Z; 05:10 local = 04:10Z. Gap between messages is 25m.
  const now = new Date('2026-08-20T04:10:00Z');
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T03:45:00Z'),
    now,
    timeZone,
  });
  expect(c.sameTemporalSession).toBe(true);
  expect(c.crossedUserDayBoundary).toBe(true);
});

test('UserDay: first contact of a new UserDay is explicitly detected', () => {
  // First message of a new local day (>= 05:00) after a prior-day interaction.
  const now = new Date('2026-08-20T05:10:00Z'); // 06:10 local
  const c = computeUserChronology({
    interactionTimes: times('2026-08-19T23:30:00Z'),
    now,
    timeZone,
  });
  expect(c.isFirstContactUserDay).toBe(true);
  expect(c.crossedUserDayBoundary).toBe(true);
  expect(c.newTemporalSession).toBe(true);
});

test('UserDay: 04:20 -> 05:10 with a 50-minute gap is a new TemporalSession in a new UserDay', () => {
  const now = new Date('2026-08-20T04:10:00Z'); // 05:10 local
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T03:20:00Z'), // 04:20 local
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(true);
  expect(c.crossedUserDayBoundary).toBe(true);
  expect(c.isFirstContactUserDay).toBe(true);
});

test('UserDay: 01:32 -> 10:45 is a new TemporalSession, new UserDay, first contact, keeps HARD_REENTRY-appropriate gap', () => {
  const now = new Date('2026-08-20T09:45:00Z'); // 10:45 local
  const c = computeUserChronology({
    interactionTimes: times('2026-08-20T00:32:00Z'), // 01:32 local (same calendar day previous user-day)
    now,
    timeZone,
  });
  expect(c.newTemporalSession).toBe(true);
  expect(c.crossedUserDayBoundary).toBe(true);
  expect(c.isFirstContactUserDay).toBe(true);
  // 01:32 -> 10:45 is ~9h13m: comfortably >= 8h for a HARD re-entry.
  expect(c.inactivityGapMinutes).toBeGreaterThanOrEqual(8 * 60);
});

test('multiple TemporalSessions across multiple Chats within the same UserDay increment temporalSessionsToday', () => {
  const now = new Date('2026-08-20T11:00:00Z'); // 12:00 local
  const c = computeUserChronology({
    interactionTimes: times(
      '2026-08-20T07:00:00Z', // 08:00 local — first sitting
      '2026-08-20T09:05:00Z', // 10:05 local — new sitting after 2h gap
    ),
    now,
    timeZone,
  });
  // Two prior sittings plus the current sitting, all started within the
  // current UserDay.
  expect(c.temporalSessionsToday).toBe(3);
  expect(c.isFirstContactUserDay).toBe(false);
});

test('UserDay key respects the 05:00 local boundary', () => {
  // BST: 03:59Z == 04:59 local -> previous UserDay; 04:00Z == 05:00 local -> new UserDay.
  expect(userDayKey(new Date('2026-08-20T03:59:00Z'), timeZone)).toBe(
    '2026-08-19',
  );
  expect(userDayKey(new Date('2026-08-20T04:00:00Z'), timeZone)).toBe(
    '2026-08-20',
  );
});

test('UserDay key is DST-safe across the Europe/London spring transition', () => {
  // 2026-03-29 01:00Z is the UK spring-forward moment (02:00 BST).
  expect(userDayKey(new Date('2026-03-29T00:30:00Z'), timeZone)).toBe(
    '2026-03-28',
  );
  // 01:30Z is 02:30 local (post-transition) — before 05:00 so still previous UserDay.
  expect(userDayKey(new Date('2026-03-29T01:30:00Z'), timeZone)).toBe(
    '2026-03-28',
  );
  // Post-transition late-morning belongs to that day.
  expect(userDayKey(new Date('2026-03-29T09:00:00Z'), timeZone)).toBe(
    '2026-03-29',
  );
});

test('current-turn semantics: prior timeline excludes the incoming turn, which is passed as now', () => {
  const prior = new Date('2026-08-20T10:00:00Z');
  const incoming = new Date('2026-08-20T10:29:00Z');
  const c = computeUserChronology({
    interactionTimes: times(prior.toISOString()),
    now: incoming,
    timeZone,
  });
  expect(c.previousUserInteractionAt?.getTime()).toBe(prior.getTime());
  expect(c.inactivityGapMinutes).toBe(29);
  // Tool/assistant activity is never part of the user-role timeline, so a
  // long autonomous gap cannot keep a TemporalSession alive by itself.
  expect(c.newTemporalSession).toBe(false);
});