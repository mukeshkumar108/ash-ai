import { expect, test } from '@playwright/test';

import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';

test('new UserDay posture reaches the direct TypeScript prompt path', () => {
  const prompt = buildSophieReplySystemPrompt({
    reentry: {
      class: 'HARD_REENTRY',
      turnIndex: 1,
      gapMinutes: 600,
      crossedLocalDay: true,
      routeReason: 'first contact UserDay',
      selectedForegroundModel: 'test',
      manualOverride: false,
      richerSteerActive: true,
      staleLightweightPhase: true,
    } as never,
    entryContext: {
      version: 3,
      timeZone: 'Europe/London',
      chronology: {
        temporalSession: 'new',
        userDay: '2026-08-22',
        daypart: 'morning',
        firstContactUserDay: true,
        gapMinutes: 600,
        sessionStartedAt: '2026-08-22T07:00:00.000Z',
        sessionsToday: 1,
      },
      entryStyle: {
        band: 'new_day', opening: 'morning_welcome', energy: 'high',
        acknowledgeReturn: true,
      },
      previousSessionSummary: null,
      recentSessionSummaries: [],
      bridgeCandidates: [],
      thread: null,
    },
  });
  expect(prompt).toContain('[BEHAVIORAL ENTRY POSTURE]');
  expect(prompt).toContain('new_day_encounter');
  expect(prompt).toContain('do not open by paraphrasing or resuming it');
});
