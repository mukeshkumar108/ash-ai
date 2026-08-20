import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';

import { getLanguageModel } from '@/lib/ai/providers';

const attentionCandidateSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(160),
  kind: z.enum([
    'pending_question',
    'unfinished_thought',
    'callback',
    'promise',
    'reentry',
  ]),
  content: z.string().trim().min(1).max(500),
  salience: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  notBeforeMinutes: z.number().int().min(0).max(10_080).nullable(),
  expiresAfterHours: z.number().int().min(1).max(720),
});

const attentionExtractionSchema = z.object({
  candidates: z.array(attentionCandidateSchema).max(3),
});

export type SophieAttentionCandidate = z.infer<
  typeof attentionCandidateSchema
>;

export async function extractSophieAttentionCandidates(input: {
  recentContext: string;
  userText: string;
  assistantText: string;
  signal?: AbortSignal;
  generate?: () => Promise<unknown>;
}) {
  const raw = input.generate
    ? await input.generate()
    : (
        await generateObject({
          model: getLanguageModel(
            process.env.SOPHIE_ATTENTION_MODEL?.trim() ||
              'google/gemini-3.5-flash-lite',
          ),
          schema: attentionExtractionSchema,
          abortSignal:
            input.signal ??
            AbortSignal.timeout(
              Number(process.env.SOPHIE_ATTENTION_TIMEOUT_MS ?? 10_000),
            ),
          system: `You identify at most three grounded things Sophie may still carry after a completed conversational turn. This is quiet post-turn attention, not another reply and not an engagement optimizer.

Allowed kinds:
- pending_question: one specific thing Sophie genuinely still wants to understand but did not already ask.
- unfinished_thought: a tentative observation, tension, or interpretation worth reconsidering; phrase uncertainty as uncertainty.
- callback: a relationship-specific detail, joke, phrase, or connection that may naturally recur.
- promise: something Sophie explicitly said she would do or return to.
- reentry: an important thread the conversation left unfinished and may be worth bringing back.

Candidate content is semantic intent, never polished dialogue. Every candidate must be directly supported by the supplied conversation. Do not invent hidden motives, facts, memories, physical activity, or offscreen research. Do not store generic engagement questions, topics that were already completed, or every minor detail. A candidate is permission to remember something, not an obligation to surface it. Return an empty list when nothing remains genuinely alive. Use stable snake_case keys.`,
          prompt: `[RECENT CONTEXT]\n${input.recentContext.slice(-5_000)}\n\n[COMPLETED TURN]\nUser: ${input.userText}\nSophie: ${input.assistantText}`,
        })
      ).object;
  return attentionExtractionSchema.parse(raw).candidates;
}
