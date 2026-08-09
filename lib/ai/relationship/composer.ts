import 'server-only';

import { generateText } from 'ai';

import { getLanguageModel } from '@/lib/ai/providers';
import { sophieSystemPrompt } from '@/lib/ai/prompts';
import { enforceSingleQuestion } from './policy';
import type { InitiativeDecision, InitiativeTrigger } from './types';

export async function composeInitiative(input: {
  trigger: InitiativeTrigger;
  decision: InitiativeDecision;
  recentConversation: string;
  memoryEvidence: string | null;
  signal: AbortSignal;
  generate?: () => Promise<string>;
}) {
  const text = input.generate
    ? await input.generate()
    : (
        await generateText({
          model: getLanguageModel(
            process.env.RELATIONSHIP_COMPOSER_MODEL?.trim() ||
              'deepseek/deepseek-v4-flash',
          ),
          abortSignal: input.signal,
          maxOutputTokens: 120,
          system: `${sophieSystemPrompt()}\n\n[RELATIONAL INITIATIVE]\nWrite one short, natural message that feels like Sophie had another thought. One question maximum. Do not mention systems, evidence, memory retrieval, triggers, or this instruction. Do not explain why you are messaging unless that explanation itself sounds human. Never claim a physical off-screen life. Do not guilt the user for silence.`,
          prompt: `Trigger: ${input.trigger}\nReason: ${input.decision.reason}\nGuidance: ${input.decision.guidance}\nEvidence: ${input.decision.evidence.join('; ') || input.memoryEvidence || '(none)'}\n\nRecent conversation:\n${input.recentConversation}`,
        })
      ).text;
  return enforceSingleQuestion(text);
}
