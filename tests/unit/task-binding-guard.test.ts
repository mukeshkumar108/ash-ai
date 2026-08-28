import { test, expect } from '@playwright/test';

import {
  locateEvidenceVerbatim,
  resolveDestructiveBinding,
  titleReferenceSignal,
  fastCreateCandidateKey,
} from '@/lib/ai/interaction/interpreter';

function roster(...titles: string[]) {
  return titles.map((title, index) => ({
    taskId: `task-${index + 1}`,
    title,
    dueAt: null,
  }));
}

test('resolveDestructiveBinding: single roster item is always safe', () => {
  const [only] = roster('Renew passport');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      recentContext: '',
      roster: [only],
      modelTargetTaskId: only.taskId,
    }),
  ).toEqual({ ok: true });
});

test('resolveDestructiveBinding: unique lexical title reference commits', () => {
  const [dentist, gift] = roster('Book the dentist', 'Buy a gift');
  expect(
    resolveDestructiveBinding({
      userText: 'cancel the dentist',
      recentContext: '',
      roster: [dentist, gift],
      modelTargetTaskId: dentist.taskId,
    }),
  ).toEqual({ ok: true });
});

test('resolveDestructiveBinding: a wrong model binding on an explicit title is rejected', () => {
  const [dentist, gift] = roster('Book the dentist', 'Buy a gift');
  expect(
    resolveDestructiveBinding({
      userText: 'cancel the dentist',
      recentContext: '',
      roster: [dentist, gift],
      modelTargetTaskId: gift.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('resolveDestructiveBinding: tie in the user text is consequential ambiguity', () => {
  const [mum, dad] = roster('Call Mum today', 'Call Dad today');
  expect(
    resolveDestructiveBinding({
      userText: 'call them',
      recentContext: '',
      roster: [mum, dad],
      modelTargetTaskId: mum.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('resolveDestructiveBinding: recent-context grounding resolves pronouns', () => {
  const [dentist, gift] = roster('Book the dentist', 'Buy a gift');
  expect(
    resolveDestructiveBinding({
      userText: 'cancel that',
      recentContext: "user: book the dentist\nassistant: I'll remind you to book the dentist.",
      roster: [dentist, gift],
      modelTargetTaskId: dentist.taskId,
    }),
  ).toEqual({ ok: true });
});

test('resolveDestructiveBinding: no lexical or contextual grounding fails closed', () => {
  const [a, b] = roster('Pay the rent', 'File expenses');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      recentContext: '',
      roster: [a, b],
      modelTargetTaskId: a.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('resolveDestructiveBinding: unknown target id is unresolved', () => {
  const [a] = roster('Pay the rent');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      recentContext: '',
      roster: [a],
      modelTargetTaskId: 'task-unknown',
    }),
  ).toEqual({ ok: false, reason: 'unresolved_target_binding' });
});

test('titleReferenceSignal scores distinctive words, not short words', () => {
  expect(
    titleReferenceSignal('remind me to call Mum tomorrow', 'Call Mum'),
  ).toBeGreaterThanOrEqual(2);
  expect(titleReferenceSignal('cancel the dentist', 'Buy a gift')).toBe(0);
});

test('locateEvidenceVerbatim is whitespace/typography tolerant', () => {
  expect(locateEvidenceVerbatim("it's  finally  done—yesterday", "it's finally done")).toBe(true);
  expect(locateEvidenceVerbatim('remind me to call mum', 'clean the car')).toBe(false);
});

test('fastCreateCandidateKey is deterministic and message-scoped', () => {
  const first = fastCreateCandidateKey({
    originMessageId: 'msg-1',
    title: 'Call Mum',
    evidence: 'remind me to call Mum',
  });
  const second = fastCreateCandidateKey({
    originMessageId: 'msg-1',
    title: 'Call Mum',
    evidence: 'remind me to call Mum',
  });
  const otherMessage = fastCreateCandidateKey({
    originMessageId: 'msg-2',
    title: 'Call Mum',
    evidence: 'remind me to call Mum',
  });
  expect(first).toBe(second);
  expect(first).not.toBe(otherMessage);
});