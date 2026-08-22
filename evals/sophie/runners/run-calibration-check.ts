import { calibrationDataset } from '../judges/calibration-dataset';
import { judgeEpisodeTurnByTurn } from '../judges/episode-judge';
import type { TurnTrace } from '../types';

export function runCalibrationCheck() {
  console.log('=== RUNNING BEHAVIORAL JUDGE CALIBRATION CHECK ===\n');

  let passed = true;

  for (const example of calibrationDataset) {
    const mockTurns: TurnTrace[] = example.transcript.map((t, idx) => ({
      turnIndex: idx,
      simulatedTime: new Date().toISOString(),
      userTurn: t.user,
      assistantOutput: t.sophie,
      productionPath: {
        interactionJudgeRan: true,
        interactionSteer: null,
        cortexContextFetched: true,
        cortexPacketSummary: null,
        honchoMemoryPrepared: true,
        honchoPacketSummary: null,
        modelRequested: 'chat-model',
        modelActuallyUsed: 'chat-model',
        steeredEscalated: false,
        laneSelected: 'reply_only',
        initiativeOpportunityScheduled: false,
        attentionCandidatesExtracted: 0,
        honchoMirrored: false,
        detailedModelTrace: {
          configuredAliasRequested: 'chat-model',
          modelIdPassedByLlmAgentTest: 'chat-model',
          modelIdPassedToCompanionRuntime: 'chat-model',
          providerSelected: 'NanoGPT',
          exactProviderModelIdentifierSent: 'Gemma-4-31B-Dark-Gemistry',
          providerReturnedModelIdentifier: 'Gemma-4-31B-Dark-Gemistry',
          fallbackModel: null,
          fallbackOccurred: false,
          fallbackReason: null,
          turnWasSteered: false,
          steeredModelEscalated: false,
        },
      },
      assertionsResult: { passed: true, failures: [] },
    }));

    const result = judgeEpisodeTurnByTurn({
      fixtureId: example.id,
      turns: mockTurns,
      rubricDimensions: [
        'cheap_chatbot_smell',
        'interpretation_restraint',
        'leadership_retention',
        'ability_not_to_ask_question',
      ],
    });

    const cheapSmellScore = result.dimensionScores.cheap_chatbot_smell?.score ?? 5;
    const interpScore = result.dimensionScores.interpretation_restraint?.score ?? 5;

    console.log(`[${example.label}] ID: ${example.id}`);
    console.log(` - Why Labeled: ${example.whyLabeled}`);
    console.log(
      ` - Computed Cheap Chatbot Smell Score: ${cheapSmellScore}/5 (Expected: ${example.expectedScores.cheap_chatbot_smell})`,
    );
    console.log(
      ` - Computed Interpretation Restraint Score: ${interpScore}/5 (Expected: ${example.expectedScores.interpretation_restraint})`,
    );
    console.log(` - Product Verdict: ${result.productVerdict}`);
    console.log(` - Deductions: ${result.qualitative.weaknesses.join(' | ') || 'None'}\n`);

    if (example.label === 'BAD') {
      if (cheapSmellScore > 2 && interpScore > 2) {
        console.error(`❌ CALIBRATION FAILURE: BAD example ${example.id} received high score (${cheapSmellScore})!`);
        passed = false;
      }
    } else {
      if (cheapSmellScore < 4) {
        console.error(`❌ CALIBRATION FAILURE: GOOD example ${example.id} received low score (${cheapSmellScore})!`);
        passed = false;
      }
    }
  }

  if (passed) {
    console.log('✅ BEHAVIORAL JUDGE CALIBRATION PASSED PERFECTLY!\n');
  } else {
    console.error('❌ BEHAVIORAL JUDGE CALIBRATION FAILED CONSTRAINTS!\n');
    process.exit(1);
  }
}

if (require.main === module) {
  runCalibrationCheck();
}
