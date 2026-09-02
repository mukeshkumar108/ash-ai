import { strict as assert } from 'node:assert';
import { normalizeDueFromTemporalBasis } from '@/lib/ai/interaction/temporal-basis';

const referenceTime = new Date('2026-09-01T18:50:00Z');

const tonight = normalizeDueFromTemporalBasis({
  dueIso: '2026-09-02T20:00:00+01:00',
  scope: 'current_day',
  temporalEvidenceValid: true,
  referenceTime,
  timeZone: 'Europe/London',
});
assert.equal(tonight.dueIso, '2026-09-01T20:00:00+01:00');
assert.equal(tonight.rejection, null);

const inventedTomorrow = normalizeDueFromTemporalBasis({
  dueIso: '2026-09-02T20:00:00+01:00',
  scope: 'none',
  temporalEvidenceValid: false,
  referenceTime,
  timeZone: 'Europe/London',
});
assert.equal(inventedTomorrow.dueIso, null);
assert.equal(inventedTomorrow.rejection, 'due_without_verbatim_temporal_basis');

const explicitTomorrow = normalizeDueFromTemporalBasis({
  dueIso: '2026-09-02T09:00:00+01:00',
  scope: 'future_explicit',
  temporalEvidenceValid: true,
  referenceTime,
  timeZone: 'Europe/London',
});
assert.equal(explicitTomorrow.dueIso, '2026-09-02T09:00:00+01:00');

console.log('temporal basis: 3/3 passed');
