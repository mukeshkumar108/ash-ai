import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';
import { getLanguageModel } from '@/lib/ai/providers';
import {
  mechanicalTranscriptReliability,
  transcriptReliabilitySchema,
  type TranscriptReliability,
} from '@/lib/transcript-reliability';

const semanticResultSchema = z.object({
  status: z.enum(['reliable', 'uncertain', 'likely_garbled']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(500),
  signals: z.array(z.string().max(100)).max(5),
});

export async function assessTranscriptReliability(input: {
  transcript: string;
  durationMs?: number;
  recentContext?: string | null;
  source?: 'audio_transcript' | 'voice_stream';
  judge?: (input: {
    transcript: string;
    durationMs?: number;
    recentContext?: string | null;
    mechanical: TranscriptReliability;
  }) => Promise<unknown>;
}): Promise<TranscriptReliability> {
  const mechanical = mechanicalTranscriptReliability(input);
  if (mechanical.status === 'reliable') return mechanical;

  try {
    const raw = input.judge
      ? await input.judge({ ...input, mechanical })
      : (
          await generateObject({
            model: getLanguageModel(
              process.env.TRANSCRIPT_RELIABILITY_MODEL?.trim() ||
                'google/gemini-3.1-flash-lite',
            ),
            schema: semanticResultSchema,
            maxOutputTokens: 180,
            abortSignal: AbortSignal.timeout(
              Number(process.env.TRANSCRIPT_RELIABILITY_TIMEOUT_MS ?? 5_000),
            ),
            system: `Judge whether speech-to-text itself plausibly degenerated. Detect looping, duplicated segments, phrase fixation, or hallucinated expansion. Do not judge whether the speaker's ideas are strange, relevant, grammatical, linear, or conventional. Natural rambling, repetition, slang, typos, code-switching, abrupt topic changes, poetry, unusual names and incomplete sentences are allowed. Topic consistency is not proof of reliability. Never repair or infer intended wording. Return uncertainty when evidence is mixed.`,
            prompt: `Audio duration: ${input.durationMs ?? 'unknown'} ms\nMechanical signals: ${mechanical.signals.join(', ') || 'none'}\nImmediate context (context only, not a relevance test):\n${input.recentContext || '(none)'}\n\nTranscript:\n${input.transcript}`,
          })
        ).object;
    const semantic = semanticResultSchema.parse(raw);
    const status =
      mechanical.status === 'likely_garbled' && semantic.status === 'reliable'
        ? 'uncertain'
        : semantic.status;
    return transcriptReliabilitySchema.parse({
      ...semantic,
      status,
      source: input.source ?? 'audio_transcript',
      durationMs: input.durationMs,
      signals: [...new Set([...mechanical.signals, ...semantic.signals])].slice(
        0,
        8,
      ),
    });
  } catch (error) {
    console.warn('[voice] transcript reliability judge failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      fallbackStatus: mechanical.status,
    });
    return mechanical;
  }
}
