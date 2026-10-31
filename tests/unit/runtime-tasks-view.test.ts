import { test, expect } from '@playwright/test';

import { bucketTasks } from '@/lib/tasks/runtime-view';

const now = new Date('2026-10-31T10:00:00Z');
const t = (id: string, dueAt: string | null, status = 'pending') => ({ id, title: id, status, dueAt: dueAt ? new Date(dueAt) : null });

test('today, overdue, upcoming and undated are split by the person\'s local day', () => {
  const r = bucketTasks([
    t('today-evening', '2026-10-31T19:00:00Z'),
    t('yesterday', '2026-10-30T09:00:00Z'),
    t('tomorrow', '2026-11-01T09:00:00Z'),
    t('next-month', '2026-12-01T09:00:00Z'),
    t('no-date', null),
    t('done', '2026-10-31T09:00:00Z', 'completed'),
  ], now, 'Europe/London');
  expect(r.today.map((x) => x.id)).toEqual(['today-evening']);
  expect(r.overdue.map((x) => x.id)).toEqual(['yesterday']);
  expect(r.upcoming.map((x) => x.id)).toEqual(['tomorrow']);
  expect(r.undated.map((x) => x.id)).toEqual(['no-date']);
});

test('the local day decides, not UTC: late evening UTC is already tomorrow in Sydney', () => {
  const r = bucketTasks([t('late', '2026-10-31T23:30:00Z')], now, 'Australia/Sydney');
  expect(r.today.map((x) => x.id)).toEqual([]);
  expect(r.time_zone).toBe('Australia/Sydney');
});

test('a bad time zone falls back instead of failing', () => {
  expect(bucketTasks([], now, 'Not/AZone').time_zone).toBe('Europe/London');
});
