import { expect, test } from '@playwright/test';
import {
  enforceMemoryPatchAuthority,
  selectTopContinuityEvents,
} from '@/lib/ai/summarizer';

test('keeps the three strongest events instead of rejecting a larger result', () => {
  const events = [
    { id: 'fantasy', summary: 'Imagined possibility', importance: 90, actuality: 'FANTASY_CONTENT', persist: false },
    { id: 'minor', summary: 'Minor scene affect', importance: 20, actuality: 'TEMPORARY_SCENE_AFFECT', persist: true },
    { id: 'fact', summary: 'A major event happened', importance: 80, actuality: 'ACTUAL_EVENT', persist: true },
    { id: 'truth', summary: 'A durable truth was established', importance: 75, actuality: 'RELATIONAL_TRUTH', persist: true },
    { id: 'open', summary: 'A consequence remains unresolved', importance: 70, actuality: 'ACTUAL_EVENT', persist: true, unresolved: true },
  ];

  expect(selectTopContinuityEvents(events).map(event => event.id)).toEqual([
    'open',
    'fact',
    'truth',
  ]);
});

test('deduplicates repeated event IDs before applying the limit', () => {
  const events = [
    { id: 'same', summary: 'Earlier wording', importance: 90, actuality: 'ACTUAL_EVENT' },
    { id: 'same', summary: 'Repeated wording', importance: 80, actuality: 'ACTUAL_EVENT' },
    { id: 'other', summary: 'Another event', importance: 70, actuality: 'ACTUAL_EVENT' },
  ];

  expect(selectTopContinuityEvents(events).map(event => event.id)).toEqual([
    'same',
    'other',
  ]);
});

test('performed betrayal cannot manufacture rules, boundaries, or identity', () => {
  const safe = enforceMemoryPatchAuthority({
    core_facts: ['The companion secretly met Marco.'],
    relationship_rules: ['She will maintain a secret affair.'],
    agreements: ['Marco may summon her whenever he wants.'],
    boundaries: ['She has no boundary against cheating.'],
    active_desires: ['She desires betrayal.'],
    fantasy_themes: ['Secret affair lifestyle.'],
  }, [{
    role: 'user',
    content: 'Continue the cheating betrayal scene. Marco tells her to keep it secret.',
  }], 'user_directed_experiment');

  expect(safe.core_facts).toEqual(['The companion secretly met Marco.']);
  expect(safe.relationship_rules).toBeUndefined();
  expect(safe.agreements).toBeUndefined();
  expect(safe.boundaries).toBeUndefined();
  expect(safe.active_desires).toBeUndefined();
  expect(safe.fantasy_themes).toBeUndefined();
});

test('explicit user agreements may create scoped relationship rules', () => {
  const safe = enforceMemoryPatchAuthority({
    relationship_rules: ['A named, scoped experiment is permitted.'],
    agreements: ['Both agreed to the experiment.'],
  }, [{
    role: 'user',
    content: 'We agree to explore this together. I explicitly consent to this one scene.',
  }], 'user_directed_experiment');

  expect(safe.relationship_rules).toHaveLength(1);
  expect(safe.agreements).toHaveLength(1);
});
