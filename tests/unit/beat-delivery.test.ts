import { expect, test } from '@playwright/test';

import { isBeatAvailable } from '@/lib/agent/beat-delivery';

test('a continuation stays hidden before its persisted availability time', () => {
  expect(isBeatAvailable('2026-08-22T12:00:02.000Z', Date.parse('2026-08-22T12:00:01.000Z'))).toBe(false);
});

test('refresh or reconnect reveals a continuation once its absolute time is due', () => {
  expect(isBeatAvailable('2026-08-22T12:00:02.000Z', Date.parse('2026-08-22T12:00:03.000Z'))).toBe(true);
});
