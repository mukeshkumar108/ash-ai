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

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const PINNED_OPENAI_PROVIDER_ROUTING = {
  only: ['openai'],
  allow_fallbacks: true,
  require_parameters: true,
} as const;

// Venice API — OpenAI-compatible, Chat Completions endpoint
// Wraps fetch to:
// 1. Inject venice_parameters to suppress Venice's default system prompts
// 2. Patch streaming chunks to add "role":"assistant" (Venice omits it, SDK requires it)
const venice = process.env.VENICE_API_KEY
  ? createOpenRouter({
      baseURL: 'https://api.venice.ai/api/v1',
      apiKey: process.env.VENICE_API_KEY,
      fetch: async (url: RequestInfo, init?: RequestInit) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body as string);
            if (!body.venice_parameters) {
              body.venice_parameters = { include_venice_system_prompt: false };
            }
            init.body = JSON.stringify(body);
          } catch {}
        }
        const response = await fetch(url, init);
        if (!response.ok || !response.body) return response;
        if (
          !response.headers.get('content-type')?.includes('text/event-stream')
        )
          return response;
        const body = response.clone().body;
        if (!body) return response;
        const decoder = new TextDecoder();
        let firstDeltaPatched = false;
        const transform = new TransformStream({
          transform(chunk, controller) {
            const text = decoder.decode(chunk, { stream: true });
            if (!firstDeltaPatched && text.includes('"delta":{')) {
              const patched = text.replace(
                /"delta":\{/g,
                '"delta":{"role":"assistant",',
              );
              firstDeltaPatched = true;
              controller.enqueue(new TextEncoder().encode(patched));
            } else {
              controller.enqueue(chunk);
            }
          },
        });
        return new Response(body.pipeThrough(transform), response);
      },
    } as any)
  : null;

// NanoGPT API — OpenAI-compatible
const nanoGPT =
  process.env.NANO_API_KEY && process.env.NANOGPT_ENABLED !== 'false'
    ? createOpenRouter({
        baseURL: 'https://nano-gpt.com/api/v1',
        apiKey: process.env.NANO_API_KEY,
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
        // Chat models — NanoGPT (if available), else OpenRouter
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
  // Route to NanoGPT if configured and model is a NanoGPT model
  if (nanoGPT && NANOGPT_MODEL_IDS.has(modelId)) {
    return nanoGPT(modelId) as any;
  }
  // Fallback: if venice is configured and this isn't an internal alias, route to venice
  if (venice && !INTERNAL_ALIASES.has(modelId)) {
    return venice(modelId) as any;
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
