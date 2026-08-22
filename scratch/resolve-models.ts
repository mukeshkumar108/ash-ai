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

const candidateModelIds = [
  // Primary Aliases
  'chat-model',
  'chat-model-reasoning',
  'nex-agi/nex-n2-mini',

  // DeepSeek Candidates
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',

  // GLM Candidates
  'zhipu/glm-4',
  'thudm/glm-4-9b-chat',
  'zhipuai/glm-4',

  // Nemotron Candidates
  'nvidia/llama-3.1-nemotron-70b-instruct',
  'nvidia/nemotron-4-340b-instruct',
];

async function main() {
  console.log('=== RESOLVING AND PREFLIGHTING TARGET MODEL CATALOG ===\n');

  for (const modelId of candidateModelIds) {
    const start = Date.now();
    try {
      const res = await generateText({
        model: getLanguageModel(modelId),
        prompt: 'Say hi in 3 words.',
        abortSignal: AbortSignal.timeout(6000),
      });
      console.log(`✅ SUCCESS: [${modelId}] (${Date.now() - start}ms) -> "${res.text.trim()}"`);
    } catch (err: any) {
      console.log(`❌ FAILED:  [${modelId}] (${Date.now() - start}ms) -> ${err.message}`);
    }
  }
}

main();
