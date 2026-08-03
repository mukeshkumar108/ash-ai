import {
  convertToModelMessages,
  createUIMessageStream,
  generateText,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import { auth } from '@/app/(auth)/auth';
import { sophieSystemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatAccessById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  getUserById,
  withQueryContext,
  db,
} from '@/lib/db/queries';
import { message as messageTable, user as userTable } from '@/lib/db/schema';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { isProductionEnvironment } from '@/lib/constants';
import { getLanguageModel } from '@/lib/ai/providers';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { sanitizeText } from '@/lib/ai/sanitize';
import {
  shouldPreferFallbackFirst,
  shouldRejectAssistantOutput,
} from '@/lib/ai/output-judge';
import { logAIError } from '@/lib/ai/error-log';
import { presignFilePartUrls } from '@/lib/blob-server';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import { type ChatModel, chatModels } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

export const maxDuration = 300;
const CHAT_MAX_OUTPUT_TOKENS = Number(
  process.env.CHAT_MAX_OUTPUT_TOKENS ?? 1200,
);
const FIRST_BYTE_TIMEOUT_MS = Number(
  process.env.FIRST_BYTE_TIMEOUT_MS ?? 45000,
);

type RuntimeModelId =
  | ChatModel['id']
  | 'chat-model-fallback'
  | 'deepseek/deepseek-chat-v3-0324';

// Fallback tier served by OpenRouter (independent of the primary NanoGPT
// provider) so a slow/errored NanoGPT window fails through to a stable model.
const OPENROUTER_FALLBACK: RuntimeModelId = 'deepseek/deepseek-chat-v3-0324';

// Internal aliases whose underlying model accepts image input. Used to keep
// image requests from falling back to text-only models.
const VISION_CAPABLE_ALIASES = new Set<RuntimeModelId>(['chat-model']);

// Internal aliases whose underlying model is text-only (rejects image parts).
const TEXT_ONLY_ALIASES = new Set<RuntimeModelId>([
  'chat-model-fallback',
  'chat-model-reasoning',
]);

function isTextOnlyModel(modelId: RuntimeModelId): boolean {
  if (VISION_CAPABLE_ALIASES.has(modelId)) return false;
  if (TEXT_ONLY_ALIASES.has(modelId)) return true;
  const def = chatModels.find((chatModel) => chatModel.id === modelId);
  return def ? def.vision === false : false;
}

const MODEL_FALLBACKS: Record<RuntimeModelId, RuntimeModelId[]> = {
  'chat-model': ['chat-model', 'chat-model-fallback', OPENROUTER_FALLBACK],
  'chat-model-reasoning': [
    'chat-model-reasoning',
    'chat-model-fallback',
    'chat-model',
    OPENROUTER_FALLBACK,
  ],
  'chat-model-fallback': [
    'chat-model-fallback',
    'chat-model',
    OPENROUTER_FALLBACK,
  ],
};

function getFallbackModelIds(modelId: RuntimeModelId) {
  const known = MODEL_FALLBACKS[modelId];
  if (known) return known;
  return [modelId, 'chat-model-fallback', OPENROUTER_FALLBACK];
}

function getOrderedModelCandidates({
  modelId,
  preferFallbackFirst,
}: {
  modelId: RuntimeModelId;
  preferFallbackFirst: boolean;
}) {
  const candidates = getFallbackModelIds(modelId);

  if (!preferFallbackFirst || candidates.length < 2) {
    return candidates;
  }

  return [candidates[1], candidates[0], ...candidates.slice(2)];
}

let globalStreamContext: ResumableStreamContext | null = null;

function flattenMessageText(
  message?: {
    parts?: Array<{ type?: string; text?: string }>;
  } | null,
) {
  return (
    message?.parts
      ?.map((part) => (part.type === 'text' ? part.text || '' : ''))
      .join(' ')
      .trim() || ''
  );
}

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: any) {
      console.error(
        'Failed to create resumable stream context:',
        error.message,
      );
      if (error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL',
        );
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  return withQueryContext('POST /api/chat', async () => {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message,
      selectedChatModel,
      selectedVisibilityType,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
    } = requestBody;

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const chat = await getChatById({ id });

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        characterId: 'neutral',
        visibility: selectedVisibilityType,
        chatModel: selectedChatModel,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    }

    // Ensure the session user has a row so chat/message foreign keys hold.
    if (!(await getUserById(session.user.id))) {
      if (!isProductionEnvironment) {
        await db
          .insert(userTable)
          .values({
            id: session.user.id,
            email: `dev-${session.user.id.slice(0, 8)}@localhost.test`,
          })
          .onConflictDoNothing();
      } else {
        return new ChatSDKError(
          'unauthorized:chat',
          'Session user no longer exists',
        ).toResponse();
      }
    }

    const messagesFromDb = await getMessagesByChatId({ id });

    // Apply input sanitization to user message before processing
    const sanitizedMessage = {
      ...message,
      parts: message.parts?.map((part) => ({
        ...part,
        ...(part.type === 'text' && 'text' in part
          ? { text: sanitizeText(part.text) }
          : {}),
      })),
    };

    const uiMessages = [
      ...convertToUIMessages(messagesFromDb),
      sanitizedMessage,
    ].filter(
      (msg, index, self) => self.findIndex((m) => m.id === msg.id) === index,
    );

    // Keep the most recent context window for the model.
    const contextWindowSize = Number(process.env.CONTEXT_WINDOW_SIZE ?? 40);
    let messagesToSend = uiMessages.slice(-Math.max(3, contextWindowSize));

    const system = sophieSystemPrompt();

    await db
      .insert(messageTable)
      .values({
        chatId: id,
        id: message.id,
        role: 'user',
        parts: message.parts as any,
        attachments: [],
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    const streamId = generateUUID();
    await createStreamId({ streamId, chatId: id });

    let modelToUse: RuntimeModelId = selectedChatModel;

    const hasImageParts = sanitizedMessage.parts.some(
      (part) => part.type === 'file',
    );

    if (hasImageParts && isTextOnlyModel(selectedChatModel)) {
      console.warn(
        `[chat] ${selectedChatModel} does not support image input; falling back to chat-model`,
      );
      modelToUse = 'chat-model';
    }

    // Text-only models reject image parts anywhere in the context (including
    // history), so strip them before building the model messages.
    if (isTextOnlyModel(modelToUse)) {
      messagesToSend = messagesToSend.map((entry) => ({
        ...entry,
        parts: entry.parts.filter(
          (part) => part.type !== 'file',
        ) as ChatMessage['parts'],
      }));
    }

    const contextHasImages = messagesToSend.some((entry) =>
      entry.parts.some((part) => part.type === 'file'),
    );

    const presignedMessages = await presignFilePartUrls(messagesToSend);

    const recentAssistantTexts = uiMessages
      .filter((entry) => entry.role === 'assistant')
      .slice(-4)
      .map((entry) =>
        (entry.parts?.map?.((p: any) => p.text || '').join(' ') || '')
          .trim(),
      )
      .filter((text) => text.length > 0);
    const preferFallbackFirst = shouldPreferFallbackFirst({
      modelId: modelToUse,
      recentAssistantTexts,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        // Safety tweak B: Dev logs for token estimation and tool usage
        if (process.env.NODE_ENV !== 'production') {
          const tokenEst =
            messagesToSend.length * 20 + system.length / 4;
          console.log(`[CHAT] tokenEst.in: ~${Math.round(tokenEst)} tokens`);
        }

        const isVisionCapableCandidate = (candidate: RuntimeModelId) => {
          if (VISION_CAPABLE_ALIASES.has(candidate)) return true;
          const chatModelDef = chatModels.find(
            (chatModel) => chatModel.id === candidate,
          );
          return chatModelDef ? chatModelDef.vision !== false : false;
        };

        const orderedCandidates = getOrderedModelCandidates({
          modelId: modelToUse,
          preferFallbackFirst,
        });
        const modelCandidates = contextHasImages
          ? orderedCandidates.filter(isVisionCapableCandidate)
          : orderedCandidates;
        const responseMessageId = generateUUID();
        const textPartId = generateUUID();
        let hasWrittenResponse = false;

        const writeBufferedTextResponse = (text: string) => {
          if (!hasWrittenResponse) {
            dataStream.write({
              type: 'start',
              messageId: responseMessageId,
            });
            dataStream.write({
              type: 'text-start',
              id: textPartId,
            });
            hasWrittenResponse = true;
          }

          dataStream.write({
            type: 'text-delta',
            id: textPartId,
            delta: text,
          });
          dataStream.write({
            type: 'text-end',
            id: textPartId,
          });
          dataStream.write({
            type: 'finish',
          });
        };

        const runModelAttempt = async (
          candidate: RuntimeModelId,
          index: number,
        ) => {
          const shouldJudgeOutput =
            candidate === 'chat-model';
          let sawAnyChunk = false;
          const controller = new AbortController();
          const firstByteTimeoutMs =
            index === 0 ? FIRST_BYTE_TIMEOUT_MS : FIRST_BYTE_TIMEOUT_MS - 15000;

          const timeoutId = setTimeout(() => {
            controller.abort(
              new Error(
                `Model ${candidate} exceeded ${firstByteTimeoutMs}ms before responding`,
              ),
            );
          }, firstByteTimeoutMs);

          try {
            if (shouldJudgeOutput) {
              const result = await generateText({
                model: getLanguageModel(candidate),
                system: system,
                messages: convertToModelMessages(presignedMessages),
                maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
                maxRetries: 1,
                temperature: 0.85,
                abortSignal: controller.signal,
                experimental_activeTools: [],
                experimental_telemetry: {
                  isEnabled: isProductionEnvironment,
                  functionId: 'generate-text',
                },
              });

              clearTimeout(timeoutId);

              if (shouldRejectAssistantOutput(result.text)) {
                const canFallback = index < modelCandidates.length - 1;

                if (canFallback) {
                  console.warn(
                    `[chat] judge rejected ${candidate}; falling back to ${modelCandidates[index + 1]}`,
                  );
                }

                return {
                  didSucceed: false,
                  canFallback,
                  error: new Error(`Judge rejected model output from ${candidate}`),
                };
              }

              writeBufferedTextResponse(result.text);
              return { didSucceed: true, canFallback: false };
            }

            const result = streamText({
              model: getLanguageModel(candidate),
              system: system,
              messages: convertToModelMessages(presignedMessages),
              maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
              maxRetries: 1,
              temperature: 0.85,
              abortSignal: controller.signal,
              stopWhen: stepCountIs(5),
              experimental_activeTools: [],
              experimental_transform: smoothStream({ chunking: 'word' }),
              experimental_telemetry: {
                isEnabled: isProductionEnvironment,
                functionId: 'stream-text',
              },
              onChunk: async () => {
                sawAnyChunk = true;
                clearTimeout(timeoutId);
              },
              onError: async (error) => {
                logAIError(`chat-model:${candidate}`, error);
              },
            });

            dataStream.merge(
              result.toUIMessageStream({
                sendReasoning: process.env.NODE_ENV !== 'production',
                sendStart: index === 0,
                sendFinish: index === modelCandidates.length - 1,
                onError: () =>
                  index === modelCandidates.length - 1
                    ? 'The model took too long to respond. Please retry, or switch to a faster model.'
                    : '',
              }),
            );

            await result.text;
            return { didSucceed: true, canFallback: false };
          } catch (error) {
            const canFallback =
              !sawAnyChunk && index < modelCandidates.length - 1;

            if (canFallback) {
              console.warn(
                `[chat] falling back from ${candidate} to ${modelCandidates[index + 1]}`,
                error,
              );
            }

            // If we already sent chunks to the client, treat as partial success
            // The client received data and we can't rewind the stream
            if (sawAnyChunk) {
              return { didSucceed: true, canFallback: false };
            }

            return { didSucceed: false, canFallback, error };
          } finally {
            clearTimeout(timeoutId);
          }
        };

        let lastError: unknown;

        for (const [index, candidate] of modelCandidates.entries()) {
          const attempt = await runModelAttempt(candidate, index);

          if (attempt.didSucceed) {
            return;
          }

          lastError = attempt.error;

          if (!attempt.canFallback) {
            break;
          }
        }

        logAIError('chat-models-exhausted', lastError);
        throw (
          lastError instanceof Error
            ? lastError
            : new Error('All configured chat models failed to respond')
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        await saveMessages({
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });
      },
      onError: () => {
        return 'No configured model completed the reply. Please retry or choose another model.';
      },
    });

    const streamContext = getStreamContext();

    if (streamContext) {
      return new Response(
        await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream()),
        ),
      );
    } else {
      return new Response(stream.pipeThrough(new JsonToSseTransformStream()));
    }
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }
    logAIError('chat-route', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected error occurred.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
  });
}

export async function DELETE(request: Request) {
  return withQueryContext('DELETE /api/chat', async () => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatAccessById({ id });

  if (!chat) {
    return new ChatSDKError('not_found:chat').toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
  });
}
