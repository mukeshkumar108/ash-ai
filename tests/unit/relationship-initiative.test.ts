import { expect, test } from '@playwright/test';

import { evaluateInitiative } from '@/lib/ai/relationship/evaluator';
import { retrieveRelationshipEvidence } from '@/lib/ai/relationship/evidence';
import {
  canonicalInitiativeMessage,
  checkInitiativeEligibility,
  enforceSingleQuestion,
  initiativeDedupeKey,
  INITIATIVE_POLICY,
  mayUseDecision,
  unansweredFollowUpDelayMs,
} from '@/lib/ai/relationship/policy';

const decision = {
  conversationState: {
    signal: 'open' as const,
    confidence: 0.96,
    reason: 'The user is actively engaged in conversation.',
  },
  orientation: 'social' as const,
  posture: 'ask' as const,
  postureConfidence: 0.9,
  postureReason: 'The user is open to a little more conversation.',
  nudgeJustification: null,
  relationalIntent: {
    kind: 'curiosity' as const,
    guidance: 'Create space for the user to talk about life outside work.',
  },
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

  test('accepts semantic multilingual and indirect boundary classifications', async () => {
    const closing = await evaluateInitiative({
      trigger: 'post_turn',
      recentConversation: 'user: yaaaa me tengo q ir 😭',
      memoryEvidence: null,
      recentTopicKeys: [],
      signal: AbortSignal.timeout(100),
      generate: async () => ({
        ...decision,
        act: false,
        guidance: null,
        conversationState: {
          signal: 'closing',
          confidence: 0.98,
          reason: 'The user says they have to leave.',
        },
      }),
    });
    expect(closing.conversationState.signal).toBe('closing');

    const indirect = await evaluateInitiative({
      trigger: 'post_turn',
      recentConversation: 'user: mum is shouting at me to get off my phone 😂',
      memoryEvidence: null,
      recentTopicKeys: [],
      signal: AbortSignal.timeout(100),
      generate: async () => ({
        ...decision,
        act: false,
        guidance: null,
        conversationState: {
          signal: 'closing',
          confidence: 0.91,
          reason: 'An external circumstance is ending availability.',
        },
      }),
    });
    expect(indirect.conversationState.signal).toBe('closing');
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

  test('semantic closing is enforced while reported speech remains open', () => {
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          conversationState: {
            signal: 'closing',
            confidence: 0.96,
            reason: 'The user is ending this conversation.',
          },
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(false);
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          conversationState: {
            signal: 'open',
            confidence: 0.95,
            reason:
              'The user reported saying goodnight to someone else and continued this conversation.',
          },
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(true);
  });

  test('semantic seeking-company overrides generic busyness', () => {
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          conversationState: {
            signal: 'seeking_company',
            confidence: 0.97,
            reason: 'The user is working but explicitly wants company.',
          },
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(true);
  });

  test('hold is a valid non-steering posture', () => {
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          posture: 'hold',
          postureReason: 'The moment needs presence rather than direction.',
          relationalIntent: {
            kind: 'presence',
            guidance: 'Stay with what the user shared.',
          },
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(true);
  });

  test('weakly justified nudge is rejected', () => {
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          posture: 'nudge',
          postureConfidence: 0.6,
          postureReason: 'Maybe intervention would help.',
          nudgeJustification: null,
          evidence: [],
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(false);
  });

  test('well-supported nudge remains available but rare', () => {
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          posture: 'nudge',
          postureConfidence: 0.91,
          postureReason: 'A repeated concrete pattern merits one gentle move.',
          nudgeJustification:
            'The user explicitly described skipping dinner to work on three recent evenings.',
          evidence: ['The user said they skipped dinner to keep working.'],
          relationalIntent: {
            kind: 'challenge',
            guidance: 'Gently suggest eating before continuing.',
          },
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(true);
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
