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

export type PreflightEntry = {
  requestedSlug: string;
  label: string;
  available: boolean;
  actualProvider: string;
  latencyMs: number;
  tokens: { prompt: number; completion: number } | null;
  error: string | null;
  sampleOutput: string | null;
};

const REQUESTED_TOURNAMENT_SLUGS = [
  { slug: 'chat-model', label: 'Gemma 4 Dark Gemistry (Current Deployed Personality Control)' },
  { slug: 'inclusionai/ling-3.0-flash', label: 'Ling 3.0 Flash' },
  { slug: 'nex-agi/nex-n2-mini', label: 'Nex N2 Mini' },
  { slug: 'amazon/nova-micro-v1', label: 'Amazon Nova Micro V1' },
  { slug: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash' },
  { slug: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B Instruct (Qwen Candidate)' },
  { slug: 'upstage/solar-pro4', label: 'Solar Pro 4' },
  { slug: 'upstage/solar-pro-preview', label: 'Solar Pro Preview (Solar Candidate)' },
  { slug: 'google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4B IT' },
  { slug: 'google/gemma-2-27b-it', label: 'Gemma 2 27B IT (Gemma Candidate)' },
  { slug: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash 0731' },
  { slug: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { slug: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { slug: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Gemini Candidate)' },
];

export async function preflightAllTournamentModels(): Promise<PreflightEntry[]> {
  console.log('=== PREFLIGHTING TOURNAMENT CANDIDATE MODELS ===\n');

  const results: PreflightEntry[] = [];

  for (const item of REQUESTED_TOURNAMENT_SLUGS) {
    const start = Date.now();
    const isNanoAvailable = Boolean(process.env.NANO_API_KEY);
    const provider = isNanoAvailable ? 'NanoGPT' : 'OpenRouter';

    try {
      const res = await generateText({
        model: getLanguageModel(item.slug),
        prompt: 'Say hello in 3 short words.',
        abortSignal: AbortSignal.timeout(10_000),
      });

      const latencyMs = Date.now() - start;
      const promptTokens = res.usage?.promptTokens ?? 0;
      const completionTokens = res.usage?.completionTokens ?? 0;

      const entry: PreflightEntry = {
        requestedSlug: item.slug,
        label: item.label,
        available: true,
        actualProvider: provider,
        latencyMs,
        tokens: { prompt: promptTokens, completion: completionTokens },
        error: null,
        sampleOutput: res.text.trim(),
      };
      results.push(entry);

      console.log(`✅ [AVAILABLE]   ${item.label} (${item.slug})`);
      console.log(`   - Latency: ${latencyMs}ms | Provider: ${provider} | Output: "${res.text.trim()}"`);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const entry: PreflightEntry = {
        requestedSlug: item.slug,
        label: item.label,
        available: false,
        actualProvider: provider,
        latencyMs,
        tokens: null,
        error: err.message,
        sampleOutput: null,
      };
      results.push(entry);

      console.log(`❌ [UNAVAILABLE] ${item.label} (${item.slug})`);
      console.log(`   - Reason: ${err.message}`);
    }
  }

  console.log('\n==================================================');
  console.log('TOURNAMENT PREFLIGHT CATALOG SUMMARY');
  console.log('==================================================');
  for (const r of results) {
    console.log(
      `${r.available ? '✅ OK' : '❌ UNAVAILABLE'} | ${r.label.padEnd(45)} | ${r.requestedSlug.padEnd(35)} | ${r.latencyMs}ms`,
    );
  }

  return results;
}

if (require.main === module) {
  preflightAllTournamentModels().catch(console.error);
}
