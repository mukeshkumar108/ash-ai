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
  'google/gemini-2.5-flash',
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'mistralai/mistral-large-2411',
  'anthropic/claude-3.5-haiku',
  'zhipuai/glm-4-flash',
  'bigcode/starcoder2-15b',
];

async function main() {
  console.log('=== PREFLIGHTING ADDITIONAL MODEL CANDIDATES ===\n');

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
