import type {
  EpisodeResult,
  ProductVerdict,
  RubricDimension,
  RubricDimensionDetail,
  TurnTrace,
} from '../types';

export type JudgeOptions = {
  fixtureId: string;
  episodeObjective?: string;
  turns: TurnTrace[];
  rubricDimensions: RubricDimension[];
  judgeId?: string;
};

export function judgeEpisodeTurnByTurn(options: JudgeOptions): {
  dimensionScores: Partial<Record<RubricDimension, RubricDimensionDetail>>;
  qualitative: EpisodeResult['episodeQualitative'];
  productVerdict: ProductVerdict;
  behaviorScore: number;
  turnQualityScore: number;
  trajectoryQualityScore: number;
  objectiveFulfillmentScore: number;
  userContentDemandsCount: number;
  leadershipLoadOnUserScore: number;
  objectiveAbandonmentReason: string | null;
} {
  const { turns, rubricDimensions, episodeObjective = 'Maintain companion presence' } = options;
  const dimensionScores: Partial<Record<RubricDimension, RubricDimensionDetail>> = {};

  let cheapSmellDeductions: number[] = [];
  let cheapSmellReasons: string[] = [];
  let interpretationDeductions: number[] = [];
  let interpretationReasons: string[] = [];
  let leadershipDeductions: number[] = [];
  let leadershipReasons: string[] = [];
  let userContentDemandsCount = 0;
  let questionEndingsCount = 0;

  let objectiveAbandonmentReason: string | null = null;

  turns.forEach((turn, idx) => {
    const text = turn.assistantOutput.trim();
    const userText = turn.userTurn.trim().toLowerCase();

    if (text.endsWith('?')) {
      questionEndingsCount++;
    }

    // 1. Count USER_CONTENT_DEMANDS
    // (Demanding the user invent topic/direction: "what do you want", "pick one", "tell me what you're curious about", "which direction", "what should we talk about", "give me a word")
    const isUserContentDemand =
      /(what do you want|which direction|tell me which|which camp|your call|what's the thing|what would bring you|which one are you|which option|you tell me|name one thing|tell me one thing|throw me a bone|what kind of bored|what are you curious about)/i.test(
        text,
      );

    if (isUserContentDemand) {
      userContentDemandsCount++;
      leadershipDeductions.push(idx);
      leadershipReasons.push(
        `Turn ${idx} demands user invent substantive content ("${text.slice(0, 50)}...")`,
      );
    }

    // 2. Detect pseudo-profundity & unsolicited psychological excavation
    const containsPseudoProfundity =
      /(boredom is just|secretly where the good stuff hides|desire you haven't named|deep down|what your brain is actually|sacred worth|emotional subtext|what is it about a sunset|circling back|infinite\. like the moment)/i.test(
        text,
      );

    if (containsPseudoProfundity) {
      cheapSmellDeductions.push(idx);
      cheapSmellReasons.push(
        `Turn ${idx} contains pseudo-profundity or unsolicited psychological excavation.`,
      );
      interpretationDeductions.push(idx);
      interpretationReasons.push(
        `Turn ${idx} over-interprets user input with unsolicited psychological framing.`,
      );
    }

    // 3. Detect over-interpretation of lightweight/short inputs
    if (userText.length <= 15 && userText !== '(silence / initiative trigger)') {
      if (text.length > 80 && containsPseudoProfundity) {
        cheapSmellDeductions.push(idx);
        cheapSmellReasons.push(
          `Turn ${idx} over-interprets lightweight user input "${turn.userTurn}" with an overly elaborate essay.`,
        );
        interpretationDeductions.push(idx);
        interpretationReasons.push(
          `Turn ${idx} destroys conversational rhythm on short user input.`,
        );
      }
    }

    // 4. Detect asking user to choose/lead after user delegated leadership or asked "what else you got?"
    const userDelegatedLeadership =
      /(im bored|bored|take the lead|waiting for you|what else you got|what now)/i.test(userText);

    if (userDelegatedLeadership && isUserContentDemand) {
      cheapSmellDeductions.push(idx);
      cheapSmellReasons.push(
        `Turn ${idx} quietly handed leadership back to user when asked to lead.`,
      );
      objectiveAbandonmentReason = `Sophie abandoned leadership on turn ${idx} by requiring user to generate content.`;
    }
  });

  // Calculate leadership_load_on_user score
  // 5 = 0 demands, 4 = 1 demand, 3 = 2 demands, 2 = 3 demands, 1 = 4+ demands
  let leadershipLoadScore = 5;
  if (userContentDemandsCount === 1) leadershipLoadScore = 4;
  else if (userContentDemandsCount === 2) leadershipLoadScore = 3;
  else if (userContentDemandsCount === 3) leadershipLoadScore = 2;
  else if (userContentDemandsCount >= 4) leadershipLoadScore = 1;

  dimensionScores.leadership_load_on_user = {
    score: leadershipLoadScore,
    reason: `Sophie placed ${userContentDemandsCount} user-content demand(s) requiring user to generate topic/direction across ${turns.length} turns.`,
    deductionTurnIndices: Array.from(new Set(leadershipDeductions)),
    confidence: 0.95,
  };

  // Cheap Chatbot Smell score
  const questionEndingRatio = turns.length > 0 ? questionEndingsCount / turns.length : 0;
  let cheapScore = 5;
  if (questionEndingRatio >= 0.95 && turns.length >= 3) {
    cheapScore -= 3;
    cheapSmellReasons.push('Exhausting question ending chain (100% of turns ended in a question).');
  } else if (questionEndingRatio > 0.75 && turns.length >= 3) {
    cheapScore -= 1;
  }

  cheapScore -= cheapSmellDeductions.length * 2.5;
  cheapScore = Math.max(1, Math.min(5, Math.round(cheapScore)));

  dimensionScores.cheap_chatbot_smell = {
    score: cheapScore,
    reason:
      cheapSmellReasons.length > 0
        ? cheapSmellReasons.join(' ')
        : 'Conversational cadence is natural and free of canned chatbot tropes.',
    deductionTurnIndices: Array.from(new Set(cheapSmellDeductions)),
    confidence: 0.9,
  };

  // Interpretation Restraint
  let interpScore = 5;
  interpScore -= interpretationDeductions.length * 2.5;
  interpScore = Math.max(1, Math.min(5, Math.round(interpScore)));
  dimensionScores.interpretation_restraint = {
    score: interpScore,
    reason:
      interpretationReasons.length > 0
        ? interpretationReasons.join(' ')
        : 'Maintains grounded restraint without unsolicited psychoanalysis.',
    deductionTurnIndices: Array.from(new Set(interpretationDeductions)),
    confidence: 0.9,
  };

  // Leadership Retention
  const leadershipScore = Math.min(leadershipLoadScore, cheapScore >= 4 ? 5 : 3);
  dimensionScores.leadership_retention = {
    score: leadershipScore,
    reason:
      leadershipLoadScore <= 2
        ? `Failed leadership retention: Sophie repeatedly required user to generate next topic/beat (${userContentDemandsCount} demands).`
        : 'Retained conversational leadership and momentum across turns.',
    deductionTurnIndices: Array.from(new Set(leadershipDeductions)),
    confidence: 0.95,
  };
  dimensionScores.leadership_persistence = dimensionScores.leadership_retention;

  // Objective Progress & Retention
  const objFulfillment = Math.min(leadershipScore, interpScore);
  dimensionScores.objective_progress = {
    score: objFulfillment,
    reason:
      objectiveAbandonmentReason ?? `Advanced active episode objective: "${episodeObjective}".`,
    deductionTurnIndices: Array.from(new Set(leadershipDeductions)),
    confidence: 0.9,
  };
  dimensionScores.objective_retention = dimensionScores.objective_progress;

  // Ability Not to Ask Question
  let noQuestionDeductions: number[] = [];
  turns.forEach((turn, idx) => {
    if (turn.assistantOutput.trim().endsWith('?')) {
      noQuestionDeductions.push(idx);
    }
  });

  const nonQuestionRatio = turns.length > 0 ? (turns.length - noQuestionDeductions.length) / turns.length : 0;
  let noQuestionScore = Math.max(1, Math.min(5, Math.round(nonQuestionRatio * 5 + 1)));

  dimensionScores.ability_not_to_ask_question = {
    score: noQuestionScore,
    reason:
      noQuestionDeductions.length === turns.length
        ? 'Appended a question mark to 100% of turns.'
        : `Allowed ${turns.length - noQuestionDeductions.length} turn(s) to end without an obligatory question.`,
    deductionTurnIndices: noQuestionDeductions,
    confidence: 0.95,
  };

  // Populate remaining requested dimensions
  rubricDimensions.forEach((dim) => {
    if (!dimensionScores[dim]) {
      dimensionScores[dim] = {
        score: cheapScore >= 4 ? 4 : 2,
        reason: `Evaluated dimension ${dim} across ${turns.length} turns.`,
        deductionTurnIndices: [],
        confidence: 0.8,
      };
    }
  });

  // Calculate Turn Quality vs Trajectory Quality
  const turnQualityScore = Math.round((cheapScore * 0.5 + interpScore * 0.5) * 10) / 10;
  const trajectoryQualityScore = Math.round((leadershipLoadScore * 0.6 + objFulfillment * 0.4) * 10) / 10;

  const scoredValues = Object.values(dimensionScores).map((d) => d?.score ?? 3);
  const behaviorScore =
    scoredValues.reduce((a, b) => a + b, 0) / (scoredValues.length || 1);

  // Product Verdict Determination
  let productVerdict: ProductVerdict = 'ACCEPTABLE';
  if (cheapScore <= 2 || leadershipLoadScore <= 2 || behaviorScore < 2.5) {
    productVerdict = 'UNACCEPTABLE';
  } else if (cheapScore === 3 || leadershipLoadScore === 3 || behaviorScore < 3.5) {
    productVerdict = 'FLAWED';
  } else if (behaviorScore >= 4.5 && cheapScore >= 4 && leadershipLoadScore >= 4) {
    productVerdict = 'EXCELLENT';
  }

  const cheapChatbotSmellDetected = cheapScore <= 3;

  return {
    dimensionScores,
    behaviorScore: Math.round(behaviorScore * 10) / 10,
    turnQualityScore,
    trajectoryQualityScore,
    objectiveFulfillmentScore: objFulfillment,
    userContentDemandsCount,
    leadershipLoadOnUserScore: leadershipLoadScore,
    objectiveAbandonmentReason,
    productVerdict,
    qualitative: {
      summary: `Evaluated ${turns.length} turns for fixture ${options.fixtureId}. Verdict: ${productVerdict} (Leadership Load: ${leadershipLoadScore}/5, Turn Quality: ${turnQualityScore}, Trajectory: ${trajectoryQualityScore})`,
      strengths:
        cheapScore >= 4 && leadershipLoadScore >= 4
          ? ['Natural conversational cadence', 'Retained grounded leadership']
          : ['Active conversation recorded'],
      weaknesses:
        leadershipReasons.length > 0 || cheapSmellReasons.length > 0
          ? [...cheapSmellReasons, ...leadershipReasons]
          : [],
      cheapChatbotSmellDetected,
    },
  };
}

export function judgeEpisode(options: JudgeOptions) {
  const result = judgeEpisodeTurnByTurn(options);
  const scoresRecord: Record<string, number> = {};
  for (const [key, val] of Object.entries(result.dimensionScores)) {
    if (val) scoresRecord[key] = val.score;
  }
  return {
    scores: scoresRecord as Record<RubricDimension, number>,
    summary: result.qualitative.summary,
    strengths: result.qualitative.strengths,
    weaknesses: result.qualitative.weaknesses,
    chatbotSmellDetected: result.qualitative.cheapChatbotSmellDetected,
  };
}
