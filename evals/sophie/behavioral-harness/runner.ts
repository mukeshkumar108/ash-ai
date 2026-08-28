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
import { TEMPORAL_FIXTURES } from './fixtures';
import { compileTemporalPrompt } from './prompts';
import { scoreTemporalTrajectoryWithLLM } from './evaluator';
import type {
  TemporalVariant,
  SyntheticFixture,
  TrajectoryResult,
  TurnExecutionResult,
} from './types';

export const EVAL_MODELS = [
  { id: 'chat-model', name: 'Deployed Gemma Baseline (Gemma 4 Control)' },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
  { id: 'nex-agi/nex-n2-mini', name: 'Nex N2 Mini' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna' },
];

export async function executeTemporalTurn({
  fixture,
  turnIndex,
  history,
  variant,
  modelId,
}: {
  fixture: SyntheticFixture;
  turnIndex: number;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  variant: TemporalVariant;
  modelId: string;
}): Promise<TurnExecutionResult> {
  const currentTurn = fixture.turns[turnIndex];
  const userText = currentTurn.userText;
  const start = Date.now();

  const systemPrompt = compileTemporalPrompt({
    fixture,
    variant,
    turnIndex,
    history,
  });

  const model = getLanguageModel(modelId);
  const messagesToSend: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    { role: 'user', content: userText },
  ];

  let assistantOutput = 'Morning!';
  try {
    const res = await generateText({
      model,
      system: systemPrompt,
      messages: messagesToSend,
      abortSignal: AbortSignal.timeout(20_000),
    });
    assistantOutput = res.text.trim();
  } catch (err: any) {
    assistantOutput = `[Execution Fallback: ${err.message}]`;
  }

  return {
    turnIndex,
    userText,
    assistantOutput,
    latencyMs: Date.now() - start,
    modelId,
    variant,
  };
}

export async function runTemporalTrajectory({
  fixture,
  variant,
  modelId,
}: {
  fixture: SyntheticFixture;
  variant: TemporalVariant;
  modelId: string;
}): Promise<TrajectoryResult> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const turnResults: TurnExecutionResult[] = [];

  for (let idx = 0; idx < fixture.turns.length; idx++) {
    const currentTurn = fixture.turns[idx];

    const turnRes = await executeTemporalTurn({
      fixture,
      turnIndex: idx,
      history,
      variant,
      modelId,
    });

    turnResults.push(turnRes);

    history.push({ role: 'user', content: currentTurn.userText });
    history.push({ role: 'assistant', content: turnRes.assistantOutput });
  }

  const baseResult: TrajectoryResult = {
    fixtureId: fixture.id,
    fixtureTitle: fixture.title,
    variant,
    modelId,
    turns: turnResults,
  };

  const scored = await scoreTemporalTrajectoryWithLLM(baseResult);
  baseResult.scores = scored.scores;
  baseResult.objectiveMetrics = scored.objectiveMetrics;
  baseResult.judgeRationale = scored.judgeRationale;

  return baseResult;
}

export async function runTemporalHarnessBatch() {
  console.log('=== RUNNING TEMPORAL RHYTHM & RELATIONAL ARRIVAL EXPERIMENT ===\n');

  const allResults: TrajectoryResult[] = [];
  const variants: TemporalVariant[] = ['variant_a', 'variant_b', 'variant_c', 'variant_d'];

  const workItems: Array<{ fixture: SyntheticFixture; variant: TemporalVariant; modelId: string }> = [];

  for (const fixture of TEMPORAL_FIXTURES) {
    for (const v of variants) {
      for (const mDef of EVAL_MODELS) {
        workItems.push({ fixture, variant: v, modelId: mDef.id });
      }
    }
  }

  console.log(`Fixtures: ${TEMPORAL_FIXTURES.length}`);
  console.log(`Variants: ${variants.join(', ')}`);
  console.log(`Models: ${EVAL_MODELS.map((m) => m.id).join(', ')}`);
  console.log(`Total Trajectory Items: ${workItems.length}`);
  console.log('Running in controlled parallel batches of 30...\n');

  const BATCH_SIZE = 30;
  for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
    const batch = workItems.slice(i, i + BATCH_SIZE);
    console.log(`Processing Batch ${Math.floor(i / BATCH_SIZE) + 1} / ${Math.ceil(workItems.length / BATCH_SIZE)}...`);

    const batchResults = await Promise.all(
      batch.map((item) =>
        runTemporalTrajectory({
          fixture: item.fixture,
          variant: item.variant,
          modelId: item.modelId,
        }),
      ),
    );

    allResults.push(...batchResults);
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'temporal-rhythm-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), results: allResults }, null, 2));

  console.log(`\n==================================================`);
  console.log(`TEMPORAL EXPERIMENT COMPLETE. Saved results to:\n${outPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runTemporalHarnessBatch().catch(console.error);
}
