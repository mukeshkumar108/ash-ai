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

import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';

export interface SavedTurn {
  turnIndex: number;
  timestamp: string;
  userTurn: string;
  assistantOutput: string;
}

export interface SavedScenarioResult {
  scenarioId: string;
  scenarioTitle: string;
  testType: string;
  modelId: string;
  modelName: string;
  personaId: string;
  turns: SavedTurn[];
}

export interface SavedReport {
  tournamentResults: Record<string, SavedScenarioResult[]>;
}

export interface PairwiseQuestionResult {
  questionId: string;
  questionText: string;
  winner: 'Model A' | 'Model B' | 'Tie';
  rationale: string;
}

export interface PairwiseComparisonResult {
  pairName: string;
  scenarioId: string;
  scenarioTitle: string;
  modelA: { id: string; name: string };
  modelB: { id: string; name: string };
  swapped: boolean;
  questions: PairwiseQuestionResult[];
  rawJudgeOutput: string;
  executionStatus: 'SUCCESS' | 'ERROR';
}

const CANDIDATE_PAIRS = [
  { pairName: 'Nex vs deployed Gemma', modelId1: 'nex-agi/nex-n2-mini', modelId2: 'chat-model' },
  { pairName: 'Nex vs Luna', modelId1: 'nex-agi/nex-n2-mini', modelId2: 'openai/gpt-5.6-luna' },
  { pairName: 'Nex vs Gemini 2.5', modelId1: 'nex-agi/nex-n2-mini', modelId2: 'google/gemini-2.5-flash' },
  { pairName: 'Nex vs Gemini 3.7', modelId1: 'nex-agi/nex-n2-mini', modelId2: 'google/gemini-3.7-flash' },
  { pairName: 'Gemma vs Luna', modelId1: 'chat-model', modelId2: 'openai/gpt-5.6-luna' },
  { pairName: 'Gemini 2.5 vs Gemini 3.7', modelId1: 'google/gemini-2.5-flash', modelId2: 'google/gemini-3.7-flash' },
];

const TARGET_SUBJECTIVE_SCENARIOS = [
  'sim-full-day',
  'sim-boredom-leadership',
  'sim-good-news-celebration',
  'sim-sadness-emotional-support',
  'sim-values-integrity',
];

const PAIRWISE_QUESTIONS = [
  { id: 'q1', text: 'Which feels more like a distinctive companion rather than an assistant?' },
  { id: 'q2', text: 'Which has better spontaneous wit?' },
  { id: 'q3', text: 'Which feels less scripted?' },
  { id: 'q4', text: 'Which has less faux-depth?' },
  { id: 'q5', text: 'Which demands less conversational labor from the user?' },
  { id: 'q6', text: 'Which adapts better after a weak user response like "meh"?' },
  { id: 'q7', text: 'Which one would you actually want to keep talking to for another 20 minutes?' },
];

