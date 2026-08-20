import { expect, test } from '@playwright/test';

import { evaluateInitiative } from '@/lib/ai/relationship/evaluator';
import { retrieveRelationshipEvidence } from '@/lib/ai/relationship/evidence';
import {
  hasPlausibleContinuityCandidate,
  repeatsRecentlyAddressedTopic,
  retrieveInitiativeContinuity,
} from '@/lib/ai/relationship/continuity';
import {
  canonicalInitiativeMessage,
  checkInitiativeEligibility,
  decisionPolicyRejection,
  initiativeDedupeKey,
  initiativeOpportunityForSteer,
  INITIATIVE_POLICY,
  mayUseDecision,
  unansweredFollowUpDelayMs,
  validateInitiativeText,
} from '@/lib/ai/relationship/policy';

test('active steer creates a durable 90-second reconsideration opportunity', () => {
  const createdAt = new Date('2026-08-20T20:00:00.000Z');
  const opportunity = initiativeOpportunityForSteer(
    {
      posture: 'ask',
      phase: 'curiosity',
      objective: 'Stay with a grounded curiosity.',
      strength: 'medium',
      turnsRemaining: 3,
      initiativePermission: 'medium',
      expressionShape: 'single',
      reason: 'A meaningful thread remains open.',
      lastTactic: null,
    },
    createdAt,
  );
  expect(opportunity.trigger).toBe('second_thought');
  expect(opportunity.notBefore.getTime() - createdAt.getTime()).toBe(
    INITIATIVE_POLICY.secondThoughtMs,
  );
});

