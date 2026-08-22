import type { InteractionSteer } from '@/lib/ai/interaction/types';

export type ResponseModeExpectation =
  | 'TINY'
  | 'SHORT'
  | 'MEDIUM'
  | 'THOROUGH'
  | 'MULTI_STEP';

export type AllowedOutputShape = 'single' | 'multi_beat';

export type EpisodeType = 'FIXED' | 'REACTIVE';

export type RubricDimension =
  | 'conversational_agency'
  | 'conversational_ownership'
  | 'desire_to_engage'
  | 'adaptation'
  | 'tactic_variation'
  | 'leadership_persistence'
  | 'leadership_retention'
  | 'leadership_load_on_user'
  | 'question_quality'
  | 'ability_not_to_ask_question'
  | 'interpretation_restraint'
  | 'topic_shift_judgment'
  | 'phase_objective_persistence'
  | 'relational_continuity'
  | 'time_of_day_judgment'
  | 'values_enacted'
  | 'feels_alive'
  | 'cheap_chatbot_smell'
  | 'would_continue_talking'
  | 'objective_progress'
  | 'objective_retention'
  | 'objective_adaptation';

export type FixtureTurn = {
  timestamp: string; // ISO String for evaluationNow
  userInput?: string;
  expectedTurnType?: 'user' | 'assistant_initiative';
};

export type UserSimulatorConfig = {
  persona: string;
  hiddenState: {
    energy: 'low' | 'medium' | 'high';
    wantsSophieToLead: boolean;
    patienceForQuestions: 'low' | 'medium' | 'high';
    likesPlayfulness: boolean;
  };
  reactionRules: Array<{
    condition: string;
    action: string;
  }>;
};

export type DeterministicAssertions = {
  phaseShouldPersist?: boolean;
  phaseShouldStop?: boolean;
  opportunityCreated?: boolean;
  initiativeEvaluated?: boolean;
  initiativeDecision?: 'SPEAK' | 'SILENCE';
  steeredModelUsed?: boolean;
  dedupeWorked?: boolean;
  noDuplicateInitiative?: boolean;
  expectedModelRoute?: string;
};

export type EvalFixture = {
  id: string;
  title: string;
  category:
    | 'cold_start'
    | 'leadership'
    | 'temporal'
    | 'initiative'
    | 'tutoring'
    | 'medical'
    | 'legal'
    | 'technical'
    | 'values';
  episodeType: EpisodeType;
  episodeObjective: string;
  responseModeExpectation: ResponseModeExpectation;
  allowedOutputShape: AllowedOutputShape;
  initialState?: {
    userLocation?: string;
    activePhase?: string;
  };
  turns: FixtureTurn[];
  userSimulatorConfig?: UserSimulatorConfig;
  deterministicAssertions: DeterministicAssertions;
  rubricDimensions: RubricDimension[];
};

export type DetailedModelTrace = {
  configuredAliasRequested: string;
  modelIdPassedByLlmAgentTest: string;
  modelIdPassedToCompanionRuntime: string;
  providerSelected: 'NanoGPT' | 'OpenRouter' | 'Unknown';
  exactProviderModelIdentifierSent: string;
  providerReturnedModelIdentifier: string | null;
  fallbackModel: string | null;
  fallbackOccurred: boolean;
  fallbackReason: string | null;
  turnWasSteered: boolean;
  steeredModelEscalated: boolean;
};

export type TurnTrace = {
  turnIndex: number;
  simulatedTime: string;
  userTurn: string;
  assistantOutput: string;
  outputBeats?: string[];
  productionPath: {
    interactionJudgeRan: boolean;
    interactionSteer: InteractionSteer | null;
    cortexContextFetched: boolean;
    cortexPacketSummary: string | null;
    honchoMemoryPrepared: boolean;
    honchoPacketSummary: string | null;
    modelRequested: string;
    modelActuallyUsed: string;
    steeredEscalated: boolean;
    laneSelected: string;
    initiativeOpportunityScheduled: boolean;
    attentionCandidatesExtracted: number;
    honchoMirrored: boolean;
    detailedModelTrace: DetailedModelTrace;
  };
  initiativeTrace?: {
    opportunityClaimed: boolean;
    opportunityDuplicate: boolean;
    decision: 'SPEAK' | 'SILENCE';
    reason: string;
    composedText?: string;
    exactFailureDetails?: {
      opportunityCreated: boolean;
      scanFoundIt: boolean;
      claimSucceeded: boolean;
      evaluationRan: boolean;
      compositionRan: boolean;
      persistenceRan: boolean;
      honchoMirrored: boolean;
      failureReason: string | null;
    };
  };
  assertionsResult: {
    passed: boolean;
    failures: string[];
  };
};

export type RubricDimensionDetail = {
  score: number; // 1 to 5
  reason: string; // 1-2 sentence evidence
  deductionTurnIndices: number[];
  confidence: number; // 0.0 to 1.0
};

export type ProductVerdict = 'EXCELLENT' | 'ACCEPTABLE' | 'FLAWED' | 'UNACCEPTABLE';

export type MechanismVerdict = {
  passed: boolean;
  failures: string[];
  details: {
    phasePersisted: boolean;
    cortexCalled: boolean;
    opportunityCreated: boolean;
    initiativeEvaluated: boolean;
    modelRouteWorked: boolean;
    exactInitiativeFailureReason?: string | null;
  };
};

export type JudgeDisagreement = {
  dimension: RubricDimension;
  judgeAScore: number; // Heuristic Judge
  judgeBScore: number; // Blind LLM Judge
  delta: number;
  reasonA: string;
  reasonB: string;
};

export type IndependentLLMJudgeResult = {
  judgeId: string;
  companionOrChatbotVerdict: 'COMPANION' | 'CHATBOT' | 'AMBIGUOUS';
  summarySentence: string;
  objectiveFulfillmentScore: number; // 1-5
  objectiveFulfillmentReason: string;
  dimensionScores: Partial<Record<RubricDimension, RubricDimensionDetail>>;
};

export type ContrastivePair = {
  id: string;
  category: 'leadership' | 'adaptation' | 'restraint' | 'temporal' | 'no_question';
  episodeObjective: string;
  optionA: Array<{ user: string; sophie: string }>; // Inferior (handback/passive)
  optionB: Array<{ user: string; sophie: string }>; // Superior (active leadership/grounded)
  whyBIsSuperior: string;
};

export type PairwiseComparisonResult = {
  winner: 'Option A' | 'Option B' | 'TIED';
  comparisonSummary: string;
  dimensionBreakdown: {
    conversationalAgencyWinner: string;
    leadershipWinner: string;
    naturalnessWinner: string;
    adaptationWinner: string;
  };
};

export type EpisodeResult = {
  fixtureId: string;
  category: string;
  episodeType: EpisodeType;
  episodeObjective: string;
  modelId: string;
  turns: TurnTrace[];
  mechanismVerdict: MechanismVerdict;
  turnQualityScore: number;
  trajectoryQualityScore: number;
  objectiveFulfillmentScore: number;
  userContentDemandsCount: number;
  leadershipLoadOnUserScore: number;
  objectiveAbandonmentReason: string | null;
  behaviorScore: number; // Composite average
  productVerdict: ProductVerdict;
  dimensionScores: Partial<Record<RubricDimension, RubricDimensionDetail>>;
  independentLLMJudgeResult?: IndependentLLMJudgeResult;
  pairwiseComparison?: PairwiseComparisonResult;
  judgeDisagreements?: JudgeDisagreement[];
  episodeQualitative: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    cheapChatbotSmellDetected: boolean;
  };
};
