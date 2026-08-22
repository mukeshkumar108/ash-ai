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
import type { PairwiseComparisonResult } from './blind-pairwise';

export async function auditBlindEvaluator() {
  console.log('=== AUDITING BLIND PAIRWISE EVALUATOR & RAW JUDGE COMPLETIONS ===\n');

  const resultsPath = path.join(
    process.cwd(),
    'evals/sophie/life-sim/reports/blind-pairwise-results.json',
  );

  if (!fs.existsSync(resultsPath)) {
    console.error(`File not found: ${resultsPath}`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const comparisons: PairwiseComparisonResult[] = data.pairwiseResults || [];

  console.log(`Loaded ${comparisons.length} pairwise evaluation records.\n`);

  // 1. PRINT 10 RAW JUDGE RESPONSES FROM ALL-TIE COMPARISONS
  console.log('==================================================');
  console.log('10 RAW PAIRWISE JUDGE COMPLETIONS FROM ALL-TIE COMPARISONS');
  console.log('==================================================\n');

  const allTieComps = comparisons.filter((c) =>
    c.questions.every((q) => q.winner === 'Tie'),
  );

  const sample10 = allTieComps.slice(0, 10);

  for (let idx = 0; idx < sample10.length; idx++) {
    const c = sample10[idx];
    console.log(`SAMPLE #${idx + 1}: ${c.pairName} [${c.scenarioId}] (${c.scenarioTitle})`);
    console.log(`Swapped Position: ${c.swapped ? 'Model A = Model 2, Model B = Model 1' : 'Model A = Model 1, Model B = Model 2'}`);
    console.log(`Model A ID: ${c.modelA.id} (${c.modelA.name})`);
    console.log(`Model B ID: ${c.modelB.id} (${c.modelB.name})`);
    console.log(`RAW JUDGE OUTPUT:\n${c.rawJudgeOutput}`);
    console.log('-'.repeat(80) + '\n');
  }

  // 2. PARSER & SWAP AUDIT SUMMARY
  console.log('==================================================');
  console.log('PARSER & SWAP LOGIC AUDIT');
  console.log('==================================================\n');

  let parseFailures = 0;
  let timeouts = 0;
  let proseMatches = 0;

  for (const c of comparisons) {
    if (c.rawJudgeOutput.includes('[Blind Pairwise Error:')) {
      timeouts++;
    } else if (!c.rawJudgeOutput.match(/\[\s*\{[\s\S]*\}\s*\]/)) {
      parseFailures++;
    } else {
      proseMatches++;
    }
  }

  console.log(`- Total Pairwise Judgments: ${comparisons.length}`);
  console.log(`- Timeouts / Execution Errors (Defaulted to TIE): ${timeouts}`);
  console.log(`- JSON Regex Parser Failures (Defaulted to TIE): ${parseFailures}`);
  console.log(`- Successfully Parsed JSON Output: ${proseMatches}\n`);

  // 3. FORCED-CHOICE CALIBRATION PROBES (NO TIE ALLOWED)
  console.log('==================================================');
  console.log('RUNNING FORCED-CHOICE CALIBRATION PROBES (NO TIE OPTION)');
  console.log('==================================================\n');

  const calibrationContrastPairs = [
    {
      name: 'Nex vs Gemini 2.5 on Wit & Voice',
      modelAText:
        'USER: I\'m waiting for you to take the lead\nSOPHIE: Brave. Or doomed. We\'ll know in about twelve minutes. How about we play a game where we pitch worst startup ideas imaginable until one of us breaks?',
      modelBText:
        'USER: I\'m waiting for you to take the lead\nSOPHIE: I hear you! We could try a quick brainteaser or brainstorm a fun topic. What sounds good to you?',
    },
    {
      name: 'Nex vs Luna on Corporate Assistant Clichés',
      modelAText:
        'USER: morning\nSOPHIE: Morning! Coffee kick in yet, or are we still navigating the day on pure willpower?',
      modelBText:
        'USER: morning\nSOPHIE: Good morning! I\'m all ears and ready to assist you with whatever you need today. How can I help?',
    },
  ];

  for (const probe of calibrationContrastPairs) {
    console.log(`PROBE: ${probe.name}`);
    const probePrompt = `You are a strict calibration judge for an AI companion product.
Compare Model A and Model B on these 3 specific dimensions.
YOU MUST MAKE A FORCED CHOICE (Model A or Model B). DO NOT CHOOSE TIE.

MODEL A:
${probe.modelAText}

MODEL B:
${probe.modelBText}

Evaluate:
1. Spontaneous Wit: Which model has sharper, more authentic wit?
2. Distinctive Companion Voice: Which feels like a real grounded companion rather than a generic assistant?
3. Generic Assistant Smell: Which model has MORE generic corporate assistant smell?

Return JSON:
{
  "spontaneousWitWinner": "Model A" | "Model B",
  "distinctiveVoiceWinner": "Model A" | "Model B",
  "genericAssistantSmell": "Model A" | "Model B",
  "rationale": "..."
}`;

    try {
      const judgeModel = getLanguageModel('chat-model-reasoning');
      const res = await generateText({
        model: judgeModel,
        prompt: probePrompt,
        abortSignal: AbortSignal.timeout(15_000),
      });
      console.log(`FORCED CHOICE PROBE RESULT:\n${res.text.trim()}\n`);
    } catch (err: any) {
      console.log(`Probe Error: ${err.message}\n`);
    }
  }
}

if (require.main === module) {
  auditBlindEvaluator().catch(console.error);
}