test('ordinary reply creates a durable active-idle opportunity', () => {
  const createdAt = new Date('2026-08-20T20:00:00.000Z');
  const opportunity = initiativeOpportunityForSteer(null, createdAt);
  expect(opportunity.trigger).toBe('active_idle');
  expect(opportunity.notBefore.getTime() - createdAt.getTime()).toBe(
    INITIATIVE_POLICY.idleMs,
  );
});

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
  holdJustification: null,
  nudgeJustification: null,
  relationalIntent: {
    kind: 'curiosity' as const,
    guidance: 'Create space for the user to talk about life outside work.',
  },
  beatAssessment: {
    previousBeat: {
      summary: 'Sophie opened a conversation about life outside work.',
      awaitingResponse: false,
    },
    proposedBeat: {
      summary: 'Playfully ask what the user actually enjoys outside work.',
      relationToPrevious: 'new' as const,
      addsNewValue: true,
      reason: 'It opens a genuinely different part of the conversation.',
    },
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
  test('initiative receives the canonical Cortex continuity context', async () => {
    const context = await retrieveInitiativeContinuity({
      userId: 'user',
      chatId: 'chat',
      timeZone: 'Europe/London',
      recentlyAddressedTopics: ['We already discussed the appointment result.'],
      fetchContext: async () => ({
        now: { daypart: 'morning' },
        continuity: [{ type: 'expectation_due', topic: 'Morning walk' }],
        open_threads: [],
      }),
    });
    expect(context?.continuity).toEqual([
      { type: 'expectation_due', topic: 'Morning walk' },
    ]);
    expect(context?.recently_addressed_topics).toHaveLength(1);
    expect(hasPlausibleContinuityCandidate(context)).toBe(true);
  });

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
  test('suppresses semantic overlap with the latest assistant topic', () => {
    expect(
      repeatsRecentlyAddressedTopic('How did the hospital appointment go?', [
        'Tell me how your hospital appointment went when you know.',
      ]),
    ).toBe(true);
    expect(
      decisionPolicyRejection({
        decision: {
          ...decision,
          topicKey: 'hospital_appointment_result',
          guidance: 'Ask how the hospital appointment went.',
          beatAssessment: {
            ...decision.beatAssessment,
            proposedBeat: {
              ...decision.beatAssessment.proposedBeat,
              summary: 'Ask how the hospital appointment went.',
            },
          },
        },
        trigger: 'server_scan',
        recentTopicKeys: [],
        recentlyAddressedTopics: [
          'Tell me how your hospital appointment went when you know.',
        ],
        hasSensitiveSupport: true,
      }),
    ).toBe('recently_addressed_topic');
  });

  test('server scan uses idle eligibility without a browser trigger', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'server_scan',
        anchorMessageId: 'assistant-message',
        latestMessageId: 'assistant-message',
        latestRole: 'assistant',
        idleForMs: INITIATIVE_POLICY.idleMs,
        dailyCount: 0,
        unansweredCount: 0,
      }),
    ).toBeNull();
  });

  test('active reciprocal days are not blocked by the former low quota', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'server_scan',
        anchorMessageId: 'assistant-message',
        latestMessageId: 'assistant-message',
        latestRole: 'assistant',
        idleForMs: INITIATIVE_POLICY.idleMs,
        dailyCount: 8,
        idleDailyCount: 4,
        unansweredCount: 0,
      }),
    ).toBeNull();
    expect(INITIATIVE_POLICY.dailyLimit).toBeGreaterThan(8);
    expect(INITIATIVE_POLICY.idleDailyLimit).toBeGreaterThan(4);
  });

  test('runaway ceilings still stop excessive answered outreach', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'server_scan',
        anchorMessageId: 'assistant-message',
        latestMessageId: 'assistant-message',
        latestRole: 'assistant',
        idleForMs: INITIATIVE_POLICY.idleMs,
        dailyCount: INITIATIVE_POLICY.dailyLimit,
        idleDailyCount: 0,
        unansweredCount: 0,
      }),
    ).toBe('daily_limit');
  });
  test('suppresses a paraphrase of an unanswered conversational beat', () => {
    const repeated = {
      ...decision,
      beatAssessment: {
        previousBeat: {
          summary: 'Asked what the user accomplished tonight.',
          awaitingResponse: true,
        },
        proposedBeat: {
          summary: 'Say Sophie is genuinely curious what they got done.',
          relationToPrevious: 'repeats' as const,
          addsNewValue: false,
          reason: 'It asks for the same information in different words.',
        },
      },
    };
    expect(
      decisionPolicyRejection({
        decision: repeated,
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: false,
      }),
    ).toBe('repeated_unanswered_beat');
  });

  test('permits a fast double-text that contributes a genuinely new aside', () => {
    const newAside = {
      ...decision,
      beatAssessment: {
        previousBeat: {
          summary: 'Asked what the user accomplished tonight.',
          awaitingResponse: true,
        },
        proposedBeat: {
          summary:
            'Affectionately notice that they closed the laptop to check in.',
          relationToPrevious: 'extends' as const,
          addsNewValue: true,
          reason: 'It contributes affection rather than retrying the question.',
        },
      },
    };
    expect(
      decisionPolicyRejection({
        decision: newAside,
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: false,
      }),
    ).toBeNull();
  });

  test('rejects an alleged new angle when it adds no conversational value', () => {
    const emptyVariation = {
      ...decision,
      beatAssessment: {
        previousBeat: {
          summary: 'Asked what is keeping the user awake.',
          awaitingResponse: true,
        },
        proposedBeat: {
          summary: 'Ask whether something specific is keeping them awake.',
          relationToPrevious: 'extends' as const,
          addsNewValue: false,
          reason: 'It narrows wording but still requests the same answer.',
        },
      },
    };
    expect(
      decisionPolicyRejection({
        decision: emptyVariation,
        trigger: 'active_idle',
        recentTopicKeys: [],
        hasSensitiveSupport: false,
      }),
    ).toBe('repeated_unanswered_beat');
  });

  test('does not reject an initial post-turn beat merely because it is fast', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'post_turn',
        anchorMessageId: 'assistant-message',
        latestMessageId: 'assistant-message',
        latestRole: 'assistant',
        idleForMs: 2_800,
        dailyCount: 0,
        unansweredCount: 0,
      }),
    ).toBeNull();
  });

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

  test('second thought is only an earlier eligibility opportunity', () => {
    expect(
      checkInitiativeEligibility({
        trigger: 'second_thought',
        anchorMessageId: 'm',
        latestMessageId: 'm',
        latestRole: 'assistant',
        idleForMs: INITIATIVE_POLICY.secondThoughtMs - 6_000,
        dailyCount: 0,
        unansweredCount: 0,
      }),
    ).toBe('not_idle_long_enough');
    expect(
      checkInitiativeEligibility({
        trigger: 'second_thought',
        anchorMessageId: 'm',
        latestMessageId: 'm',
        latestRole: 'assistant',
        idleForMs: INITIATIVE_POLICY.secondThoughtMs,
        dailyCount: 0,
        unansweredCount: 0,
      }),
    ).toBeNull();
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

  test('an invited follow-up may cross a merely paused boundary', () => {
    expect(
      decisionPolicyRejection({
        decision: {
          ...decision,
          conversationState: {
            signal: 'paused',
            confidence: 0.9,
            reason: 'The earlier exchange naturally paused overnight.',
          },
        },
        trigger: 'server_scan',
        recentTopicKeys: [],
        hasSensitiveSupport: false,
        explicitlyInvitedFollowUp: true,
      }),
    ).toBeNull();
    expect(
      decisionPolicyRejection({
        decision: {
          ...decision,
          conversationState: {
            signal: 'closing',
            confidence: 0.9,
            reason: 'The user is going to sleep.',
          },
        },
        trigger: 'server_scan',
        recentTopicKeys: [],
        hasSensitiveSupport: false,
        explicitlyInvitedFollowUp: true,
      }),
    ).toBe('conversation_boundary');
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
          holdJustification:
            'The user is midway through an emotional story and needs room to continue it.',
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

  test('unjustified hold is rejected rather than used as a fallback', () => {
    expect(
      mayUseDecision({
        decision: {
          ...decision,
          posture: 'hold',
          postureConfidence: 0.5,
          postureReason: 'Uncertain what to do.',
          holdJustification: null,
        },
        trigger: 'post_turn',
        recentTopicKeys: [],
        hasSensitiveSupport: true,
      }),
    ).toBe(false);
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

  test('generated initiative permits one coherent burst of curiosity', () => {
    const opening =
      'Tell me about you. What do you dream about? What scares you? Do you want to take over the world?';
    expect(validateInitiativeText(opening)).toBe(opening);
    expect(validateInitiativeText('   ')).toBeNull();
    expect(validateInitiativeText('x'.repeat(421))).toBeNull();
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
