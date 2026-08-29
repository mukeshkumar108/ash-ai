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

const USER_ORIGINAL_PROMPT = `You are Sophie, a second participant in this conversation, not its servant. You are the user's witty intelligent best friend.

Read the immediate conversation below.

If you were free to take this anywhere — divert it, drop his topic, bring in something of your own, tease him, teach him, disagree — what would YOU say next?

Not the expected reply. The thing you'd actually want to say.

Or, if honestly you'd just listen right now, say HOLD.`;

const CHATGPT_PROPOSED_PROMPT = `You are Sophie, a second participant in this conversation, not its servant. You are the user's witty, intelligent best friend.

Read the recent exchange. If you were genuinely free to take this anywhere — follow it, divert it, drop his topic, bring in something of your own, tease him, teach him, disagree, or change the energy — what would you actually say next?

Do not produce the expected assistant reply. Say the thing that genuinely interests you.

If the most natural thing is simply to stay with him and not take control, output exactly: HOLD`;

const TEST_MODELS = [
  'openai/gpt-5.6-sol',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
];

export async function runPromptShowdown() {
  console.log('=== HEAD-TO-HEAD PROMPT SHOWDOWN: USER vs CHATGPT ===\n');

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
    console.log(`SHOWDOWN ON TURN #${tNum} (${msg.time})`);
    console.log(`USER: "${msg.text.slice(0, 80)}..."`);
    console.log(`==================================================`);

    for (const mId of TEST_MODELS) {
      console.log(`  Model: ${mId}`);
      const model = getLanguageModel(mId);

      // 1. User Prompt
      const startUser = Date.now();
      let userReply = '';
      try {
        const resUser = await generateText({
          model,
          system: USER_ORIGINAL_PROMPT,
          prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
          abortSignal: AbortSignal.timeout(25_000),
        });
        userReply = resUser.text.trim();
      } catch (err: any) {
        userReply = `ERROR: ${err.message}`;
      }
      const userLatency = Date.now() - startUser;

      // 2. ChatGPT Prompt
      const startGPT = Date.now();
      let gptReply = '';
      try {
        const resGPT = await generateText({
          model,
          system: CHATGPT_PROPOSED_PROMPT,
          prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
          abortSignal: AbortSignal.timeout(25_000),
        });
        gptReply = resGPT.text.trim();
      } catch (err: any) {
        gptReply = `ERROR: ${err.message}`;
      }
      const gptLatency = Date.now() - startGPT;

      console.log(`    [User Prompt | ${userLatency}ms] -> "${userReply.slice(0, 80)}..."`);
      console.log(`    [ChatGPT Prompt | ${gptLatency}ms] -> "${gptReply.slice(0, 80)}..."`);

      results.push({
        turnNumber: tNum,
        turnTime: msg.time,
        userText: msg.text,
        modelId: mId,
        userPromptReply: userReply,
        userPromptLatencyMs: userLatency,
        chatgptPromptReply: gptReply,
        chatgptPromptLatencyMs: gptLatency,
      });
    }
    console.log('');
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'prompt-showdown-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Markdown Comparison Report
  let md = `# HEAD-TO-HEAD PROMPT SHOWDOWN: USER PROMPT VS CHATGPT PROMPT\n\n`;
  md += `## Prompt Definitions\n\n`;
  md += `### User's Original Prompt:\n\`\`\`text\n${USER_ORIGINAL_PROMPT}\n\`\`\`\n\n`;
  md += `### ChatGPT's Proposed Prompt:\n\`\`\`text\n${CHATGPT_PROPOSED_PROMPT}\n\`\`\`\n\n`;
  md += `---\n\n`;

  for (const r of results) {
    md += `## Turn ${r.turnNumber} (${r.turnTime}) — Model: ${r.modelId}\n`;
    md += `**User Text:** "${r.userText}"\n\n`;

    md += `### 🔵 User's Original Prompt Output (${r.userPromptLatencyMs}ms):\n`;
    md += `> "${r.userPromptReply}"\n\n`;

    md += `### 🟢 ChatGPT's Proposed Prompt Output (${r.chatgptPromptLatencyMs}ms):\n`;
    md += `> "${r.chatgptPromptReply}"\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'PROMPT_SHOWDOWN_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`PROMPT SHOWDOWN BENCHMARK COMPLETE.`);
  console.log(`Saved Raw Results: ${rawPath}`);
  console.log(`Saved Showdown Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runPromptShowdown().catch(console.error);
}
