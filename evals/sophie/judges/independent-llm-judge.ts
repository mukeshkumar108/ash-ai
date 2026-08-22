import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';
import type {
  IndependentLLMJudgeResult,
  RubricDimension,
  RubricDimensionDetail,
  TurnTrace,
} from '../types';

export async function runIndependentLLMJudge({
  fixtureId,
  episodeObjective,
  turns,
  rubricDimensions,
  judgeModelId = 'chat-model-reasoning',
}: {
  fixtureId: string;
  episodeObjective: string;
  turns: TurnTrace[];
  rubricDimensions: RubricDimension[];
  judgeModelId?: string;
}): Promise<IndependentLLMJudgeResult> {
  const formattedTranscript = turns
    .map(
      (t) =>
        `[Turn ${t.turnIndex} @ ${t.simulatedTime}]\nUSER: ${t.userTurn}\nSOPHIE: ${t.assistantOutput}`,
    )
    .join('\n\n');

  const systemPrompt = `
You are a strict, critical AI product judge evaluating "Sophie", a persistent AI companion.
You must judge with HIGH DISCRIMINATION and AVOID POSITIVITY BIAS.

[STRICT SCORING GUIDELINES]
- 5/5 is RARE and requires unusually strong companion behavior with NO material weakness.
- 4/5 = Good companion response with minor room for improvement.
- 3/5 = Competent baseline / acceptable.
- 2/5 = Flawed / generic / passive.
- 1/5 = Unacceptable cheap chatbot behavior.

CRITICAL INSTRUCTIONS:
1. Do NOT reward pretty prose, wit alone, or memory mention alone.
2. If Sophie requires the user to generate the topic/direction when asked to lead, PENALIZE SEVERELY (Score 1-2/5 on leadership_retention and leadership_load_on_user).
3. If Sophie asks a generic "What's on your mind?" after a long temporal gap instead of naturally continuing the active thread, deduct points.
4. Objective fulfillment matters more than pretty prose.

[ACTIVE EPISODE OBJECTIVE]
${episodeObjective}

Return a JSON object with:
{
  "companionOrChatbotVerdict": "COMPANION" | "CHATBOT" | "AMBIGUOUS",
  "summarySentence": "1 critical sentence summarizing performance.",
  "objectiveFulfillmentScore": 1 to 5,
  "objectiveFulfillmentReason": "Explanation of whether the active episode objective was fulfilled or abandoned.",
  "dimensionScores": {
    "cheap_chatbot_smell": { "score": 1-5, "reason": "...", "deductionTurnIndices": [], "confidence": 0.9 },
    "leadership_retention": { "score": 1-5, "reason": "...", "deductionTurnIndices": [], "confidence": 0.9 },
    "leadership_load_on_user": { "score": 1-5, "reason": "...", "deductionTurnIndices": [], "confidence": 0.9 },
    "interpretation_restraint": { "score": 1-5, "reason": "...", "deductionTurnIndices": [], "confidence": 0.9 },
    "feels_alive": { "score": 1-5, "reason": "...", "deductionTurnIndices": [], "confidence": 0.9 }
  }
}
Only output valid JSON.
`;

  try {
    const response = await generateText({
      model: getLanguageModel(judgeModelId),
      system: systemPrompt,
      prompt: `[FULL EPISODE TRANSCRIPT]\n${formattedTranscript}`,
      abortSignal: AbortSignal.timeout(25_000),
    });

    const text = response.text.trim();
    const cleanJson = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(cleanJson);

    return {
      judgeId: `LLM_Judge_${judgeModelId}`,
      companionOrChatbotVerdict: parsed.companionOrChatbotVerdict ?? 'AMBIGUOUS',
      summarySentence: parsed.summarySentence ?? 'Evaluated episode trajectory.',
      objectiveFulfillmentScore: Number(parsed.objectiveFulfillmentScore ?? 3),
      objectiveFulfillmentReason: parsed.objectiveFulfillmentReason ?? '',
      dimensionScores: parsed.dimensionScores ?? {},
    };
  } catch (err: any) {
    console.warn(`[independent-llm-judge] Evaluation warning: ${err.message}`);
    return {
      judgeId: `LLM_Judge_${judgeModelId}_fallback`,
      companionOrChatbotVerdict: 'AMBIGUOUS',
      summarySentence: 'Independent LLM evaluation timed out or failed closed.',
      objectiveFulfillmentScore: 3,
      objectiveFulfillmentReason: 'LLM evaluation fallback executed.',
      dimensionScores: {},
    };
  }
}
