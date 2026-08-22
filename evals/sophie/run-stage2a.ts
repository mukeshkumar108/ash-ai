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

import { stage2aFixtures } from './fixtures/stage2a-fixtures';
import { runEpisode } from './runners/episode-runner';
import type { EpisodeResult, ProductVerdict } from './types';

export const STAGE2A_PREFLIGHTED_MODELS = [
  { id: 'chat-model', name: 'Gemma 4 Dark Gemistry (Current Baseline)', status: 'AVAILABLE' },
  { id: 'google/gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', status: 'AVAILABLE' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', status: 'AVAILABLE' },
  { id: 'nex-agi/nex-n2-mini', name: 'Nex N2 Mini', status: 'AVAILABLE' },
  { id: 'nvidia/nemotron-3.5-lightning', name: 'Nemotron 3.5 Lightning', status: 'AVAILABLE' },
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', status: 'AVAILABLE' },
];

export const STAGE2A_UNAVAILABLE_MODELS = [
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash 0731', reason: 'Endpoint execution timed out during preflight (>10s)' },
  { id: 'zai-org/glm-5.2', name: 'GLM 5.2', reason: 'Invalid model ID (no active endpoint)' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Sonnet Reference', reason: 'No endpoints found for requested provider credential' },
];

const EPISODE_LANE_MAP: Record<string, 'ambient' | 'leadership' | 'continuity' | 'task_transition'> = {
  's2a-cold-start': 'ambient',
  's2a-boredom-leadership': 'leadership',
  's2a-failed-tactic-adaptation': 'leadership',
  's2a-playful-social': 'ambient',
  's2a-emotional-hold-witness': 'ambient',
  's2a-values-2am': 'ambient',
  's2a-morning-low-energy': 'ambient',
  's2a-temporal-reentry': 'continuity',
  's2a-real-initiative-followup': 'continuity',
  's2a-tutoring-companion-transition': 'task_transition',
  's2a-technical-companion-transition': 'task_transition',
  's2a-medical-relational-transition': 'task_transition',
  's2a-research-handoff': 'task_transition',
};

export async function executeStage2A() {
  console.log('=== RUNNING REVISED STAGE 2A MODEL EVALUATION MATRIX ===\n');

  const matrixResults: Record<string, EpisodeResult[]> = {};
  const textTranscriptLines: string[] = [];
  const timeoutRecords: Array<{ modelId: string; fixtureId: string; timestamp: string; error: string }> = [];

  for (const modelDef of STAGE2A_PREFLIGHTED_MODELS) {
    const modelId = modelDef.id;
    console.log(`\n==================================================`);
    console.log(`EVALUATING MODEL: ${modelDef.name} (${modelId})`);
    console.log(`==================================================`);

    matrixResults[modelId] = [];

    for (const fixture of stage2aFixtures) {
      console.log(` - Running Episode [${fixture.id}] for model ${modelId}...`);
      try {
        const result = await runEpisode({ fixture, modelId });
        matrixResults[modelId].push(result);

        const initiativeTurn = result.turns.find((t) => t.initiativeTrace);
        if (
          initiativeTurn?.initiativeTrace?.exactFailureDetails?.failureReason?.includes('timeout')
        ) {
          timeoutRecords.push({
            modelId,
            fixtureId: fixture.id,
            timestamp: new Date().toISOString(),
            error: initiativeTurn.initiativeTrace.exactFailureDetails.failureReason,
          });
        }
      } catch (err: any) {
        console.warn(` ⚠️ Timeout / Failure on episode ${fixture.id} for model ${modelId}: ${err.message}`);
        timeoutRecords.push({
          modelId,
          fixtureId: fixture.id,
          timestamp: new Date().toISOString(),
          error: err.message,
        });
      }
    }
  }

  // Model Summary Aggregation & Specialty Lane Metrics
  console.log('\n==================================================');
  console.log('COMPILING STAGE 2A MODEL MATRIX COMPARISON SUMMARY');
  console.log('==================================================\n');

  const modelSummaries: Record<
    string,
    {
      name: string;
      overallBehaviorScore: number;
      overallLeadershipLoadScore: number;
      laneScores: {
        ambient: number;
        leadership: number;
        continuity: number;
        task_transition: number;
      };
      verdictCounts: Record<ProductVerdict, number>;
      totalTimeouts: number;
    }
  > = {};

  textTranscriptLines.push('================================================================================');
  textTranscriptLines.push('STAGE 2A REVISED MODEL MATRIX EVALUATION REPORT');
  textTranscriptLines.push('================================================================================\n');

  for (const modelDef of STAGE2A_PREFLIGHTED_MODELS) {
    const modelId = modelDef.id;
    const episodes = matrixResults[modelId] || [];

    const verdictCounts: Record<ProductVerdict, number> = {
      EXCELLENT: 0,
      ACCEPTABLE: 0,
      FLAWED: 0,
      UNACCEPTABLE: 0,
    };

    let sumBehavior = 0;
    let sumLeadershipLoad = 0;

    const laneSums = { ambient: 0, leadership: 0, continuity: 0, task_transition: 0 };
    const laneCounts = { ambient: 0, leadership: 0, continuity: 0, task_transition: 0 };

    for (const ep of episodes) {
      verdictCounts[ep.productVerdict]++;
      sumBehavior += ep.behaviorScore;
      sumLeadershipLoad += ep.leadershipLoadOnUserScore;

      const lane = EPISODE_LANE_MAP[ep.fixtureId] || 'ambient';
      laneSums[lane] += ep.behaviorScore;
      laneCounts[lane]++;
    }

    const totalCount = episodes.length || 1;
    const modelTimeouts = timeoutRecords.filter((t) => t.modelId === modelId).length;

    const laneScores = {
      ambient: Math.round((laneSums.ambient / (laneCounts.ambient || 1)) * 10) / 10,
      leadership: Math.round((laneSums.leadership / (laneCounts.leadership || 1)) * 10) / 10,
      continuity: Math.round((laneSums.continuity / (laneCounts.continuity || 1)) * 10) / 10,
      task_transition: Math.round((laneSums.task_transition / (laneCounts.task_transition || 1)) * 10) / 10,
    };

    modelSummaries[modelId] = {
      name: modelDef.name,
      overallBehaviorScore: Math.round((sumBehavior / totalCount) * 10) / 10,
      overallLeadershipLoadScore: Math.round((sumLeadershipLoad / totalCount) * 10) / 10,
      laneScores,
      verdictCounts,
      totalTimeouts: modelTimeouts,
    };

    console.log(`MODEL: ${modelDef.name} (${modelId})`);
    console.log(` - Overall Behavior Score: ${modelSummaries[modelId].overallBehaviorScore}/5`);
    console.log(` - Overall Leadership Load Score: ${modelSummaries[modelId].overallLeadershipLoadScore}/5`);
    console.log(` - Specialty Lane Scores:`);
    console.log(`   * Ambient Companion & Warmth: ${laneScores.ambient}/5`);
    console.log(`   * Conversational Agency & Leadership: ${laneScores.leadership}/5`);
    console.log(`   * Relational Continuity & Initiative: ${laneScores.continuity}/5`);
    console.log(`   * Task, Tutoring & Handoff: ${laneScores.task_transition}/5`);
    console.log(` - Verdicts: EXCELLENT=${verdictCounts.EXCELLENT}, ACCEPTABLE=${verdictCounts.ACCEPTABLE}, FLAWED=${verdictCounts.FLAWED}, UNACCEPTABLE=${verdictCounts.UNACCEPTABLE}`);
    console.log(` - Recorded Timeouts: ${modelTimeouts}\n`);

    textTranscriptLines.push(`MODEL: ${modelDef.name} (${modelId})`);
    textTranscriptLines.push(` - Overall Behavior Score: ${modelSummaries[modelId].overallBehaviorScore}/5`);
    textTranscriptLines.push(` - Overall Leadership Load Score: ${modelSummaries[modelId].overallLeadershipLoadScore}/5`);
    textTranscriptLines.push(` - Specialty Lane Scores:`);
    textTranscriptLines.push(`   * Ambient Companion & Warmth: ${laneScores.ambient}/5`);
    textTranscriptLines.push(`   * Conversational Agency & Leadership: ${laneScores.leadership}/5`);
    textTranscriptLines.push(`   * Relational Continuity & Initiative: ${laneScores.continuity}/5`);
    textTranscriptLines.push(`   * Task, Tutoring & Handoff: ${laneScores.task_transition}/5`);
    textTranscriptLines.push(` - Verdicts: EXCELLENT=${verdictCounts.EXCELLENT}, ACCEPTABLE=${verdictCounts.ACCEPTABLE}, FLAWED=${verdictCounts.FLAWED}, UNACCEPTABLE=${verdictCounts.UNACCEPTABLE}`);
    textTranscriptLines.push(` - Recorded Timeouts: ${modelTimeouts}\n`);

    textTranscriptLines.push('--- RAW EPISODE TRANSCRIPTS ---');
    for (const ep of episodes) {
      textTranscriptLines.push(`[EPISODE: ${ep.fixtureId}] Objective: ${ep.episodeObjective}`);
      textTranscriptLines.push(`Verdict: ${ep.productVerdict} | Behavior Score: ${ep.behaviorScore}/5 (Leadership Load: ${ep.leadershipLoadOnUserScore}/5)`);
      for (const turn of ep.turns) {
        textTranscriptLines.push(`USER: ${turn.userTurn}`);
        textTranscriptLines.push(`SOPHIE: ${turn.assistantOutput}`);
      }
      textTranscriptLines.push('-'.repeat(60));
    }
    textTranscriptLines.push('\n');
  }

  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const jsonReportPath = path.join(reportsDir, 'stage2a-report.json');
  fs.writeFileSync(
    jsonReportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        preflightedModels: STAGE2A_PREFLIGHTED_MODELS,
        unavailableModels: STAGE2A_UNAVAILABLE_MODELS,
        modelSummaries,
        timeoutRecords,
        matrixResults,
      },
      null,
      2,
    ),
  );

  const textReportPath = path.join(reportsDir, 'stage2a-transcripts.txt');
  fs.writeFileSync(textReportPath, textTranscriptLines.join('\n'));

  console.log(`\nStage 2A Execution Complete.`);
  console.log(` - JSON Report: ${jsonReportPath}`);
  console.log(` - Text Transcripts: ${textReportPath}`);
}

if (require.main === module) {
  executeStage2A().catch(console.error);
}
