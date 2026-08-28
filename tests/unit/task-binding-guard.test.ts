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

test('unique lexical title reference in user text commits', () => {
  const [dentist, gift] = roster('Book the dentist', 'Buy a gift');
  expect(
    resolveDestructiveBinding({
      userText: 'cancel the dentist',
      assistantText: 'sure',
      roster: [dentist, gift],
      modelTargetTaskId: dentist.taskId,
    }),
  ).toEqual({ ok: true });
});

test('user naming a DIFFERENT task than the model target is rejected', () => {
  const [dentist, gift] = roster('Book the dentist', 'Buy a gift');
  expect(
    resolveDestructiveBinding({
      userText: 'cancel the dentist',
      assistantText: 'sure',
      roster: [dentist, gift],
      modelTargetTaskId: gift.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('tie in the user text is consequential ambiguity', () => {
  const [mum, dad] = roster('Call Mum today', 'Call Dad today');
  expect(
    resolveDestructiveBinding({
      userText: 'call them',
      assistantText: 'sure',
      roster: [mum, dad],
      modelTargetTaskId: mum.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('visible reply naming the target agrees and commits', () => {
  const [dentist, gift] = roster('Book the dentist', 'Buy a gift');
  expect(
    resolveDestructiveBinding({
      userText: 'cancel that',
      assistantText: "I'll drop the dentist booking reminder.",
      roster: [dentist, gift],
      modelTargetTaskId: dentist.taskId,
    }),
  ).toEqual({ ok: true });
});

test('visible reply naming a DIFFERENT task vetoes the model target (the "no, the other one" counterexample)', () => {
  const [landlord, rent] = roster('Talk to the landlord', 'Pay the rent');
  expect(
    resolveDestructiveBinding({
      userText: 'no, the other one',
      assistantText: 'Oh! The rent one then. Dropping it.',
      roster: [landlord, rent],
      modelTargetTaskId: landlord.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('bare pronoun with multiple plausible tasks fails closed (no context-only commit)', () => {
  const [a, b] = roster('Pay the rent', 'File expenses');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      assistantText: 'Done.',
      roster: [a, b],
      modelTargetTaskId: a.taskId,
    }),
  ).toEqual({ ok: false, reason: 'ambiguous_target' });
});

test('single pending roster item is always unambiguous', () => {
  const [only] = roster('Renew passport');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      assistantText: 'Done.',
      roster: [only],
      modelTargetTaskId: only.taskId,
    }),
  ).toEqual({ ok: true });
});

test('single roster item is unambiguous even when the reply names nothing', () => {
  const [only] = roster('Call the plumber');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      assistantText: 'what exactly did you finish?',
      roster: [only],
      modelTargetTaskId: only.taskId,
    }),
  ).toEqual({ ok: true });
});

test('unknown target id is unresolved', () => {
  const [a] = roster('Pay the rent');
  expect(
    resolveDestructiveBinding({
      userText: 'I did it',
      assistantText: 'Done.',
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