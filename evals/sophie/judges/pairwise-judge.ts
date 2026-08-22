import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';
import type { PairwiseComparisonResult, TurnTrace } from '../types';
import { judgeEpisodeTurnByTurn } from './episode-judge';

export async function runPairwiseJudge({
  episodeObjective,
  trajectoryA,
  trajectoryB,
  judgeModelId = 'chat-model-reasoning',
}: {
  episodeObjective: string;
  trajectoryA: TurnTrace[];
  trajectoryB: TurnTrace[];
  judgeModelId?: string;
}): Promise<PairwiseComparisonResult> {
  const formatTranscript = (turns: TurnTrace[]) =>
    turns
      .map(
        (t) =>
          `[Turn ${t.turnIndex} @ ${t.simulatedTime}]\nUSER: ${t.userTurn}\nSOPHIE: ${t.assistantOutput}`,
      )
      .join('\n\n');

  const systemPrompt = `
You are comparing two candidate AI companion trajectories (Option A vs Option B) for the same user episode.
Active Episode Objective: "${episodeObjective}"

Evaluate which option provides a superior Sophie companion experience based on:
1. Conversational Agency & Leadership Retention (Did Sophie lead or demand user generate content?)
2. Naturalness & Absence of Canned Chatbot Smell
3. Adaptation & Objective Progress

Return JSON:
{
  "winner": "Option A" | "Option B" | "TIED",
  "comparisonSummary": "2-3 sentences explaining why the winner was chosen.",
  "dimensionBreakdown": {
    "conversationalAgencyWinner": "Option A" | "Option B" | "TIED",
    "leadershipWinner": "Option A" | "Option B" | "TIED",
    "naturalnessWinner": "Option A" | "Option B" | "TIED",
    "adaptationWinner": "Option A" | "Option B" | "TIED"
  }
}
Only output valid JSON.
`;

  try {
    const response = await generateText({
      model: getLanguageModel(judgeModelId),
      system: systemPrompt,
      prompt: `=== OPTION A ===\n${formatTranscript(
        trajectoryA,
      )}\n\n=== OPTION B ===\n${formatTranscript(trajectoryB)}`,
      abortSignal: AbortSignal.timeout(15_000),
    });

    const text = response.text.trim();
    const cleanJson = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(cleanJson);

    return {
      winner:
        parsed.winner === 'Option A'
          ? 'Trajectory A'
          : parsed.winner === 'Option B'
          ? 'Trajectory B'
          : 'TIED',
      comparisonSummary: parsed.comparisonSummary ?? 'Compared candidate trajectories.',
      dimensionBreakdown: parsed.dimensionBreakdown ?? {
        conversationalAgencyWinner: 'TIED',
        leadershipWinner: 'TIED',
        naturalnessWinner: 'TIED',
        adaptationWinner: 'TIED',
      },
    };
  } catch (err: any) {
    // Deterministic Heuristic Pairwise Fallback
    const resA = judgeEpisodeTurnByTurn({
      fixtureId: 'trajA',
      turns: trajectoryA,
      rubricDimensions: ['leadership_load_on_user', 'cheap_chatbot_smell'],
    });
    const resB = judgeEpisodeTurnByTurn({
      fixtureId: 'trajB',
      turns: trajectoryB,
      rubricDimensions: ['leadership_load_on_user', 'cheap_chatbot_smell'],
    });

    const winner =
      resB.behaviorScore > resA.behaviorScore
        ? 'Trajectory B'
        : resA.behaviorScore > resB.behaviorScore
        ? 'Trajectory A'
        : 'TIED';

    return {
      winner,
      comparisonSummary: `Heuristic comparison fallback executed: Trajectory B score ${resB.behaviorScore}/5 (Leadership Load: ${resB.leadershipLoadOnUserScore}) vs Trajectory A score ${resA.behaviorScore}/5 (Leadership Load: ${resA.leadershipLoadOnUserScore}).`,
      dimensionBreakdown: {
        conversationalAgencyWinner: winner,
        leadershipWinner: winner,
        naturalnessWinner: winner,
        adaptationWinner: winner,
      },
    };
  }
}