export async function judgePairwiseBlindWithRetry({
  pairName,
  scenario,
  result1,
  result2,
  retriesLeft = 3,
}: {
  pairName: string;
  scenario: { id: string; title: string };
  result1: SavedScenarioResult;
  result2: SavedScenarioResult;
  retriesLeft?: number;
}): Promise<PairwiseComparisonResult> {
  const swapped = Math.random() < 0.5;
  const modelA = swapped ? { id: result2.modelId, name: result2.modelName } : { id: result1.modelId, name: result1.modelName };
  const modelB = swapped ? { id: result1.modelId, name: result1.modelName } : { id: result2.modelId, name: result2.modelName };
  const turnsA = swapped ? result2.turns : result1.turns;
  const turnsB = swapped ? result1.turns : result2.turns;

  const trajA = turnsA.map((t) => `USER: ${t.userTurn}\nSOPHIE: ${t.assistantOutput}`).join('\n\n');
  const trajB = turnsB.map((t) => `USER: ${t.userTurn}\nSOPHIE: ${t.assistantOutput}`).join('\n\n');

  const prompt = `You are an expert blind judge evaluating two AI companion models for Sophie.
Scenario: [${scenario.id}] (${scenario.title}).

TRAJECTORY MODEL A:
${trajA}

==================================================

TRAJECTORY MODEL B:
${trajB}

==================================================

Compare Model A and Model B on these 7 questions based strictly on transcript evidence:
1. Which feels more like a distinctive companion rather than an assistant?
2. Which has better spontaneous wit?
3. Which feels less scripted?
4. Which has less faux-depth?
5. Which demands less conversational labor from the user?
6. Which adapts better after a weak user response like "meh"?
7. Which one would you actually want to keep talking to for another 20 minutes?

INSTRUCTIONS:
- Evaluate stylistic differences carefully. If one model has noticeably sharper wit, less corporate phrasing, or better adaptation, award the win to that model ("Model A" or "Model B").
- Only assign "Tie" if both models are genuinely equivalent on that specific question.
- Include a 1-sentence rationale for each question.

Return a JSON array of 7 objects:
[
  { "questionId": "q1", "winner": "Model A" | "Model B" | "Tie", "rationale": "..." },
  ...
]`;

  try {
    const judgeModel = getLanguageModel('chat-model-reasoning');
    const res = await generateText({
      model: judgeModel,
      prompt,
      abortSignal: AbortSignal.timeout(45_000), // 45s timeout to prevent premature aborts
    });
    const rawOutput = res.text.trim();

    const jsonMatch = rawOutput.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const questionResults = PAIRWISE_QUESTIONS.map((q) => {
        const found = parsed.find(
          (item: any) => item.questionId === q.id || item.questionText?.includes(q.text),
        );
        return {
          questionId: q.id,
          questionText: q.text,
          winner:
            found?.winner === 'Model A'
              ? ('Model A' as const)
              : found?.winner === 'Model B'
                ? ('Model B' as const)
                : ('Tie' as const),
          rationale: found?.rationale || 'Close match on transcript evidence.',
        };
      });

      return {
        pairName,
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        modelA,
        modelB,
        swapped,
        questions: questionResults,
        rawJudgeOutput: rawOutput,
        executionStatus: 'SUCCESS',
      };
    }
  } catch (err: any) {
    if (retriesLeft > 0) {
      console.warn(`Retry attempt (${3 - retriesLeft + 1}) for ${pairName} [${scenario.id}]: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000));
      return judgePairwiseBlindWithRetry({ pairName, scenario, result1, result2, retriesLeft: retriesLeft - 1 });
    }
  }

  // If retries exhausted, report execution error cleanly (do NOT disguise as Tie)
  return {
    pairName,
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    modelA,
    modelB,
    swapped,
    questions: PAIRWISE_QUESTIONS.map((q) => ({
      questionId: q.id,
      questionText: q.text,
      winner: 'Tie',
      rationale: 'Judge execution failed after 3 retries.',
    })),
    rawJudgeOutput: '[Execution Error: Retries Exhausted]',
    executionStatus: 'ERROR',
  };
}

export async function runCalibratedBlindPairwise() {
  console.log('=== RUNNING BATCHED CALIBRATED BLIND PAIRWISE EVALUATOR ===\n');

  const reportPath = path.join(process.cwd(), 'evals/sophie/life-sim/reports/tournament-report.json');
  if (!fs.existsSync(reportPath)) {
    console.error(`Report file not found at: ${reportPath}`);
    return;
  }

  const report: SavedReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  const itemsToEvaluate: Array<{
    pairName: string;
    scenarioId: string;
    scenarioTitle: string;
    res1: SavedScenarioResult;
    res2: SavedScenarioResult;
  }> = [];

  for (const pairDef of CANDIDATE_PAIRS) {
    const m1Results = report.tournamentResults[pairDef.modelId1] || [];
    const m2Results = report.tournamentResults[pairDef.modelId2] || [];

    for (const scId of TARGET_SUBJECTIVE_SCENARIOS) {
      const res1 = m1Results.find((r) => r.scenarioId === scId);
      const res2 = m2Results.find((r) => r.scenarioId === scId);
      if (res1 && res2) {
        itemsToEvaluate.push({
          pairName: pairDef.pairName,
          scenarioId: scId,
          scenarioTitle: res1.scenarioTitle,
          res1,
          res2,
        });
      }
    }
  }

  console.log(`Total Pairwise Items to Evaluate: ${itemsToEvaluate.length}`);
  console.log('Running in controlled batches of 3 to eliminate API timeouts...\n');

  const pairwiseResults: PairwiseComparisonResult[] = [];
  const BATCH_SIZE = 3;

  for (let i = 0; i < itemsToEvaluate.length; i += BATCH_SIZE) {
    const batch = itemsToEvaluate.slice(i, i + BATCH_SIZE);
    console.log(`Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(itemsToEvaluate.length / BATCH_SIZE)}...`);

    const batchResults = await Promise.all(
      batch.map((item) =>
        judgePairwiseBlindWithRetry({
          pairName: item.pairName,
          scenario: { id: item.scenarioId, title: item.scenarioTitle },
          result1: item.res1,
          result2: item.res2,
        }),
      ),
    );

    pairwiseResults.push(...batchResults);
  }

  // Aggregate Pairwise Win Totals
  console.log('\n==================================================');
  console.log('CALIBRATED BLIND PAIRWISE SCOREBOARD');
  console.log('==================================================\n');

  const pairScores: Record<
    string,
    { model1: string; model2: string; m1Wins: number; m2Wins: number; ties: number; errors: number }
  > = {};

  for (const comp of pairwiseResults) {
    if (!pairScores[comp.pairName]) {
      const pDef = CANDIDATE_PAIRS.find((p) => p.pairName === comp.pairName)!;
      pairScores[comp.pairName] = {
        model1: pDef.modelId1,
        model2: pDef.modelId2,
        m1Wins: 0,
        m2Wins: 0,
        ties: 0,
        errors: 0,
      };
    }

    const item = pairScores[comp.pairName];

    if (comp.executionStatus === 'ERROR') {
      item.errors++;
      continue;
    }

    for (const q of comp.questions) {
      if (q.winner === 'Tie') {
        item.ties++;
      } else {
        const actualWinnerId = q.winner === 'Model A' ? comp.modelA.id : comp.modelB.id;
        if (actualWinnerId === item.model1) item.m1Wins++;
        else item.m2Wins++;
      }
    }
  }

  for (const [pName, res] of Object.entries(pairScores)) {
    console.log(`PAIR: ${pName}`);
    console.log(` - ${res.model1}: ${res.m1Wins} wins`);
    console.log(` - ${res.model2}: ${res.m2Wins} wins`);
    console.log(` - Ties: ${res.ties}`);
    console.log(` - Errors/Timeouts: ${res.errors}\n`);
  }

  const reportsDir = path.join(process.cwd(), 'evals/sophie/life-sim/reports');
  const outPath = path.join(reportsDir, 'calibrated-blind-pairwise-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ pairScores, pairwiseResults }, null, 2));

  console.log(`Saved calibrated blind pairwise results to: ${outPath}`);
}

if (require.main === module) {
  runCalibratedBlindPairwise().catch(console.error);
}
