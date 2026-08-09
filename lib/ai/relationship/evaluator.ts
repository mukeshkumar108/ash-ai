import 'server-only';

import { generateObject } from 'ai';

import { getLanguageModel } from '@/lib/ai/providers';
import {
  initiativeDecisionSchema,
  type InitiativeDecision,
  type InitiativeTrigger,
} from './types';

export async function evaluateInitiative(input: {
  trigger: InitiativeTrigger;
  recentConversation: string;
  memoryEvidence: string | null;
  recentTopicKeys: string[];
  signal: AbortSignal;
  generate?: () => Promise<unknown>;
}): Promise<InitiativeDecision> {
  const raw = input.generate
    ? await input.generate()
    : (
        await generateObject({
          model: getLanguageModel(
            process.env.RELATIONSHIP_EVALUATOR_MODEL?.trim() ||
              'deepseek/deepseek-v4-flash',
          ),
          schema: initiativeDecisionSchema,
          abortSignal: input.signal,
          system: `You decide whether Sophie, a warm opinionated companion, has a genuine relational reason to send a separate short message without being asked.
No action is normal. Do not act merely to increase engagement or fill a profile field. Curiosity, playfulness, wanting to know the person, or naturally continuing something alive are valid reasons.
For post_turn, act only when a separate afterthought would feel notably better than leaving the completed answer alone. For active_idle, act only when there is something worth saying after silence.
Avoid therapy language, interviews, productivity nagging, repetitive check-ins, and generic "how are you" filler. Select one conversational entry point. Sensitive grief, trauma, sex, health, or relationship conflict requires explicit, meaningful supporting evidence and should set sensitive=true. Never invent memory.
Return act=false if evidence is insufficient or the moment should breathe. topicKey must be a short reusable snake_case dedupe key. guidance is an intention, never a demanded outcome.`,
          prompt: `[TRIGGER]\n${input.trigger}\n\n[RECENT CONVERSATION]\n${input.recentConversation || '(none)'}\n\n[MEMORY EVIDENCE]\n${input.memoryEvidence || '(unavailable — do not pretend to remember anything)'}\n\n[RECENT TOPICS TO AVOID]\n${input.recentTopicKeys.join(', ') || '(none)'}`,
        })
      ).object;
  return initiativeDecisionSchema.parse(raw);
}
