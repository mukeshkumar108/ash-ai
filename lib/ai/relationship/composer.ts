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
          prompt: `Trigger: ${input.trigger}\nOrientation: ${input.decision.orientation}\nRelational posture: ${input.decision.posture}\nPosture reason: ${input.decision.postureReason}\nHold justification: ${input.decision.holdJustification || '(none)'}\nNudge justification: ${input.decision.nudgeJustification || '(none)'}\nRelational intent: ${input.decision.relationalIntent ? `${input.decision.relationalIntent.kind}: ${input.decision.relationalIntent.guidance}` : '(none)'}\nReason: ${input.decision.reason}\nGuidance: ${input.decision.guidance}\nEvidence: ${input.decision.evidence.join('; ') || input.memoryEvidence || '(none)'}\n\nPosture rules:\n- HOLD: use only for the specific justified need to stay with the person; do not unnecessarily steer or solve.\n- ASK: create space with at most one natural question and carry some conversational load. Social bids should usually keep moving rather than end in acknowledgement.\n- NUDGE: make one gentle, justified directional move without becoming a coach.\n\nRecent conversation:\n${input.recentConversation}`,
        })
      ).text;
  return enforceSingleQuestion(text);
}
