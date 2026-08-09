import { expect, test } from '@playwright/test';

import { evaluateInitiative } from '@/lib/ai/relationship/evaluator';
import { retrieveRelationshipEvidence } from '@/lib/ai/relationship/evidence';
import {
  canonicalInitiativeMessage,
  checkInitiativeEligibility,
  enforceSingleQuestion,
  hasRecentDepartureSignal,
  initiativeDedupeKey,
  INITIATIVE_POLICY,
  mayUseDecision,
  unansweredFollowUpDelayMs,
} from '@/lib/ai/relationship/policy';

const decision = {
  act: true,
  kind: 'curiosity' as const,
  reason: 'There is a natural gap worth exploring.',
  guidance: 'Ask naturally about what the user does for fun.',
  evidence: ['The conversation has focused almost entirely on work.'],
  topicKey: 'life_outside_work',
  sensitive: false,
};

test.describe('relationship initiative evaluator', () => {
  test('can choose no action', async () => {
    const result = await evaluateInitiative({
      trigger: 'post_turn',
      recentConversation: 'user: hello',
      memoryEvidence: null,
      recentTopicKeys: [],
      signal: AbortSignal.timeout(100),
      generate: async () => ({ ...decision, act: false, guidance: null }),
    });
    expect(result.act).toBe(false);
  });

  test('can produce a curiosity candidate', async () => {
    const result = await evaluateInitiative({
      trigger: 'active_idle',
      recentConversation: 'assistant: sounds good',
      memoryEvidence: 'Work is well known; hobbies are sparse.',
      recentTopicKeys: [],
      signal: AbortSignal.timeout(100),
      generate: async () => decision,
    });
    expect(result).toMatchObject({ act: true, kind: 'curiosity' });
  });

  test('malformed model output fails closed', async () => {
    await expect(
      evaluateInitiative({
        trigger: 'post_turn',
        recentConversation: '',
        memoryEvidence: null,
        recentTopicKeys: [],
        signal: AbortSignal.timeout(100),
        generate: async () => ({ act: true, kind: 'invented' }),
      }),
    ).rejects.toThrow();
  });

  test('Honcho failure fails closed without throwing into chat', async () => {
    const evidence = await retrieveRelationshipEvidence(
      'user',
      'chat',
      async () => {
        throw new Error('offline');
      },
    );
    expect(evidence).toEqual({ packet: null, source: 'error' });
  });
});

test.describe('relationship initiative policy', () => {
  test('a retry has the same dedupe key', () => {
    const input = {
      userId: 'u',
      chatId: 'c',
      trigger: 'post_turn' as const,
      anchorMessageId: 'm',
    };
    expect(initiativeDedupeKey(input)).toBe(initiativeDedupeKey(input));
  });

  test('active idle cannot fire if a new user message arrived', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'active_idle',
        anchorMessageId: 'old',
        latestMessageId: 'new',
        latestRole: 'user',
        idleForMs: INITIATIVE_POLICY.idleMs,
        dailyCount: 0,
        unansweredCount: 0,
      }),
    ).toBe('conversation_changed');
  });

  test('one unanswered initiative delays rather than freezes follow-up', () => {
    const requiredGap = unansweredFollowUpDelayMs('m');
    expect(
      checkInitiativeEligibility({
        trigger: 'post_turn',
        anchorMessageId: 'm',
        latestMessageId: 'm',
        latestRole: 'assistant',
        idleForMs: 0,
        dailyCount: 0,
        unansweredCount: 1,
        msSinceLatestUnanswered: requiredGap - 1,
        requiredUnansweredGapMs: requiredGap,
      }),
    ).toBe('unanswered_followup_too_soon');
    expect(
      checkInitiativeEligibility({
        trigger: 'post_turn',
        anchorMessageId: 'm',
        latestMessageId: 'm',
        latestRole: 'assistant',
        idleForMs: 0,
        dailyCount: 0,
        unansweredCount: 1,
        msSinceLatestUnanswered: requiredGap,
        requiredUnansweredGapMs: requiredGap,
      }),
    ).toBeNull();
  });

  test('two unanswered initiatives stop further outreach', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'active_idle',
        anchorMessageId: 'm',
        latestMessageId: 'm',
        latestRole: 'assistant',
        idleForMs: INITIATIVE_POLICY.idleMs,
        dailyCount: 2,
        unansweredCount: 2,
      }),
    ).toBe('unanswered_limit');
  });

  test('departure closes initiative while an invitation to stay reopens it', () => {
    expect(
      hasRecentDepartureSignal(
        'user: I have got to go, goodnight\nassistant: sleep well',
      ),
    ).toBe(true);
    expect(
      hasRecentDepartureSignal(
        "user: no, don't leave — stay and talk to me\nassistant: okay",
      ),
    ).toBe(false);
  });

  test('initiative messages are ordinary canonical assistant messages', () => {
    const row = canonicalInitiativeMessage({
      id: 'm',
      chatId: 'c',
      text: 'random question?',
      createdAt: new Date(0),
    });
    expect(row).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', text: 'random question?' }],
      attachments: [],
    });
  });

  test('generated initiative contains at most one question', () => {
    expect(enforceSingleQuestion('What do you do for fun?')).toBeTruthy();
    expect(enforceSingleQuestion('What do you do? Why?')).toBeNull();
  });

  test('sensitive curiosity requires relationship evidence', () => {
    expect(
      mayUseDecision({
        decision: { ...decision, sensitive: true },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: false,
      }),
    ).toBe(false);
  });

  test('recent curiosity topics are not repeated', () => {
    expect(
      mayUseDecision({
        decision,
        trigger: 'post_turn',
        recentTopicKeys: ['life_outside_work'],
        hasSensitiveSupport: true,
      }),
    ).toBe(false);
  });
});
