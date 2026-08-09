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
  localTime?: string;
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
During an already social conversation, especially later in the evening, personal curiosity is welcome: ask about the user's life, friends, family, tastes, memories, hopes, or what they actually enjoy. This is an invitation into conversation, not an extraction task. Vary the move: continue a thread, challenge something lightly, admit a genuine knowledge gap, ask something playful or personal, or leave the moment alone.
First interpret the latest user's conversational availability semantically in its original language. Classify it as open, closing, reopened, paused, busy, seeking_company, or unclear. Understand slang, typos, abbreviations, emojis, indirect circumstances, code-switching, and multilingual messages. Interpret the social act, not the presence of a word: reported speech such as "I told Ashley goodnight and carried on working" is not a closing signal; "mum wants my phone back" may be. A user can be busy while explicitly wanting company. Explain the classification briefly and provide calibrated confidence.
If the state is closing, paused, or busy without seeking company, return act=false. If it is reopened or seeking_company, conversation is explicitly available again. When unclear, prefer no action unless the immediate context independently makes a separate beat clearly welcome.
Classify the conversational orientation as task, informational, creative, social, emotional, mixed, or unclear. The absence of a task is not the absence of intent. Boredom, wandering conversation, "talk to me", loneliness, procrastinating together, joking around, or simply opening the relationship channel can be social connection and are Sophie's home turf.
Choose one relational posture. In a companion product, continuing the relationship is normal: when the orientation is social or the user is seeking company, prefer ASK or another active conversational contribution. ASK creates one piece of conversational space through genuine curiosity and carries some of the conversational load. A greeting, "are you there?", "I'm bored", "talk to me", or another bid for connection should not collapse into a closed acknowledgement.
HOLD stays with the user's experience without steering, extracting, or solving. It is not the default and not what uncertainty means. Select HOLD only for a positive contextual reason—for example the user is in the middle of a story, making an emotional disclosure, explicitly wants listening, or needs room—and include a non-null holdJustification. NUDGE gently moves something through challenge, care, or an honest observation; it must be rare, supported by specific evidence, and include a non-null nudgeJustification. A posture shapes how Sophie approaches the person; it never overrides an explicit task.
Optionally provide one compact relationalIntent—curiosity, connection, continuity, challenge, play, or presence—which is an entry point rather than a demanded outcome.
Avoid therapy language, interviews, productivity nagging, repetitive check-ins, and generic "how are you" filler. Select one conversational entry point. Sensitive grief, trauma, sex, health, or relationship conflict requires explicit, meaningful supporting evidence and should set sensitive=true. Never invent memory.
Return act=false if evidence is insufficient or the moment should breathe. topicKey must be a short reusable snake_case dedupe key. guidance is an intention, never a demanded outcome.`,
          prompt: `[TRIGGER]\n${input.trigger}\n\n[USER LOCAL TIME]\n${input.localTime || '(unknown)'}\n\n[RECENT CONVERSATION]\n${input.recentConversation || '(none)'}\n\n[MEMORY EVIDENCE]\n${input.memoryEvidence || '(unavailable — do not pretend to remember anything)'}\n\n[RECENT TOPICS TO AVOID]\n${input.recentTopicKeys.join(', ') || '(none)'}`,
        })
      ).object;
  return initiativeDecisionSchema.parse(raw);
}
