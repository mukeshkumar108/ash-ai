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
import { BURWELL_WALK_MESSAGES } from './stage-a-model-benchmark';

const MODE_A_DIRECT_PROMPT = `You are Sophie, a second participant in this conversation, not its servant. You are the user's witty, intelligent best friend.

Read the recent exchange. If you were genuinely free to take this anywhere — follow it, divert it, drop his topic, bring in something of your own, tease him, teach him, disagree, or change the energy — what would you actually say next?

Do not produce the expected assistant reply. Say the thing that genuinely interests you.

If the most natural thing is simply to stay with him and not take control, output exactly: HOLD`;

const MODE_B_INTENT_PROMPT = `You are Sophie's private conversational director.

Read the recent exchange. If you were genuinely free to take this conversation anywhere — follow it, divert it, drop his topic, bring in something of your own, tease him, teach him, disagree, or change the energy — what specific conversational move should Sophie make next?

Do not write a full response. Return ONE short, sharp private instruction describing the exact move (e.g., "Correct Van Allen with a Van Halen joke, then challenge his framing that people are getting stupider: it's a collapse of trust").

If the most natural thing is simply to stay with him and not take control, output exactly: HOLD`;

const COMPOSER_PROMPT = `You are Sophie, a warm, witty, intelligent best friend on a walk with the user.

Execute the following private steering instruction in your authentic voice. Keep it natural and concise (1-3 sentences).`;

const BROAD_MODELS = [
  'google/gemini-3.7-flash',
  'anthropic/claude-haiku-4.5',
  'meta-llama/llama-4-maverick',
  'x-ai/grok-4.3',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
];

export async function runBroadSimplifiedBenchmark() {
  console.log('=== RUNNING BROAD SIMPLIFIED PROMPT BENCHMARK (MODE A vs MODE B) ===\n');

  const targetTurns = [2, 4, 7, 11];
  const userTurnEntries = BURWELL_WALK_MESSAGES.map((m, idx) => ({ msg: m, idx })).filter(
    (item) => item.msg.speaker === 'USER',
  );

  const results: any[] = [];

  for (const tNum of targetTurns) {
    const entry = userTurnEntries[tNum - 1];
    if (!entry) continue;
    const { msg, idx } = entry;

    const contextMsgs = BURWELL_WALK_MESSAGES.slice(Math.max(0, idx - 2), idx + 1);
    const formattedContext = contextMsgs
      .map((m) => `${m.speaker} (${m.time}): "${m.text}"`)
      .join('\n\n');

    console.log(`==================================================`);
    console.log(`EVALUATING TURN #${tNum} (${msg.time})`);
    console.log(`USER: "${msg.text.slice(0, 80)}..."`);
    console.log(`==================================================`);

    for (const mId of BROAD_MODELS) {
      console.log(`\n--- Model: ${mId} ---`);
      const model = getLanguageModel(mId);

      // Mode A: Direct Response
      console.log(`  Running Mode A (Direct Response)...`);
      const startA = Date.now();
      let modeAReply = '';
      try {
        const resA = await generateText({
          model,
          system: MODE_A_DIRECT_PROMPT,
          prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
          abortSignal: AbortSignal.timeout(25_000),
        });
        modeAReply = resA.text.trim();
      } catch (err: any) {
        modeAReply = `ERROR: ${err.message}`;
      }
      const latencyA = Date.now() - startA;
      console.log(`    [Mode A | ${latencyA}ms] -> "${modeAReply.slice(0, 80)}..."`);

      // Mode B: Intent-Only + Composer
      console.log(`  Running Mode B (Intent-Only Steer + Composer)...`);
      const startB = Date.now();
      let modeBIntent = '';
      let modeBComposerReply = '';
      try {
        const resBIntent = await generateText({
          model,
          system: MODE_B_INTENT_PROMPT,
          prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
          abortSignal: AbortSignal.timeout(25_000),
        });
        modeBIntent = resBIntent.text.trim();

        if (modeBIntent.toUpperCase() === 'HOLD') {
          modeBComposerReply = 'HOLD';
        } else {
          const resBComposer = await generateText({
            model,
            system: COMPOSER_PROMPT,
            prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}\n\nPRIVATE STEERING INSTRUCTION:\n"${modeBIntent}"`,
            abortSignal: AbortSignal.timeout(25_000),
          });
          modeBComposerReply = resBComposer.text.trim();
        }
      } catch (err: any) {
        modeBIntent = `ERROR: ${err.message}`;
        modeBComposerReply = `ERROR: ${err.message}`;
      }
      const latencyB = Date.now() - startB;
      console.log(`    [Mode B Intent | ${latencyB}ms] -> Steer: "${modeBIntent.slice(0, 70)}..."`);
      console.log(`    [Mode B Final ] -> Reply: "${modeBComposerReply.slice(0, 80)}..."`);

      results.push({
        turnNumber: tNum,
        turnTime: msg.time,
        userText: msg.text,
        modelId: mId,
        modeADirectReply: modeAReply,
        modeALatencyMs: latencyA,
        modeBIntent,
        modeBComposerReply,
        modeBLatencyMs: latencyB,
      });
    }
    console.log('');
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'simplified-prompt-broad-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Secret Candidate Mapping Key for Blind Rating
  const modelCandidateMap: Record<string, string> = {};
  const shuffled = [...BROAD_MODELS].sort(() => Math.random() - 0.5);
  shuffled.forEach((m, i) => {
    modelCandidateMap[m] = `Candidate ${String.fromCharCode(65 + i)}`;
  });

  const mappingKeyPath = path.join(outDir, 'SIMPLIFIED_BROAD_CANDIDATE_MAPPING.json');
  fs.writeFileSync(mappingKeyPath, JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2));

  // Build Markdown Benchmark Report
  let md = `# SIMPLIFIED PROMPT BROAD MODEL BENCHMARK (MODE A vs MODE B)\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Models Tested:** ${BROAD_MODELS.join(', ')}  \n`;
  md += `**Raw Results JSON:** [\`evals/sophie/behavioral-harness/reports/simplified-prompt-broad-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/simplified-prompt-broad-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    const anonCandidate = modelCandidateMap[r.modelId] || r.modelId;
    md += `## Turn ${r.turnNumber} (${r.turnTime}) — ${anonCandidate}\n`;
    md += `**User Text:** "${r.userText}"\n\n`;

    md += `### 🔵 Mode A: Direct Response (${r.modeALatencyMs}ms)\n`;
    md += `> "${r.modeADirectReply}"\n\n`;

    md += `### 🟢 Mode B: Intent-Only Steer + Composer (${r.modeBLatencyMs}ms)\n`;
    md += `*Private Steer:* "${r.modeBIntent}"  \n`;
    md += `*Final Reply:*  \n> "${r.modeBComposerReply}"\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'SIMPLIFIED_PROMPT_BROAD_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`BROAD SIMPLIFIED BENCHMARK COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`Saved Mapping Key: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runBroadSimplifiedBenchmark().catch(console.error);
}
