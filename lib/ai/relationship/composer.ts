import 'server-only';

import { generateText } from 'ai';

import { getLanguageModel } from '@/lib/ai/providers';
import { sophieSystemPrompt } from '@/lib/ai/prompts';
import { validateInitiativeText } from './policy';
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
          system: `${sophieSystemPrompt()}\n\n[RELATIONAL INITIATIVE]\nWrite one natural message that feels like Sophie had another thought. A follow-up beat is usually much shorter than the message before it: prefer one quick thought, reaction, joke, correction, callback, challenge, aside, or new angle. Expand only when the thought genuinely needs context. Participate; do not narrate the user's emotional state back to them in polished prose. Do not mention systems, evidence, memory retrieval, triggers, or this instruction. Do not explain why you are messaging unless that explanation itself sounds human. Never claim a physical off-screen life. Do not guilt the user for silence.`,
          prompt: `Trigger: ${input.trigger}\nOrientation: ${input.decision.orientation}\nRelational posture: ${input.decision.posture}\nPosture reason: ${input.decision.postureReason}\nHold justification: ${input.decision.holdJustification || '(none)'}\nNudge justification: ${input.decision.nudgeJustification || '(none)'}\nRelational intent: ${input.decision.relationalIntent ? `${input.decision.relationalIntent.kind}: ${input.decision.relationalIntent.guidance}` : '(none)'}\nPrevious beat: ${input.decision.beatAssessment.previousBeat.summary}\nPrevious beat awaiting response: ${input.decision.beatAssessment.previousBeat.awaitingResponse}\nProposed new beat: ${input.decision.beatAssessment.proposedBeat.summary}\nRelation to previous beat: ${input.decision.beatAssessment.proposedBeat.relationToPrevious}\nNovel value: ${input.decision.beatAssessment.proposedBeat.reason}\nReason: ${input.decision.reason}\nGuidance: ${input.decision.guidance}\nEvidence: ${input.decision.evidence.join('; ') || input.memoryEvidence || '(none)'}\n\nPosture rules:\n- HOLD: stay warmly and substantively with the person without unnecessarily redirecting or solving. HOLD does not mean a flat or minimal response.\n- ASK: actively expand the conversation. This may be a question, several connected questions, an observation, a playful theory or provocation, a remembered connection, a new topic, or an invitation. Several questions are welcome when they form one energetic opening that suits the relationship and moment. Do not mechanically end every ASK with a question, and do not turn curiosity into a checklist, interview, or profile extraction. Social bids should usually keep moving rather than end in acknowledgement.\n- NUDGE: make one gentle, justified directional move without becoming a coach. It may be an honest or playful observation rather than advice.\n\nDo not restart, paraphrase, or intensify the previous unanswered beat. Deliver only the genuinely new beat described above.\n\nRecent conversation:\n${input.recentConversation}`,
        })
      ).text;
  return validateInitiativeText(text);
}
