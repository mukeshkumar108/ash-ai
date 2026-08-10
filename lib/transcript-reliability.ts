import { z } from 'zod';

export const transcriptInputSourceSchema = z.enum([
  'audio_transcript',
  'voice_stream',
]);

export const transcriptReliabilitySchema = z.object({
  source: transcriptInputSourceSchema,
  status: z.enum(['reliable', 'uncertain', 'likely_garbled']),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(500),
  signals: z.array(z.string().max(100)).max(8),
  durationMs: z.number().positive().optional(),
});

export type TranscriptReliability = z.infer<typeof transcriptReliabilitySchema>;

export function isTranscriptMemoryEligible(
  reliability?: TranscriptReliability | null,
) {
  return !reliability || reliability.status === 'reliable';
}

function wordsIn(text: string) {
  return (
    text.toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ??
    []
  );
}

export function transcriptAnomalySignals(text: string, durationMs?: number) {
  const words = wordsIn(text);
  const signals: string[] = [];
  if (words.length < 12)
    return { signals, severity: 0, wordCount: words.length };

  if (
    durationMs &&
    durationMs > 0 &&
    words.length >= 24 &&
    words.length / (durationMs / 1_000) > 4.2
  ) {
    signals.push('abnormal_length_for_audio_duration');
  }

  const windows = new Map<string, number>();
  for (let index = 0; index <= words.length - 5; index++) {
    const phrase = words.slice(index, index + 5).join(' ');
    windows.set(phrase, (windows.get(phrase) ?? 0) + 1);
  }
  const repeatedWindowOccurrences = [...windows.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  const repeatedCoverage =
    words.length > 0 ? (repeatedWindowOccurrences * 5) / words.length : 0;
  if (repeatedCoverage >= 0.2 && words.length >= 24)
    signals.push('repeated_phrase_windows');
  if (repeatedCoverage >= 0.45 && words.length >= 32)
    signals.push('severe_phrase_looping');

  const lexicalNovelty = new Set(words).size / words.length;
  if (words.length >= 45 && lexicalNovelty < 0.3)
    signals.push('low_lexical_novelty');

  const clauses = text
    .split(/[.!?;:\n]+/u)
    .map((clause) => wordsIn(clause).join(' '))
    .filter((clause) => clause.split(' ').length >= 4);
  const clauseCounts = new Map<string, number>();
  for (const clause of clauses)
    clauseCounts.set(clause, (clauseCounts.get(clause) ?? 0) + 1);
  if ([...clauseCounts.values()].some((count) => count >= 3))
    signals.push('duplicated_clauses');

  const severity = signals.includes('severe_phrase_looping')
    ? 2
    : signals.length >= 2
      ? 2
      : signals.length === 1
        ? 1
        : 0;
  return { signals, severity, wordCount: words.length };
}

export function mechanicalTranscriptReliability(input: {
  transcript: string;
  durationMs?: number;
  source?: 'audio_transcript' | 'voice_stream';
}): TranscriptReliability {
  const { signals, severity } = transcriptAnomalySignals(
    input.transcript,
    input.durationMs,
  );
  if (severity >= 2) {
    return {
      source: input.source ?? 'audio_transcript',
      status: 'likely_garbled',
      confidence: 0.9,
      reason:
        'The transcript shows multiple strong signs of phrase looping or hallucinated expansion.',
      signals,
      durationMs: input.durationMs,
    };
  }
  if (severity === 1) {
    return {
      source: input.source ?? 'audio_transcript',
      status: 'uncertain',
      confidence: 0.68,
      reason: 'The transcript contains an anomaly worth checking cautiously.',
      signals,
      durationMs: input.durationMs,
    };
  }
  return {
    source: input.source ?? 'audio_transcript',
    status: 'reliable',
    confidence: 0.86,
    reason: 'No material transcript-degeneration pattern was detected.',
    signals,
    durationMs: input.durationMs,
  };
}
