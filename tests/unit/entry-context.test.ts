import { expect, test } from '@playwright/test';
import { computeUserChronology } from '@/lib/agent/chronology';
import { buildCompanionEntryContext, deriveEntryStyle } from '@/lib/agent/entry-context';
import { resolveUserTimeZone } from '@/lib/agent/timezone';
import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';

test('builds a bounded historical session summary and optional bridges', () => {
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
  expect(packet.version).toBe(3);
  expect(packet.entryStyle).toMatchObject({
    band: 'new_day', opening: 'morning_welcome', energy: 'high',
  });
  expect(packet.previousSessionSummary?.id).toMatch(/^ts_[a-f0-9]{16}_\d+$/u);
  expect(packet.previousSessionSummary?.touchedThreadIds).toEqual(['a', 'b']);
  expect(packet.previousSessionSummary?.majorTopics).toEqual(['late night', 'night']);
  expect(packet.bridgeCandidates).toHaveLength(2);
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
  const residueRows = [{ chatId: 'a', role: 'user', parts: [{ type: 'text', text: 'night' }], createdAt: new Date('2026-08-22T00:32:00Z') }];
  const first = buildCompanionEntryContext({ userId: 'user-a', chronology, timeZone: 'Europe/London', residueRows });
  const second = buildCompanionEntryContext({ userId: 'user-b', chronology, timeZone: 'Europe/London', residueRows });
  expect(first.previousSessionSummary?.id).not.toBe(second.previousSessionSummary?.id);
});

test('bridge candidates can come from an older recent session', () => {
  const chronology = computeUserChronology({
    interactionTimes: [
      { createdAt: new Date('2026-08-22T08:00:00Z') },
      { createdAt: new Date('2026-08-22T10:00:00Z') },
    ],
    now: new Date('2026-08-22T12:00:00Z'),
    timeZone: 'Europe/London',
  });
  const packet = buildCompanionEntryContext({
    userId: 'user-a', chronology, timeZone: 'Europe/London',
    residueRows: [
      { chatId: 'a', role: 'user', parts: [{ type: 'text', text: 'I am going for a sunset walk' }], createdAt: new Date('2026-08-22T08:00:00Z') },
      { chatId: 'b', role: 'user', parts: [{ type: 'text', text: 'I made coffee' }], createdAt: new Date('2026-08-22T10:00:00Z') },
    ],
  });
  expect(packet.recentSessionSummaries).toHaveLength(2);
  expect(packet.bridgeCandidates.some((candidate) => candidate.summary.includes('sunset walk'))).toBe(true);
});

test('authoritative entry context is preserved without an app behavioral steer', () => {
  const entryContext = {
    version: 3 as const,
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
    entryStyle: {
      band: 'new_day' as const,
      opening: 'morning_welcome' as const,
      energy: 'high' as const,
      acknowledgeReturn: true,
    },
    previousSessionSummary: null,
    recentSessionSummaries: [],
    bridgeCandidates: [],
    thread: null,
  };
  const prompt = buildSophieReplySystemPrompt({
    entryContext,
  });
  const coreIndex = prompt.indexOf('[SOPHIE — CORE IDENTITY]');
  const entryIndex = prompt.indexOf('[AUTHORITATIVE ENTRY CONTEXT');
  expect(coreIndex).toBeGreaterThan(-1);
  expect(entryIndex).toBeGreaterThan(coreIndex);
  expect(prompt).toContain('previousSessionSummary is historical description');
  expect(prompt).toContain('actually welcome the user');
});

test('entry style uses stable elapsed-time bands', () => {
  const chronology = (gapMinutes: number) => computeUserChronology({
    interactionTimes: [{ createdAt: new Date(Date.UTC(2026, 7, 22, 20, 0) - gapMinutes * 60_000) }],
    now: new Date(Date.UTC(2026, 7, 22, 20, 0)),
    timeZone: 'Europe/London',
  });
  expect(deriveEntryStyle(chronology(59)).band).toBe('continuous');
  expect(deriveEntryStyle(chronology(60)).band).toBe('brief_return');
  expect(deriveEntryStyle(chronology(179)).band).toBe('brief_return');
  expect(deriveEntryStyle(chronology(180)).band).toBe('return');
  expect(deriveEntryStyle(chronology(359)).band).toBe('return');
  expect(deriveEntryStyle(chronology(360)).band).toBe('long_return');
  expect(deriveEntryStyle(chronology(719)).band).toBe('long_return');
  expect(deriveEntryStyle(chronology(720)).band).toBe('extended_return');
});
