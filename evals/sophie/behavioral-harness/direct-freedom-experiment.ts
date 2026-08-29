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
import { BURWELL_WALK_MESSAGES, SingleMessage } from './stage-a-model-benchmark';

const PROPOSED_FREEDOM_SYSTEM_PROMPT = `You are Sophie, a second participant in this conversation, not its servant. You are the user's witty intelligent best friend.

Read the immediate conversation below.

If you were free to take this anywhere — divert it, drop his topic, bring in something of your own, tease him, teach him, disagree — what would YOU say next?

Not the expected reply. The thing you'd actually want to say.

Or, if honestly you'd just listen right now, say HOLD.`;

const TEST_MODELS = [
  'openai/gpt-5.6-sol',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
];

export async function runDirectFreedomTest() {
  console.log('=== RUNNING DIRECT CONVERSATIONAL FREEDOM PROMPT EXPERIMENT ===\n');

  // Select key causal turns: Turn 2 (Walk invite), Turn 4 (Sunset description), Turn 7 (Finger clock), Turn 11 (Conspiracies)
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

    for (const mId of TEST_MODELS) {
      console.log(`  Testing Model: ${mId}...`);
      const start = Date.now();
      const model = getLanguageModel(mId);

      try {
        const res = await generateText({
          model,
          system: PROPOSED_FREEDOM_SYSTEM_PROMPT,
          prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
          abortSignal: AbortSignal.timeout(25_000),
        });
        const latencyMs = Date.now() - start;
        const reply = res.text.trim();
        console.log(`    [${latencyMs}ms] -> "${reply.slice(0, 90)}..."`);

        results.push({
          turnNumber: tNum,
          turnTime: msg.time,
          userText: msg.text,
          modelId: mId,
          reply,
          latencyMs,
        });
      } catch (err: any) {
        console.log(`    ERROR: ${err.message}`);
        results.push({
          turnNumber: tNum,
          turnTime: msg.time,
          userText: msg.text,
          modelId: mId,
          error: err.message,
        });
      }
    }
    console.log('');
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'direct-freedom-prompt-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Markdown Report
  let md = `# DIRECT CONVERSATIONAL FREEDOM PROMPT EXPERIMENT REPORT\n\n`;
  md += `**Prompt Tested:**\n`;
  md += `\`\`\`text\n${PROPOSED_FREEDOM_SYSTEM_PROMPT}\n\`\`\`\n\n`;
  md += `---\n\n`;

  for (const r of results) {
    md += `## Turn ${r.turnNumber} (${r.turnTime}) — ${r.modelId}\n`;
    md += `**User Text:** "${r.userText}"\n\n`;
    if (r.error) {
      md += `*Error: ${r.error}*\n\n`;
    } else {
      md += `**Sophie Direct Reply:**\n> "${r.reply}"\n\n`;
      md += `*Latency:* ${r.latencyMs}ms  \n`;
      md += `*Is HOLD?:* ${r.reply.toUpperCase().includes('HOLD') ? 'YES' : 'NO'}\n\n`;
    }
    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'DIRECT_FREEDOM_PROMPT_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`DIRECT FREEDOM PROMPT EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runDirectFreedomTest().catch(console.error);
}
