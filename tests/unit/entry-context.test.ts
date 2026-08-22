import { expect, test } from '@playwright/test';
import { computeUserChronology } from '@/lib/agent/chronology';
import { buildCompanionEntryContext } from '@/lib/agent/entry-context';
import { resolveUserTimeZone } from '@/lib/agent/timezone';
import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';

test('builds bounded cross-thread previous-sitting residue without a thread dependency', () => {
  const chronology = computeUserChronology({
    interactionTimes: [
      { createdAt: new Date('2026-08-22T00:20:00Z') },
      { createdAt: new Date('2026-08-22T00:32:00Z') },
    ],
    now: new Date('2026-08-22T09:45:00Z'),
    timeZone: 'Europe/London',
  });
  const packet = buildCompanionEntryContext({
    userId: 'user-a',
    chronology,
    timeZone: 'Europe/London',
    residueRows: [
      { chatId: 'a', role: 'user', parts: [{ type: 'text', text: 'late night' }], createdAt: new Date('2026-08-22T00:20:00Z') },
      { chatId: 'b', role: 'assistant', parts: [{ type: 'text', text: 'sleep well' }], createdAt: new Date('2026-08-22T00:31:00Z') },
      { chatId: 'b', role: 'user', parts: [{ type: 'text', text: 'night' }], createdAt: new Date('2026-08-22T00:32:00Z') },
    ],
    thread: null,
  });
  expect(packet.chronology).toMatchObject({
    temporalSession: 'new',
    daypart: 'morning',
    firstContactUserDay: true,
  });
  expect(packet.previousSittingResidue?.id).toMatch(/^ts_[a-f0-9]{16}_\d+$/u);
  expect(packet.previousSittingResidue?.touchedThreadIds).toEqual(['a', 'b']);
  expect(packet.previousSittingResidue?.recentTurns).toHaveLength(3);
  expect(packet.thread).toBeNull();
});

test('timezone contract accepts IANA zones and has a deterministic fallback', () => {
  expect(resolveUserTimeZone('America/New_York')).toBe('America/New_York');
  expect(resolveUserTimeZone('not/a-zone')).toBe('Europe/London');
  expect(resolveUserTimeZone(null)).toBe('Europe/London');
});

test('TemporalSession residue IDs are namespaced per authenticated user', () => {
  const chronology = computeUserChronology({
    interactionTimes: [{ createdAt: new Date('2026-08-22T00:32:00Z') }],
    now: new Date('2026-08-22T10:45:00Z'),
    timeZone: 'Europe/London',
  });
  const first = buildCompanionEntryContext({ userId: 'user-a', chronology, timeZone: 'Europe/London' });
  const second = buildCompanionEntryContext({ userId: 'user-b', chronology, timeZone: 'Europe/London' });
  expect(first.previousSittingResidue?.id).not.toBe(second.previousSittingResidue?.id);
});

test('authoritative entry context follows and supersedes lightweight steer text', () => {
  const entryContext = {
    version: 1 as const,
    timeZone: 'Europe/London',
    chronology: {
      temporalSession: 'new' as const,
      userDay: '2026-08-22',
      daypart: 'morning' as const,
      firstContactUserDay: true,
      gapMinutes: 553,
      sessionStartedAt: '2026-08-22T09:45:00.000Z',
      sessionsToday: 1,
    },
    previousSittingResidue: null,
    thread: null,
  };
  const prompt = buildSophieReplySystemPrompt({
    entryContext,
    interactionSteer: {
      posture: 'ask',
      phase: null,
      objective: 'Continue the old word game.',
      strength: 'light',
      turnsRemaining: 2,
      initiativePermission: 'none',
      expressionShape: 'single',
      reason: 'Old phase.',
      lastTactic: null,
    },
  });
  expect(prompt.indexOf('[AUTHORITATIVE ENTRY CONTEXT')).toBeGreaterThan(
    prompt.indexOf('[INTERACTION STEER]'),
  );
  expect(prompt).toContain('this entry context supersedes it');
});
