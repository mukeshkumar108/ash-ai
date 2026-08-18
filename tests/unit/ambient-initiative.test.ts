import { expect, test } from '@playwright/test';

import { initiativeDedupeKey } from '@/lib/ai/relationship/policy';
import {
  ambientCandidateForSituation,
  buildInitiativeSituation,
} from '@/lib/ai/relationship/situation';
import type { ChatMessage } from '@/lib/types';
import { mergePaginatedMessages } from '@/lib/utils';

function situationAt(hour: number, todaysConversation = '') {
  return buildInitiativeSituation({
    now: new Date(`2026-08-18T${String(hour).padStart(2, '0')}:30:00+01:00`),
    timeZone: 'Europe/London',
    lastInteractionAt: new Date('2026-08-18T15:00:00+01:00'),
    interactionsToday: 3,
    todaysConversation,
  });
}

test('day recap is not an ambient candidate before 18:00', () => {
  expect(ambientCandidateForSituation(situationAt(17))).toBeNull();
});

test('evening is eligible regardless of whether it is the first interaction', () => {
  const situation = situationAt(18);
  expect(situation.firstInteractionToday).toBe(false);
  expect(ambientCandidateForSituation(situation)).toMatchObject({
    kind: 'evening_day_recap',
    key: 'evening_day_recap:2026-08-18',
  });
});

test('today conversation is preserved so judgment can see the day was covered', () => {
  const situation = situationAt(
    20,
    'user: My day was good and I already went for my walk.\nassistant: That sounds satisfying.',
  );
  expect(situation.todaysConversation).toContain('already went for my walk');
});

test('trusted weather and routines remain evidence rather than inferred obligations', () => {
  const situation = buildInitiativeSituation({
    now: new Date('2026-08-22T17:30:00+01:00'),
    timeZone: 'Europe/London',
    lastInteractionAt: new Date('2026-08-22T12:00:00+01:00'),
    interactionsToday: 1,
    todaysConversation: '',
    trustedFacts: {
      weather: { condition: 'sunny' },
      routines: [
        {
          description: 'The user often takes afternoon walks.',
          evidence: 'explicit user statement',
        },
      ],
    },
  });
  expect(situation.trustedFacts).toMatchObject({
    weather: { condition: 'sunny' },
    routines: [{ evidence: 'explicit user statement' }],
  });
});

test('school context preserves UNKNOWN rather than inferring age', () => {
  const situation = buildInitiativeSituation({
    now: new Date('2026-08-24T15:45:00+01:00'),
    timeZone: 'Europe/London',
    lastInteractionAt: null,
    interactionsToday: 0,
    todaysConversation: '',
    trustedFacts: {
      school_or_work: {
        fact: 'The user said their child finishes school at 15:30.',
        childAge: 'UNKNOWN',
      },
    },
  });
  expect(situation.trustedFacts).toMatchObject({
    school_or_work: { childAge: 'UNKNOWN' },
  });
});

test('daily ambient dedupe is user-wide rather than chat-wide', () => {
  const common = {
    userId: 'user',
    trigger: 'ambient_scan' as const,
    anchorMessageId: 'anchor',
    dedupeScopeKey: 'evening_day_recap:2026-08-18',
  };
  expect(initiativeDedupeKey({ ...common, chatId: 'newest-chat' })).toBe(
    initiativeDedupeKey({ ...common, chatId: 'older-chat' }),
  );
});

test('open-chat reconciliation appends a server initiative', () => {
  const current = [
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    {
      id: 'assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hey' }],
    },
  ] as ChatMessage[];
  const server = [
    ...current,
    {
      id: 'initiative',
      role: 'assistant',
      parts: [{ type: 'text', text: 'another thought' }],
    },
  ] as ChatMessage[];
  expect(
    mergePaginatedMessages(current, server).map((item) => item.id),
  ).toEqual(['user', 'assistant', 'initiative']);
});

test('open-chat reconciliation does not duplicate an existing initiative', () => {
  const messages = [
    {
      id: 'assistant',
      role: 'assistant',
      parts: [{ type: 'text', text: 'hey' }],
    },
    {
      id: 'initiative',
      role: 'assistant',
      parts: [{ type: 'text', text: 'another thought' }],
    },
  ] as ChatMessage[];
  expect(mergePaginatedMessages(messages, messages)).toHaveLength(2);
});
