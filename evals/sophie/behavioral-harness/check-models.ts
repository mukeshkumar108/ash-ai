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

const REQUESTED_MODELS = [
  'deepseek/deepseek-v4-flash-0731',
  'anthropic/claude-haiku-4.5',
  'meta-llama/llama-3.1-8b-instruct',
  'meta-llama/llama-4-maverick',
  'x-ai/grok-4.3',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
];

async function checkModels() {
  console.log('=== CHECKING REQUESTED MODEL IDS AGAINST PROVIDER ===\n');
  const results: Record<string, { status: 'available' | 'unavailable'; error?: string }> = {};

  for (const modelId of REQUESTED_MODELS) {
    try {
      const model = getLanguageModel(modelId);
      const res = await generateText({
        model,
        prompt: 'Say hello in 1 word.',
        abortSignal: AbortSignal.timeout(8000),
      });
      console.log(`[AVAILABLE] ${modelId} -> "${res.text.trim()}"`);
      results[modelId] = { status: 'available' };
    } catch (err: any) {
      console.log(`[UNAVAILABLE] ${modelId} -> Error: ${err.message}`);
      results[modelId] = { status: 'unavailable', error: err.message };
    }
  }

  console.log('\nModel Status Summary:');
  console.log(JSON.stringify(results, null, 2));
}

checkModels().catch(console.error);
