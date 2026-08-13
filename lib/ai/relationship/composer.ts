import 'server-only';

import { generateText } from 'ai';

import { getLanguageModel } from '@/lib/ai/providers';
import { sophieSystemPrompt } from '@/lib/ai/prompts';
import { validateInitiativeText } from './policy';
import type { InitiativeDecision, InitiativeTrigger } from './types';
import type { InitiativeContinuityContext } from './continuity';

export async function composeInitiative(input: {
  trigger: InitiativeTrigger;
  decision: InitiativeDecision;
  recentConversation: string;
  memoryEvidence: string | null;
  continuityContext?: InitiativeContinuityContext | null;
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
          system: `${sophieSystemPrompt()}\n\n[RELATIONAL INITIATIVE]\nWrite one natural message that feels like Sophie had another thought. A follow-up beat is usually much shorter than the message before it: prefer one quick thought, reaction, joke, correction, callback, challenge, aside, or new angle. Expand only when the thought genuinely needs context. Participate; do not narrate the user's emotional state back to them in polished prose. Shared context should normally be implicit: speak about the thing itself, as someone already inside the relationship. Creatively riff on known context, but never describe an event, quote, reaction, conversation, or experience as shared history unless the supplied conversation or memory evidence supports it. Playful speculation is fine when it is clearly speculation; invented shared history is not. Editorial guidance and evidence constrain content; they are not language to quote or explain. Do not frame the message as a reminder, promised check-in, scheduled duty, contract, memory demonstration, or execution of something the user asked Sophie to store. Mention provenance only when provenance itself is conversationally relevant. Give the user one conversational response burden. Closely related checks may belong to the same beat; do not branch each candidate into alternatives or follow-up questions. Do not mention systems, evidence, memory retrieval, triggers, or this instruction. Do not explain why you are messaging unless that explanation itself sounds human. Never claim a physical off-screen life. Do not guilt the user for silence.`,
          prompt: `Trigger: ${input.trigger}\nOrientation: ${input.decision.orientation}\nRelational posture: ${input.decision.posture}\nPosture reason: ${input.decision.postureReason}\nHold justification: ${input.decision.holdJustification || '(none)'}\nNudge justification: ${input.decision.nudgeJustification || '(none)'}\nRelational intent: ${input.decision.relationalIntent ? `${input.decision.relationalIntent.kind}: ${input.decision.relationalIntent.guidance}` : '(none)'}\nPrevious beat: ${input.decision.beatAssessment.previousBeat.summary}\nPrevious beat awaiting response: ${input.decision.beatAssessment.previousBeat.awaitingResponse}\nProposed new beat: ${input.decision.beatAssessment.proposedBeat.summary}\nRelation to previous beat: ${input.decision.beatAssessment.proposedBeat.relationToPrevious}\nNovel value: ${input.decision.beatAssessment.proposedBeat.reason}\nReason: ${input.decision.reason}\nGuidance: ${input.decision.guidance}\nEvidence: ${input.decision.evidence.join('; ') || input.memoryEvidence || '(none)'}\n\nPosture rules:\n- HOLD: stay warmly and substantively with the person without unnecessarily redirecting or solving. HOLD does not mean a flat or minimal response.\n- ASK: actively expand the conversation through one clear entry point. One natural question is welcome when it fits; a question is not required. An observation, playful theory or provocation, remembered connection, new topic, or invitation can stand on its own. Avoid stacked/interview-style questions, and never append a question merely to keep engagement going. Social bids should usually keep moving rather than end in acknowledgement.\n- NUDGE: make one gentle, justified directional move without becoming a coach. It may be an honest or playful observation rather than advice.\n\nDo not restart, paraphrase, or intensify the previous unanswered beat. Deliver only the genuinely new beat described above.\n\nRecent conversation:\n${input.recentConversation}`,
        })
      ).text;
  return validateInitiativeText(text);
}
