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

const REQUESTED_SLUGS = [
  { id: 'chat-model', label: 'Gemma 4 Dark Gemistry (Current Baseline)' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash 0731' },
  { id: 'zai-org/glm-5.2', label: 'GLM 5.2' },
  { id: 'nex-agi/nex-n2-mini', label: 'Nex N2 Mini' },
  { id: 'nvidia/nemotron-3.5-lightning', label: 'Nemotron 3.5 Lightning' },
  { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
  { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Sonnet Reference' },
];

export type PreflightResult = {
  id: string;
  label: string;
  available: boolean;
  provider: string;
  latencyMs: number;
  tokens: { prompt: number; completion: number } | null;
  error: string | null;
  sampleOutput: string | null;
};

async function main() {
  console.log('=== PREFLIGHTING EXPANDED STAGE 2A MODEL MATRIX SLUGS ===\n');

  const results: PreflightResult[] = [];

  for (const item of REQUESTED_SLUGS) {
    const start = Date.now();
    const isNanoAvailable = Boolean(process.env.NANO_API_KEY);
    const provider = isNanoAvailable ? 'NanoGPT' : 'OpenRouter';

    try {
      const res = await generateText({
        model: getLanguageModel(item.id),
        prompt: 'Say hello in 3 short words.',
        abortSignal: AbortSignal.timeout(10_000),
      });

      const latencyMs = Date.now() - start;
      const promptTokens = res.usage?.promptTokens ?? 0;
      const completionTokens = res.usage?.completionTokens ?? 0;

      results.push({
        id: item.id,
        label: item.label,
        available: true,
        provider,
        latencyMs,
        tokens: { prompt: promptTokens, completion: completionTokens },
        error: null,
        sampleOutput: res.text.trim(),
      });

      console.log(`✅ [AVAILABLE]   ${item.label} (${item.id})`);
      console.log(`   - Latency: ${latencyMs}ms | Provider: ${provider}`);
      console.log(`   - Output: "${res.text.trim()}"`);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      results.push({
        id: item.id,
        label: item.label,
        available: false,
        provider,
        latencyMs,
        tokens: null,
        error: err.message,
        sampleOutput: null,
      });

      console.log(`❌ [UNAVAILABLE] ${item.label} (${item.id})`);
      console.log(`   - Reason: ${err.message}\n`);
    }
  }

  console.log('\n==================================================');
  console.log('PREFLIGHT SUMMARY TABLE');
  console.log('==================================================');
  for (const r of results) {
    console.log(
      `${r.available ? '✅ OK' : '❌ UNAVAILABLE'} | ${r.label.padEnd(40)} | ${r.id.padEnd(35)} | ${r.latencyMs}ms`,
    );
  }
}

main().catch(console.error);
