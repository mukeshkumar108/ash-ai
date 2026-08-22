import fs from 'node:fs';
import path from 'node:path';

// Load environment variables from .env.local if present
function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    path.join(__dirname, '../../.env.local'),
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

import { stage1Fixtures } from './fixtures/stage1-fixtures';
import { runIndependentLLMJudge } from './judges/independent-llm-judge';
import { runPairwiseJudge } from './judges/pairwise-judge';
import { runEpisode } from './runners/episode-runner';
import { runModelPreflight } from './runners/preflight';
import type { EpisodeResult, JudgeDisagreement, RubricDimension } from './types';

async function executeStage1() {
  console.log('=== RUNNING STAGE 1 PRE-FLIGHT MODEL VERIFICATION ===');
  const targetModels = [
    'chat-model',
    'chat-model-reasoning',
    'nex-agi/nex-n2-mini',
  ];

  const preflightResults = await runModelPreflight(targetModels);
  console.log('Pre-flight model status:');
  for (const res of preflightResults) {
    console.log(
      ` - ${res.modelId} (${res.resolvedIdentifier ?? 'unresolved'}): ${res.status.toUpperCase()} (${res.latencyMs}ms)${
        res.error ? ` - error: ${res.error}` : ''
      }`,
    );
  }

  console.log('\n=== EXECUTING REVISED STAGE 1 CORE EPISODES WITH INDEPENDENT BLIND LLM JUDGE ===');
  const episodeResults: EpisodeResult[] = [];
  const textTranscriptLines: string[] = [];

  for (const fixture of stage1Fixtures) {
    console.log(`\nRunning Stage 1 Fixture: ${fixture.id} (${fixture.title})...`);
    const episodeResult = await runEpisode({
      fixture,
      modelId: 'chat-model',
    });

    episodeResult.episodeObjective = fixture.episodeObjective;

    // Run REAL Independent Blind LLM Judge
    console.log(` - Running Blind Independent LLM Judge for ${fixture.id}...`);
    const llmJudgeResult = await runIndependentLLMJudge({
      fixtureId: fixture.id,
      episodeObjective: fixture.episodeObjective,
      turns: episodeResult.turns,
      rubricDimensions: fixture.rubricDimensions,
    });
    episodeResult.independentLLMJudgeResult = llmJudgeResult;

    // Calculate Judge Disagreements between Heuristic Judge & Blind LLM Judge
    const disagreements: JudgeDisagreement[] = [];
    const coreDims: RubricDimension[] = [
      'cheap_chatbot_smell',
      'leadership_retention',
      'interpretation_restraint',
      'feels_alive',
    ];

    coreDims.forEach((dim) => {
      const scoreHeuristic = episodeResult.dimensionScores[dim]?.score ?? 5;
      const scoreLLM = llmJudgeResult.dimensionScores[dim]?.score ?? scoreHeuristic;
      const delta = Math.abs(scoreHeuristic - scoreLLM);
      if (delta > 0) {
        disagreements.push({
          dimension: dim,
          judgeAScore: scoreHeuristic,
          judgeBScore: scoreLLM,
          delta,
          reasonA: episodeResult.dimensionScores[dim]?.reason ?? 'Heuristic rule deduction.',
          reasonB: llmJudgeResult.dimensionScores[dim]?.reason ?? 'Independent LLM evaluation.',
        });
      }
    });
    episodeResult.judgeDisagreements = disagreements;

    // Run Pairwise Comparison for key episodes (comparing with self or alternative prompt shape)
    if (fixture.id === 'stage1-boredom-leadership' || fixture.id === 'stage1-temporal-walk') {
      console.log(` - Running Pairwise Comparison for ${fixture.id}...`);
      const pairwiseRes = await runPairwiseJudge({
        episodeObjective: fixture.episodeObjective,
        trajectoryA: episodeResult.turns,
        trajectoryB: episodeResult.turns,
      });
      episodeResult.pairwiseComparison = pairwiseRes;
    }

    episodeResults.push(episodeResult);

    // Format compact human-readable transcript
    textTranscriptLines.push('='.repeat(80));
    textTranscriptLines.push(`EPISODE: ${fixture.id} (${fixture.title})`);
    textTranscriptLines.push(`OBJECTIVE: ${fixture.episodeObjective}`);
    textTranscriptLines.push(
      `PRODUCT VERDICT: ${episodeResult.productVerdict} | MECHANISM: ${
        episodeResult.mechanismVerdict.passed ? 'PASSED' : 'FAILED'
      } | BEHAVIOR SCORE: ${episodeResult.behaviorScore}/5 (Turn Quality: ${
        episodeResult.turnQualityScore
      }, Trajectory: ${episodeResult.trajectoryQualityScore})`,
    );
    textTranscriptLines.push('='.repeat(80));

    for (const turn of episodeResult.turns) {
      const timeStr = new Date(turn.simulatedTime).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const steer = turn.productionPath.interactionSteer;
      const trace = turn.productionPath.detailedModelTrace;

      textTranscriptLines.push(`[${timeStr}] USER: ${turn.userTurn}`);
      textTranscriptLines.push(
        `[${timeStr}] SOPHIE (Phase: ${steer?.phase ?? 'NONE'} | Steered: ${
          trace.turnWasSteered ? 'YES' : 'NO'
        } | Provider: ${trace.providerSelected} | Model: ${trace.exactProviderModelIdentifierSent})`,
      );
      textTranscriptLines.push(turn.assistantOutput);
      textTranscriptLines.push('');
    }

    textTranscriptLines.push('-'.repeat(80));
    textTranscriptLines.push('MECHANISM VERDICT DETAILS:');
    textTranscriptLines.push(
      ` - Overall Mechanism: ${episodeResult.mechanismVerdict.passed ? 'PASSED' : 'FAILED'}`,
    );
    if (episodeResult.mechanismVerdict.failures.length > 0) {
      textTranscriptLines.push(
        ` - Mechanism Failures: ${episodeResult.mechanismVerdict.failures.join(' | ')}`,
      );
    }

    textTranscriptLines.push('HEURISTIC BEHAVIORAL SCORES & EVIDENCE:');
    for (const [dim, detail] of Object.entries(episodeResult.dimensionScores)) {
      if (detail) {
        textTranscriptLines.push(` - ${dim}: ${detail.score}/5 (${detail.reason})`);
      }
    }

    if (llmJudgeResult) {
      textTranscriptLines.push('INDEPENDENT BLIND LLM JUDGE VERDICT:');
      textTranscriptLines.push(
        ` - Verdict: ${llmJudgeResult.companionOrChatbotVerdict} (${llmJudgeResult.summarySentence})`,
      );
      textTranscriptLines.push(
        ` - Objective Fulfillment Score: ${llmJudgeResult.objectiveFulfillmentScore}/5 (${llmJudgeResult.objectiveFulfillmentReason})`,
      );
    }

    if (disagreements.length > 0) {
      textTranscriptLines.push('EVALUATOR DISAGREEMENTS (Heuristic vs LLM Judge):');
      for (const diag of disagreements) {
        textTranscriptLines.push(
          ` - ${diag.dimension}: Heuristic=${diag.judgeAScore} vs Blind LLM=${diag.judgeBScore} (Delta=${diag.delta})`,
        );
        textTranscriptLines.push(`   Heuristic Reason: ${diag.reasonA}`);
        textTranscriptLines.push(`   Blind LLM Reason: ${diag.reasonB}`);
      }
    }

    textTranscriptLines.push('\n\n');
  }

  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const jsonReportPath = path.join(reportsDir, 'stage1-report.json');
  fs.writeFileSync(
    jsonReportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        preflightResults,
        episodeResults,
      },
      null,
      2,
    ),
  );

  const textReportPath = path.join(reportsDir, 'stage1-transcripts.txt');
  fs.writeFileSync(textReportPath, textTranscriptLines.join('\n'));

  console.log(`\nStage 1 Calibrated Execution Complete.`);
  console.log(` - JSON Report: ${jsonReportPath}`);
  console.log(` - Text Transcripts: ${textReportPath}`);
}

executeStage1().catch((err) => {
  console.error('Stage 1 Execution Error:', err);
  process.exit(1);
});
