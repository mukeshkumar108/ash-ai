import { expect, test } from '@playwright/test';

import {
  cancelPendingBeatDeliveries,
  isBeatAvailable,
  isBeatVisible,
  visibleMessagePartsAt,
} from '@/lib/agent/beat-delivery';

test('a continuation stays hidden before its persisted availability time', () => {
  expect(isBeatAvailable('2026-08-22T12:00:02.000Z', Date.parse('2026-08-22T12:00:01.000Z'))).toBe(false);
});

test('refresh or reconnect reveals a continuation once its absolute time is due', () => {
  expect(isBeatAvailable('2026-08-22T12:00:02.000Z', Date.parse('2026-08-22T12:00:03.000Z'))).toBe(true);
});

test('a new user turn persistently cancels an unseen continuation', () => {
  const parts = [
    { type: 'data-beatDelivery', data: { beatIndex: 0, kind: 'immediate', availableAt: '2026-08-22T12:00:00.000Z' } },
    { type: 'text', text: 'first' },
    { type: 'data-beatDelivery', data: { beatIndex: 1, kind: 'continuation', availableAt: '2026-08-22T12:00:10.000Z' } },
    { type: 'text', text: 'stale second' },
  ];
  const cancelled = cancelPendingBeatDeliveries(parts, new Date('2026-08-22T12:00:05.000Z'));
  expect(cancelled.changed).toBe(true);
  const delivery = (cancelled.parts as Array<{ data?: { availableAt?: string; cancelledAt?: string } }>)[2].data;
  expect(delivery).toBeDefined();
  if (!delivery) throw new Error('missing delivery metadata');
  expect(delivery.cancelledAt).toBe('2026-08-22T12:00:05.000Z');
  expect(isBeatVisible(delivery.availableAt, delivery.cancelledAt, Date.parse('2026-08-22T12:01:00.000Z'))).toBe(false);
  expect(visibleMessagePartsAt(cancelled.parts, new Date('2026-08-22T12:01:00.000Z'))).toEqual(parts.slice(0, 2));
});
