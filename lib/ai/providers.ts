import {
  customProvider,
  extractReasoningMiddleware,
  wrapLanguageModel,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import {
  artifactModel,
  chatModel,
  reasoningModel,
  titleModel,
} from './models.test';
import { isTestEnvironment } from '../constants';

// Every request this app makes carries its own name so provider activity can be told apart from the Runtime's, Cortex's and RPD2's calls on shared accounts.
const attributionHeaders = {
  'HTTP-Referer': 'https://sophie.app',
  'X-Title': `sophie-bff:${process.env.VERCEL_ENV ?? 'local'}`,
};

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: attributionHeaders,
});

export const PINNED_OPENAI_PROVIDER_ROUTING = {
  only: ['openai'],
  allow_fallbacks: true,
  require_parameters: true,
} as const;

// Providers are NanoGPT or OpenRouter only: both are visible to us (account activity and the Runtime's call ledger). No third provider is reachable by configuration.
// NanoGPT API — OpenAI-compatible
const nanoGPT =
  process.env.NANO_API_KEY && process.env.NANOGPT_ENABLED === 'true'
    ? createOpenRouter({
        baseURL: 'https://nano-gpt.com/api/v1',
        apiKey: process.env.NANO_API_KEY,
        headers: attributionHeaders,
      } as any)
    : null;

const summarizerModelId =
  process.env.SUMMARIZER_MODEL ?? 'deepseek/deepseek-v3.2';
const summarizerFallbackId =
  process.env.SUMMARIZER_FALLBACK ?? 'google/gemma-4-31b-it';
const stateJudgeModelId =
  process.env.STATE_JUDGE_MODEL ?? 'google/gemma-3-12b-it';
const activeStateModelId =
  process.env.ACTIVE_STATE_MODEL ?? 'google/gemma-3-12b-it';
const continuityModelId =
  process.env.CONTINUITY_MODEL ?? 'google/gemma-3-12b-it';

export const myProvider = isTestEnvironment
  ? customProvider({
      languageModels: {
        'chat-model': chatModel,
        'chat-model-fallback': reasoningModel,
        'chat-model-reasoning': reasoningModel,
        'title-model': titleModel,
        'artifact-model': artifactModel,
        'summarizer-model': chatModel,
        'summarizer-model-fallback': chatModel,
        'scene-model': chatModel,
        'scene-model-fallback': reasoningModel,
        'state-judge-model': titleModel,
        'active-state-model': reasoningModel,
        'continuity-model': titleModel,
      },
    })
  : customProvider({
      languageModels: {
        // Chat models — canonical OpenRouter; NanoGPT is explicit opt-in.
        'chat-model': nanoGPT
          ? (nanoGPT('Gemma-4-31B-Dark-Gemistry') as any)
          : (openrouter('deepseek/deepseek-v4-flash') as any),
        'chat-model-fallback': nanoGPT
          ? (nanoGPT('deepseek/deepseek-v4-flash') as any)
          : (openrouter('google/gemini-3.5-flash-lite') as any),
        'chat-model-reasoning': nanoGPT
          ? (nanoGPT('deepseek/deepseek-v4-flash') as any)
          : (wrapLanguageModel({
              model: openrouter('meta-llama/llama-4-maverick') as any,
              middleware: extractReasoningMiddleware({ tagName: 'think' }),
            }) as any),
        // Scene directive models — NanoGPT first, then OpenRouter
        'scene-model': nanoGPT
          ? (nanoGPT('Qwen3.5-27B-earica-Derestricted') as any)
          : (openrouter('sao10k/l3-lunaris-8b') as any),
        'scene-model-fallback': nanoGPT
          ? (nanoGPT('Gemma-4-31B-Dark-Gemistry') as any)
          : (openrouter('deepseek/deepseek-v3.2-exp') as any),
        // Background models — OpenRouter (unchanged)
        'title-model': openrouter('meta-llama/llama-3.2-3b-instruct') as any,
        'artifact-model': openrouter('deepseek/deepseek-chat-v3-0324') as any,
        'summarizer-model': openrouter(summarizerModelId) as any,
        'summarizer-model-fallback': openrouter(summarizerFallbackId) as any,
        'state-judge-model': openrouter(stateJudgeModelId) as any,
        'active-state-model': openrouter(activeStateModelId) as any,
        'continuity-model': openrouter(continuityModelId) as any,
      },
      imageModels: {
        'small-model': openrouter('openai/gpt-4o-mini') as any,
      },
    });

const INTERNAL_ALIASES = new Set([
  'chat-model',
  'chat-model-fallback',
  'chat-model-reasoning',
  'title-model',
  'artifact-model',
  'summarizer-model',
  'summarizer-model-fallback',
  'scene-model',
  'scene-model-fallback',
  'state-judge-model',
  'active-state-model',
  'continuity-model',
  'small-model',
]);

const NANOGPT_MODEL_IDS = new Set([
  'nvidia/nemotron-3.5-lightning:thinking',
  'deepseek/deepseek-v4-flash-0731:thinking',
  'inclusionai/ling-3.0-flash:thinking',
  'zai-org/glm-5.2:thinking',
  'xiaomi/mimo-v2.5-pro-crof:thinking',
  'longcat-2.0:thinking',
  'nex-agi/nex-n2-mini',
]);

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment) return chatModel;
  if (
    modelId === 'google/gemini-3.7-flash' ||
    modelId === 'nex-agi/nex-n2-mini' ||
    modelId === 'anthropic/claude-sonnet-5'
  ) {
    return openrouter(modelId) as any;
  }
  // Route to NanoGPT if configured and model is a NanoGPT model
  if (nanoGPT && NANOGPT_MODEL_IDS.has(modelId)) {
    return nanoGPT(modelId) as any;
  }
  // Fallback to OpenRouter for remaining internal aliases and background models
  if (modelId.includes('/') || modelId.includes(':')) {
    return openrouter(modelId) as any;
  }
  return myProvider.languageModel(modelId as any);
}

export function getPinnedOpenAIModel(modelId: string) {
  if (isTestEnvironment) return chatModel;
  return openrouter(modelId, {
    extraBody: {
      provider: {
        ...PINNED_OPENAI_PROVIDER_ROUTING,
      },
    },
  }) as any;
}
