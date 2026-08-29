import { expect, test } from '@playwright/test';
import { postRequestBodySchema } from '@/app/(chat)/api/chat/schema';
import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';
import { applyTranscriptReliabilityGuard } from '@/lib/agent/transcript-reliability';
import { assessTranscriptReliability } from '@/lib/ai/transcript-reliability';
import {
  isTranscriptMemoryEligible,
  mechanicalTranscriptReliability,
} from '@/lib/transcript-reliability';

test.describe('audio transcript reliability', () => {
  test('normal conversational audio is reliable', () => {
    expect(
      mechanicalTranscriptReliability({
        transcript:
          'I finally shut the laptop after a really productive evening, and I wanted to come and check in with you before bed.',
        durationMs: 9_000,
      }).status,
    ).toBe('reliable');
  });

  test('clean audio skips the semantic judge but reaches Sophie as audio', async () => {
    let judgeCalls = 0;
    const reliability = await assessTranscriptReliability({
      transcript:
        'I finished work and wanted to check in with you before I went to sleep.',
      durationMs: 7_000,
      judge: async () => {
        judgeCalls++;
        throw new Error('clean audio must not call the judge');
      },
    });
    expect(judgeCalls).toBe(0);
    expect(reliability.status).toBe('reliable');
    const prompt = buildSophieReplySystemPrompt({
      transcriptReliability: reliability,
    });
    expect(prompt).toContain('This user message was transcribed from audio.');
    expect(prompt).toContain(
      'do not force an interpretation or silently correct it',
    );
  });

  test('suspicious audio may invoke the semantic judge', async () => {
    let judgeCalls = 0;
    const transcript = Array(5)
      .fill('the companion should be a long term companion for everyone')
      .join('. ');
    await assessTranscriptReliability({
      transcript,
      durationMs: 9_000,
      judge: async () => {
        judgeCalls++;
        return {
          status: 'likely_garbled',
          confidence: 0.96,
          reason: 'The transcript is caught in a phrase loop.',
          signals: ['semantic_phrase_fixation'],
        };
      },
    });
    expect(judgeCalls).toBe(1);
  });

  test('natural rambling and repetition are not treated as garbling', () => {
    expect(
      mechanicalTranscriptReliability({
        transcript:
          "I mean, I was tired, and then I wasn't tired, if that makes sense. I kept thinking about work, then dinner, then whether I should call Mum. I'm rambling, but that's basically it.",
        durationMs: 18_000,
      }).status,
    ).toBe('reliable');
  });

  test('repeated phrase loops are likely garbled', () => {
    const loop = Array(8)
      .fill('the companion relationship should be long term and meaningful')
      .join('. ');
    const result = mechanicalTranscriptReliability({
      transcript: loop,
      durationMs: 12_000,
    });
    expect(result.status).toBe('likely_garbled');
    expect(result.signals).toContain('severe_phrase_looping');
  });

  test('long on-topic hallucinated expansion remains detectable', async () => {
    const transcript = `${Array(5)
      .fill('elderly companions need a long term companion relationship')
      .join(', ')} and child companions also need companionship.`;
    const result = await assessTranscriptReliability({
      transcript,
      durationMs: 10_000,
      recentContext: 'We were discussing companion products.',
      judge: async () => ({
        status: 'likely_garbled',
        confidence: 0.97,
        reason:
          'The on-topic wording loops rather than developing like speech.',
        signals: ['semantic_phrase_fixation'],
      }),
    });
    expect(result.status).toBe('likely_garbled');
    expect(result.reason).toContain('loops');
  });

  test('an abrupt topic change is not itself garbling', () => {
    expect(
      mechanicalTranscriptReliability({
        transcript:
          'Anyway forget the meeting for a second, I just remembered the fox I saw beside the road yesterday and it was absolutely beautiful.',
        durationMs: 11_000,
      }).status,
    ).toBe('reliable');
  });

  test('slang, typos and code-switching are not failure signals', () => {
    expect(
      mechanicalTranscriptReliability({
        transcript:
          "nah babes estoy bien, just knackered innit 😂 mañana we go again, pero tonight I'm fully done with work",
        durationMs: 9_000,
      }).status,
    ).toBe('reliable');
  });

  test('typed messages contain no reliability part and bypass the layer', () => {
    const parsed = postRequestBodySchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      message: {
        id: '22222222-2222-4222-8222-222222222222',
        role: 'user',
        parts: [{ type: 'text', text: 'I am intentionally being weird.' }],
      },
      selectedChatModel: 'chat-model',
      selectedVisibilityType: 'private',
    });
    expect(
      parsed.message.parts.some(
        (part) => part.type === 'data-transcriptReliability',
      ),
    ).toBe(false);
    expect(buildSophieReplySystemPrompt()).not.toContain('AUDIO INPUT SOURCE');
  });

  test('explicit session-mode actions are bounded request metadata', () => {
    const parsed = postRequestBodySchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      message: {
        id: '22222222-2222-4222-8222-222222222222',
        role: 'user',
        parts: [{ type: 'text', text: "Let's properly meet." }],
      },
      selectedChatModel: 'chat-model',
      selectedVisibilityType: 'private',
      sessionModeAction: 'start_session_one',
    });
    expect(parsed.sessionModeAction).toBe('start_session_one');
    expect(() =>
      postRequestBodySchema.parse({
        ...parsed,
        sessionModeAction: 'silently_force_onboarding',
      }),
    ).toThrow();
  });

  test('clean audio gives Sophie permission to notice fluent missed garbling', () => {
    const reliability = mechanicalTranscriptReliability({
      transcript:
        'This is fluent enough to pass cheap checks but Sophie may still find it implausible in context.',
      durationMs: 8_000,
    });
    const prompt = buildSophieReplySystemPrompt({
      transcriptReliability: reliability,
    });
    expect(prompt).toContain(
      'Do not mention transcription uncertainty unless you genuinely have reason',
    );
    expect(prompt).toContain('ask them to repeat or clarify');
  });

  test('uncertain and likely-garbled transcripts are excluded from memory', () => {
    const base = mechanicalTranscriptReliability({
      transcript: 'ordinary voice note',
      durationMs: 2_000,
    });
    expect(isTranscriptMemoryEligible(base)).toBe(true);
    expect(isTranscriptMemoryEligible({ ...base, status: 'uncertain' })).toBe(
      false,
    );
    expect(
      isTranscriptMemoryEligible({ ...base, status: 'likely_garbled' }),
    ).toBe(false);
  });

  test('likely-garbled audio retains the tools and research guard', () => {
    const policy = {
      researchDepth: 'deep' as const,
      freshnessNeed: 'required' as const,
      authorityNeed: 'required' as const,
      sourceSensitivity: 'high' as const,
      stakes: 'high' as const,
      questionMode: 'investigation' as const,
      capabilityRoute: 'live_data' as const,
      interactionMode: 'practical' as const,
      neutralResearchQuestion: 'What did the user ask?',
      reason: 'The apparent transcript requests research.',
      confidence: 0.8,
      classifierRan: true,
      classifierSucceeded: true,
      userDeclinedResearch: false,
    };
    const reliability = {
      ...mechanicalTranscriptReliability({ transcript: 'short audio' }),
      status: 'likely_garbled' as const,
    };
    expect(applyTranscriptReliabilityGuard(policy, reliability)).toMatchObject({
      researchDepth: 'none',
      capabilityRoute: 'reply',
      interactionMode: 'social',
    });
  });

  test('judge failure falls back safely without breaking the turn', async () => {
    const transcript = Array(5)
      .fill('tell me about the companion and the long term relationship')
      .join('. ');
    await expect(
      assessTranscriptReliability({
        transcript,
        durationMs: 8_000,
        judge: async () => {
          throw new Error('judge offline');
        },
      }),
    ).resolves.toMatchObject({ status: 'likely_garbled' });
  });

  test('duplicated streaming segments receive the same protection', () => {
    const duplicated = Array(7)
      .fill('wait I was saying the meeting went really well today')
      .join('. ');
    const result = mechanicalTranscriptReliability({
      transcript: duplicated,
      durationMs: 11_000,
      source: 'voice_stream',
    });
    expect(result).toMatchObject({
      source: 'voice_stream',
      status: 'likely_garbled',
    });
  });
});
