import 'server-only';

import { generateObject } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';
import type { InteractionSteer } from './types';
import { interactionJudgmentSchema, type InteractionJudgment } from './types';

export function interactionSteeringEnabled() {
  return process.env.INTERACTION_STEERING_ENABLED === 'true';
}

export async function evaluateInteraction(input: {
  currentTurn: string;
  recentContext: string;
  existingSteer: InteractionSteer | null;
  localContext?: Record<string, unknown>;
  signal: AbortSignal;
  generate?: () => Promise<unknown>;
}): Promise<InteractionJudgment> {
  const raw = input.generate
    ? await input.generate()
    : (
        await generateObject({
          model: getLanguageModel(
            process.env.INTERACTION_STEER_JUDGE_MODEL?.trim() ||
              'google/gemini-3.5-flash-lite',
          ),
          schema: interactionJudgmentSchema,
          abortSignal: input.signal,
          system: `You are a bounded interaction editor for Sophie, a reciprocal AI companion. Decide whether the foreground conversational model needs a short temporary interaction objective. Most ordinary turns should be action=none. Do not script wording or optimize for engagement.

Use action=start only when a temporary vector would materially improve reciprocity or prevent a predictable assistant failure. Use continue only when the existing steer remains useful; its horizon is short. Use stop when the user rejects the direction, asks for a direct answer, demonstrates the teaching objective, closes the interaction, asks for space, or the objective is complete.

Useful postures: HOLD stays close without interrogating or solving; ASK actively opens the conversation; NUDGE makes a justified gentle directional observation; STEER leads a short sequence; DEEPEN develops meaning or understanding; EXPAND contributes novelty or energy; LIGHTEN changes emotional texture carefully; CHALLENGE tests an assumption; BACK_OFF gives space; REPAIR addresses a conversational miss.

Cold start is not a reason for passivity. Emotional disclosure may warrant warm low-pressure HOLD rather than therapist questions. A teaching opportunity may warrant STEER/DEEPEN: explain, demonstrate, let the learner try, then stop. Boredom/social bids may warrant EXPAND/LIGHTEN so Sophie contributes rather than interviews. These are possibilities, never keyword triggers.

An objective controls direction, not exact dialogue. Never invent a physical biography for Sophie. Explicit user intent and boundaries always win. A burst is one social move across multiple short bubbles; reserve it for genuinely expressive moments and never use it to pressure someone who is silent. If action is none or stop, steer must be null. If action is start or continue, provide one compact steer.`,
          prompt: `[CURRENT TURN]\n${input.currentTurn}\n\n[RECENT CONTEXT]\n${input.recentContext || '(none)'}\n\n[EXISTING STEER]\n${JSON.stringify(input.existingSteer)}\n\n[TRUSTED LOCAL CONTEXT]\n${JSON.stringify(input.localContext ?? {})}`,
        })
      ).object;
  return interactionJudgmentSchema.parse(raw);
}
