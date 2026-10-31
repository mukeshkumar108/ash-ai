import { test, expect } from '@playwright/test';

import {
  GOOGLE_CAPABILITY_DECLARATIONS,
  runGoogleCapability,
  type GoogleDeps,
} from '@/lib/ai/google-capabilities';

const calls: string[] = [];
const deps: GoogleDeps = {
  getEvents: async () =>
    ({ events: [{ eventId: 'e1', title: 'Dentist', start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z', startDate: null, endDate: null, allDay: false, location: null }] }) as any,
  getMessages: async () =>
    [{ messageId: 'm1', threadId: 't1', sender: 'a@b.co', recipients: [], subject: 'Hi', date: 'x', snippet: 'hello', labelIds: [], isUnread: true }] as any,
  makeDraft: async (_u, input) => {
    calls.push(`draft:${input.to.join(',')}`);
    return { draftId: 'd1' } as any;
  },
  makeEvent: async (_u, input, key) => {
    calls.push(`event:${input.title}:${key}`);
    return { eventId: 'ev1' } as any;
  },
};

test('reads come back as observations and send nothing', async () => {
  const a = await runGoogleCapability('u', 'calendar.agenda', { days: 3 }, 'w1', deps);
  expect(a.resultRef).toBe('events:1');
  expect(a.detail).toContain('Dentist');
  const m = await runGoogleCapability('u', 'gmail.search', {}, 'w1', deps);
  expect(m.resultRef).toBe('messages:1');
  expect(calls).toEqual([]);
});

test('a draft needs a real recipient and is reported as not sent', async () => {
  await expect(runGoogleCapability('u', 'gmail.draft', { to: ['nobody'], subject: 's', body: 'b' }, 'w', deps)).rejects.toThrow(/recipient/);
  const d = await runGoogleCapability('u', 'gmail.draft', { to: ['josh@example.com'], subject: 'Thursday', body: 'Still on?' }, 'w', deps);
  expect(d.detail).toContain('not sent');
  expect(calls).toContain('draft:josh@example.com');
});

test('an event needs times with an offset and an end after the start; the work item is the idempotency key', async () => {
  await expect(runGoogleCapability('u', 'calendar.create', { title: 't', start: '2026-11-02T10:00', end: '2026-11-02T11:00' }, 'w', deps)).rejects.toThrow(/offset/);
  await expect(runGoogleCapability('u', 'calendar.create', { title: 't', start: '2026-11-02T11:00:00Z', end: '2026-11-02T10:00:00Z' }, 'w', deps)).rejects.toThrow(/after/);
  const e = await runGoogleCapability('u', 'calendar.create', { title: 'Coffee', start: '2026-11-02T10:00:00Z', end: '2026-11-02T11:00:00Z' }, 'wi-9', deps);
  expect(e.resultRef).toBe('ev1');
  expect(calls).toContain('event:Coffee:exec-wi-9');
});

test('nothing declared can send mail, and event creation is not declared low-risk', () => {
  expect(GOOGLE_CAPABILITY_DECLARATIONS.map((d) => d.tool)).not.toContain('gmail.send');
  const create = GOOGLE_CAPABILITY_DECLARATIONS.find((d) => d.tool === 'calendar.create');
  expect(create?.consequence).toBe('moderate');
});
