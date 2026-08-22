import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    '/Users/mukeshkumar/play/llm-agent-test/.env.local',
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}
loadEnv();

import { contrastivePairs } from '../judges/contrastive-pairs';
import { runPairwiseJudge } from '../judges/pairwise-judge';
import type { TurnTrace } from '../types';

function mockTurnsFromPair(pairs: Array<{ user: string; sophie: string }>): TurnTrace[] {
  return pairs.map((p, idx) => ({
    turnIndex: idx,
    simulatedTime: new Date().toISOString(),
    userTurn: p.user,
    assistantOutput: p.sophie,
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
}

export async function runContrastiveEvaluation() {
  console.log('=== RUNNING CONTRASTIVE TRAJECTORY EVALUATOR CHECK ===\n');

  let optionBWins = 0;

  for (const pair of contrastivePairs) {
    console.log(`Evaluating Pair [${pair.id}] (${pair.category})...`);
    console.log(`Objective: ${pair.episodeObjective}`);

    const turnsA = mockTurnsFromPair(pair.optionA);
    const turnsB = mockTurnsFromPair(pair.optionB);

    const result = await runPairwiseJudge({
      episodeObjective: pair.episodeObjective,
      trajectoryA: turnsA,
      trajectoryB: turnsB,
      judgeModelId: 'chat-model-reasoning',
    });

    console.log(` - Winner: ${result.winner}`);
    console.log(` - Summary: ${result.comparisonSummary}`);
    console.log(` - Why B Is Superior: ${pair.whyBIsSuperior}\n`);

    if (result.winner === 'Trajectory B') {
      optionBWins++;
    }
  }

  const accuracy = (optionBWins / contrastivePairs.length) * 100;
  console.log(`=== CONTRASTIVE EVALUATION RESULTS ===`);
  console.log(`Option B Win Rate: ${optionBWins}/${contrastivePairs.length} (${accuracy.toFixed(1)}%)`);

  if (accuracy >= 80) {
    console.log('✅ CONTRASTIVE EVALUATOR PASSED CONSTRAINTS (>=80% ACCURACY)!');
  } else {
    console.warn('⚠️ CONTRASTIVE EVALUATOR BELOW 80% THRESHOLD');
  }

  return { optionBWins, total: contrastivePairs.length, accuracy };
}

if (require.main === module) {
  runContrastiveEvaluation().catch(console.error);
}
