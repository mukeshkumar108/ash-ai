import 'server-only';

import { convertToModelMessages, generateText, stepCountIs } from 'ai';

import { outputTokenBudget } from '@/lib/agent/ash-agent';
import type { TurnPacket } from '@/lib/agent/turn-runtime';
import { getLanguageModel, getPinnedOpenAIModel } from '@/lib/ai/providers';
import { buildWeatherTool } from '@/lib/agent/weather';
import type { ResearchTrace } from '@/lib/types';

export type DirectReplyResult = {
  text: string;
  finishReason: string;
  modelId: string;
  usedFallback: boolean;
};

export type LiveDataReplyResult = DirectReplyResult & {
  trace: ResearchTrace;
  resolvedLocation?: string;
};

export class EmptyModelResponseError extends Error {
  constructor(modelId: string) {
    super(`Model returned no visible text: ${modelId}`);
    this.name = 'EmptyModelResponseError';
  }
}

export function isRetryableModelError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    name?: string;
    statusCode?: number;
    message?: string;
    cause?: unknown;
  };
  if (candidate.name === 'AbortError') return false;
  if (typeof candidate.statusCode === 'number') {
    return (
      candidate.statusCode === 408 ||
      candidate.statusCode === 409 ||
      candidate.statusCode === 429 ||
      candidate.statusCode >= 500
    );
  }
  if (candidate.cause && isRetryableModelError(candidate.cause)) return true;
  return (
    candidate.name === 'AI_APICallError' ||
    /(?:no model available|provider|rate.?limit|overload|unavailable|timeout)/iu.test(
      candidate.message ?? '',
    )
  );
}

type ReplyGenerator = (
  modelId: string,
  signal: AbortSignal,
) => Promise<{ text: string; finishReason: string }>;

export async function executeDirectReply({
  packet,
  signal,
  generate = (modelId, abortSignal) =>
    generateText({
      model: modelId.startsWith('openai/gpt-5.6-')
        ? getPinnedOpenAIModel(modelId)
        : getLanguageModel(modelId),
      system: packet.systemPrompt,
      messages: convertToModelMessages(packet.messages),
      // A higher ceiling prevents cut-off answers; the prompt still asks for
      // conversational brevity, so normal replies stop well before this cap.
      maxOutputTokens: outputTokenBudget('light'),
      abortSignal,
    }),
}: {
  packet: TurnPacket;
  signal: AbortSignal;
  generate?: ReplyGenerator;
}): Promise<DirectReplyResult> {
  const fallbackModelId =
    process.env.SOPHIE_REPLY_FALLBACK_MODEL?.trim() || 'chat-model';
  const modelIds = [
    packet.decision.modelId,
    packet.decision.fallbackModelId,
    fallbackModelId,
  ].filter((modelId, index, all) => all.indexOf(modelId) === index);

  let lastError: unknown;
  for (const [index, modelId] of modelIds.entries()) {
    try {
      const result = await generate(modelId, signal);
      const text = typeof result.text === 'string' ? result.text : '';
      if (!text.trim()) {
        throw new EmptyModelResponseError(modelId);
      }
      return {
        text,
        finishReason: result.finishReason,
        modelId,
        usedFallback: index > 0,
      };
    } catch (error) {
      lastError = error;
      if (
        signal.aborted ||
        (!(error instanceof EmptyModelResponseError) &&
          !isRetryableModelError(error))
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new EmptyModelResponseError(packet.decision.modelId);
}

export async function executeLiveDataReply({
  packet,
  signal,
}: {
  packet: TurnPacket;
  signal: AbortSignal;
}): Promise<LiveDataReplyResult> {
  const fallbackModelId =
    process.env.SOPHIE_REPLY_FALLBACK_MODEL?.trim() || 'chat-model';
  const modelIds = [
    packet.decision.modelId,
    packet.decision.fallbackModelId,
    fallbackModelId,
  ].filter((modelId, index, all) => all.indexOf(modelId) === index);

  let lastError: unknown;
  for (const [index, modelId] of modelIds.entries()) {
    const activities: ResearchTrace['activities'] = [];
    let toolFailure: string | undefined;
    let resolvedLocation: string | undefined;
    try {
      const weatherTool = buildWeatherTool({
        defaultLocation: packet.event.ambient.userLocation,
        onResult: ({ location, ok, error }) => {
          if (!ok) toolFailure = error;
          if (ok) resolvedLocation = location;
          activities.push({
            kind: 'weather',
            query: location || 'saved default location',
            resultCount: ok ? 1 : 0,
            status: ok ? 'success' : 'failed',
            failure: ok
              ? undefined
              : error?.includes('too long')
                ? 'timeout'
                : 'unavailable',
          });
        },
      });
      const model = modelId.startsWith('openai/gpt-5.6-')
        ? getPinnedOpenAIModel(modelId)
        : getLanguageModel(modelId);
      const result = await generateText({
        model,
        system: `${packet.systemPrompt}

[LIVE WEATHER TURN]
The answer materially depends on current local weather or daylight. Call get_weather exactly once before answering. Use an explicit location from the conversation when available; otherwise omit it so the saved default is used. Base every temperature, condition, forecast, sunrise, and sunset claim only on the returned packet. If the lookup fails, say so briefly and do not guess or use remembered figures. Translate the data into practical, natural advice in Sophie's voice.`,
        messages: convertToModelMessages(packet.messages),
        tools: { get_weather: weatherTool },
        toolChoice: 'auto',
        stopWhen: stepCountIs(3),
        maxOutputTokens: outputTokenBudget('light'),
        abortSignal: signal,
      });
      const text = typeof result.text === 'string' ? result.text : '';
      if (!text.trim() || activities.length === 0) {
        throw new EmptyModelResponseError(modelId);
      }
      const weatherSucceeded = activities.some(
        (activity) =>
          activity.kind === 'weather' && activity.status !== 'failed',
      );
      return {
        text: weatherSucceeded
          ? text
          : toolFailure ||
            "I couldn't check the live weather just now, so I don't want to guess.",
        finishReason: result.finishReason,
        modelId,
        usedFallback: index > 0,
        trace: {
          activities,
          sources: weatherSucceeded
            ? [
                {
                  title: 'Weather data by Open-Meteo.com (CC BY 4.0)',
                  url: 'https://open-meteo.com/',
                  hostname: 'open-meteo.com',
                  retrieval: 'search_context',
                  sourceRole: 'official',
                },
              ]
            : [],
        },
        resolvedLocation,
      };
    } catch (error) {
      lastError = error;
      if (
        signal.aborted ||
        (!(error instanceof EmptyModelResponseError) &&
          !isRetryableModelError(error))
      ) {
        throw error;
      }
    }
  }

  return {
    text: "I couldn't check the live weather just now, so I don't want to guess. Try me again in a moment.",
    finishReason: 'error',
    modelId: packet.decision.modelId,
    usedFallback: false,
    trace: {
      activities: [
        {
          kind: 'weather',
          query: packet.event.ambient.userLocation || 'saved default location',
          resultCount: 0,
          status: 'failed',
          failure: 'unavailable',
        },
      ],
      sources: [],
    },
  };
}
