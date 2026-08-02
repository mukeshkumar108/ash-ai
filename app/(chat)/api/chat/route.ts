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
import {
  getContinueSceneDirectivePrompt,
  getCharacterPosture,
  getNextSceneDirectivePrompt,
} from '@/lib/ai/character-prompts';
import { getCharacterById } from '@/lib/ai/characters';
import { compileSystemPrompt } from '@/lib/ai/compiler';
import { systemPrompt } from '@/lib/ai/prompts';
import {
  createStreamId,
  deleteChatById,
  getChatAccessById,
  getChatById,
  getMessagesByChatId,
  saveChat,
  saveChatState,
  saveMessages,
  getUserById,
  withQueryContext,
  db,
} from '@/lib/db/queries';
import { message as messageTable, user as userTable } from '@/lib/db/schema';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { presignFilePartUrls } from '@/lib/blob-server';
import { generateTitleFromUserMessage } from '../../actions';
import { measureConversation } from '@/lib/ai/salience';
import { resolveHotState } from '@/lib/ai/hot-resolver';
import {
  derivePromptDomainState,
} from '@/lib/ai/prompt-domains';
import {
  defaultRelationshipDynamics,
  extractOntologyFromColumn,
  type ContinuityEvent,
  type RelationshipDynamics,
} from '@/lib/ai/continuity';
import { refreshChatContinuityState } from '@/lib/ai/chat-continuity';
import { isProductionEnvironment } from '@/lib/constants';
import { myProvider, getLanguageModel } from '@/lib/ai/providers';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { sanitizeText } from '@/lib/ai/sanitize';
import {
  shouldPreferFallbackFirst,
  shouldRejectAssistantOutput,
} from '@/lib/ai/output-judge';
import { detectStall, formatStallDirective } from '@/lib/ai/stall-detector';
import { logAIError } from '@/lib/ai/error-log';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';
import type { StructuredMemory } from '@/lib/ai/summarizer';
import type { ActiveState } from '@/lib/ai/active-state';

export const maxDuration = 300;
const CHAT_MAX_OUTPUT_TOKENS = Number(
  process.env.CHAT_MAX_OUTPUT_TOKENS ?? 1200,
);

type RuntimeModelId =
  | ChatModel['id']
  | 'chat-model-fallback'
  | 'scene-model'
  | 'scene-model-fallback';

const MODEL_FALLBACKS: Record<RuntimeModelId, RuntimeModelId[]> = {
  'chat-model': ['chat-model', 'chat-model-fallback'],
  'chat-model-reasoning': [
    'chat-model-reasoning',
    'chat-model-fallback',
    'chat-model',
  ],
  'chat-model-fallback': ['chat-model-fallback', 'chat-model'],
  'scene-model': ['scene-model', 'scene-model-fallback', 'chat-model-fallback'],
  'scene-model-fallback': [
    'scene-model-fallback',
    'scene-model',
    'chat-model-fallback',
  ],
};

function getFallbackModelIds(modelId: RuntimeModelId) {
  const known = MODEL_FALLBACKS[modelId];
  if (known) return known;
  return [modelId, 'chat-model-fallback'];
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
const nextSceneDirectivePrompt = getNextSceneDirectivePrompt();
const continueSceneDirectivePrompt = getContinueSceneDirectivePrompt();

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

    const characterId = (requestBody as any).characterId || 'lila-harper';

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const chat = await getChatById({ id });
    let userProfile = await getUserById(session.user.id);

    if (!userProfile) {
      if (!isProductionEnvironment) {
        await db.insert(userTable).values({
          id: session.user.id,
          email: `dev-${session.user.id.slice(0, 8)}@localhost.test`,
        }).onConflictDoNothing();
        userProfile = {
          id: session.user.id,
          email: `dev-${session.user.id.slice(0, 8)}@localhost.test`,
          displayName: null,
          rpDisplayName: 'User',
          rpAge: '31',
          rpLocation: 'Cambridge, England',
          rpOccupation: 'VP of Product (Tech)',
          rpVibe: "Male, 5'11\", toned and muscular",
          languagePreference: 'en',
          themePreference: 'system',
        };
      } else {
        return new ChatSDKError(
          'unauthorized:chat',
          'Session user no longer exists',
        ).toResponse();
      }
    }

    if (!chat) {
      const title = await generateTitleFromUserMessage({
        message,
      });

      await saveChat({
        id,
        userId: session.user.id,
        title,
        characterId,
        visibility: selectedVisibilityType,
        chatModel: selectedChatModel,
      });
    } else {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
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

    const enableMemorySlice = process.env.MEMORY_SLICE !== '0';
    const MIN_TURNS_FOR_SUMMARY = Number(process.env.MEMORY_MIN_TURNS ?? 5);
    const CHAT_MEMORY_REFRESH_TURNS = Number(
      process.env.CHAT_MEMORY_REFRESH_TURNS ?? 8,
    );
    const ACTIVE_STATE_REFRESH_TURNS = Number(
      process.env.ACTIVE_STATE_REFRESH_TURNS ?? 3,
    );
    const ACTIVE_STATE_WINDOW_MESSAGES = Number(
      process.env.ACTIVE_STATE_WINDOW_MESSAGES ?? 8,
    );
    let memoryBrief = '';
    // Will be set later based on whether memory is used
    let systemWithMemory = '';
    let messagesToSend = uiMessages;

    // Declare variables outside the if block so they're accessible later
    const convo = uiMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: (m.parts?.map?.((p: any) => p.text || '').join(' ') || '')
          .replace(
            /^(Reasoned .*|We need to respond .*|User says .*|Assistant .*):?/i,
            '',
          )
          .trim(),
      }))
      .filter((m) => m.content.length > 0);

    const { tokensApprox, salience, language } = measureConversation(convo);
    const minTokens = Number(process.env.MEMORY_MIN_TOKENS ?? 400);
    const minSal = Number(process.env.MEMORY_MIN_SALIENCE ?? 3);
    const shouldSummarize = tokensApprox >= minTokens || salience >= minSal;
    const persistedMemory = (chat?.memoryState as StructuredMemory | null) ?? null;
    const rawPersistedActiveState = (chat?.activeState as ActiveState | null) ?? null;

    const baseSystemPrompt = systemPrompt({
      characterId,
      language,
      userCanon: userProfile,
      thirdPartyMode: rawPersistedActiveState?.third_party_mode ?? 'closed',
    });

    systemWithMemory = baseSystemPrompt;

    const selectedCharacter = getCharacterById(chat?.characterId ?? characterId);

    const userMessageText = sanitizedMessage.parts
      ?.filter((p: any) => p.type === 'text')
      .map((p: any) => p.text || '')
      .join(' ') || '';
    const isRoleplayTermination =
      /\b(terminate|system override|stop roleplay|end roleplay)\b/i.test(
        userMessageText,
      );

    const baseActiveState = rawPersistedActiveState ?? {
          scene_mode: 'texting',
          location: 'Unknown',
          time_of_day: 'Unknown',
          current_activity: 'Conversation',
          primary_mood: 'Interested',
          visible_emotion: 'Attentive',
          hidden_emotion: 'Undisclosed',
          emotional_direction: 'stable',
          relationship_temperature: 5,
          trust_level: 5,
          affection_level: 5,
          conflict_level: 0,
          attraction_level: 5,
          need_for_reassurance: 3,
          what_they_want: 'Escalate connection through action and intimacy.',
          what_they_are_avoiding: 'Stagnation and repetitive exchanges.',
          likely_next_move: 'Drive the scene forward — escalate intimacy, advance the action, or shift emotional tone.',
          current_boundary: 'No explicit boundary shift detected.',
          tone: 'Conversational',
          message_length: 'short',
          directness_level: 5,
          playfulness_level: 5,
          warmth_level: 6,
          scene_locks: [],
          third_party_mode: 'closed',
          third_party_posture: getCharacterPosture(selectedCharacter.id) as ActiveState['third_party_posture'],
          pace: 'natural',
          actors: [],
          user_proxy: {},
          domain_guard: { mode: 'allow' },
        } as ActiveState;
    const persistedActiveState = resolveHotState(
      userMessageText,
      baseActiveState,
      selectedCharacter.name,
    );

    // Eagerly persist hot-resolved third_party_mode so it survives to the next turn
    if (rawPersistedActiveState || persistedActiveState.third_party_mode !== 'closed') {
      void saveChatState({
        chatId: id,
        activeState: persistedActiveState,
      });
    }

    const persistedRelationshipDynamics =
      (chat?.relationshipDynamics as RelationshipDynamics | null) ??
      defaultRelationshipDynamics;
    const persistedOntology = extractOntologyFromColumn(chat?.continuityEvents);
    const persistedContinuityEvents = Array.isArray(chat?.continuityEvents)
      ? (chat.continuityEvents as ContinuityEvent[])
      : persistedOntology?.events ?? [];

    // ── Compute domain levels for expression tuning ────────────────────
    const effectivePromptDomains =
      persistedMemory?.prompt_domains ??
      derivePromptDomainState({
        character: selectedCharacter,
        memory: persistedMemory,
        activeState: persistedActiveState,
        relationshipDynamics: persistedRelationshipDynamics,
      });

    // ── Compile the system prompt from all available state ──────────────
    const compilerResult = compileSystemPrompt({
      characterId: selectedCharacter.id,
      thirdPartyMode: persistedActiveState.third_party_mode,
      userName: userProfile?.rpDisplayName || 'User',
      language,
      userCanon: userProfile,
      ontologyItems: persistedOntology?.items || [],
      relationshipDimensions: persistedOntology?.relationship || {},
      activeState: persistedActiveState,
      memory: persistedMemory,
      domainLevels: effectivePromptDomains?.current,
      domainBaselines: effectivePromptDomains?.baseline,
      userMessageText,
      personModels: persistedOntology?.personModels || [],
    });
    systemWithMemory = compilerResult.systemPrompt;
    memoryBrief = compilerResult.memoryBrief;

    // ── Message truncation ──────────────────────────────────────────────
    const lastKMax = Number(process.env.MEMORY_LAST_K_MAX ?? 10);
    const dynamicLastK = Math.max(3, Math.min(lastKMax, Math.round(tokensApprox / 800) + 2));
    messagesToSend = uiMessages.slice(-dynamicLastK);

    // ── User directives (meta-commands wrapped in *) ────────────────────
    const directivePattern = /^\*\s*(escalate|continue|next scene|develop|explore|intensify|advance|shift|focus on)\b/i;
    const userDirectives: string[] = [];
    messagesToSend = messagesToSend.filter((msg) => {
      if (msg.role !== 'user') return true;
      const text = msg.parts?.map((p: any) => p.text || '').join(' ').trim() || '';
      if (!text.startsWith('*') || !text.endsWith('*')) return true;
      if (directivePattern.test(text)) {
        userDirectives.push(text.replace(/^\*|\*$/g, '').trim());
        return false;
      }
      return true;
    });
    if (userDirectives.length > 0) {
      systemWithMemory = `${systemWithMemory}\n\n[USER DIRECTIVE]\n${userDirectives.join('\n')}`;
    }

    const presignedMessages = await presignFilePartUrls(messagesToSend);

    // ── Stall detection ─────────────────────────────────────────────────
    const stallReport = detectStall(convo);
    const stallDirective = formatStallDirective(stallReport);
    if (stallDirective) {
      systemWithMemory = `${systemWithMemory}${stallDirective}`;
    }

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

    const isDirective = sanitizedMessage.parts.some(
      (part) =>
        part.type === 'text' &&
        (part.text.trim() === nextSceneDirectivePrompt ||
          part.text.trim() === continueSceneDirectivePrompt),
    );

    const modelToUse: RuntimeModelId = isDirective
      ? 'scene-model'
      : selectedChatModel;
    const recentAssistantTexts = convo
      .filter((entry) => entry.role === 'assistant')
      .slice(-4)
      .map((entry) => entry.content);
    const preferFallbackFirst = shouldPreferFallbackFirst({
      modelId: modelToUse,
      recentAssistantTexts,
    });

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        const systemPromptWithMemory = enableMemorySlice || isRoleplayTermination
          ? `${systemWithMemory}\n\n[MEMORY BRIEF FOR TOOLS]\n${memoryBrief}`
          : systemPrompt({
              characterId,
              language,
              userCanon: userProfile,
              thirdPartyMode: persistedActiveState.third_party_mode,
            });

        // Safety tweak B: Dev logs for token estimation and tool usage
        if (process.env.NODE_ENV !== 'production') {
          const tokenEst =
            messagesToSend.length * 20 + systemPromptWithMemory.length / 4;
          console.log(`[CHAT] tokenEst.in: ~${Math.round(tokenEst)} tokens`);
        }

        const modelCandidates = getOrderedModelCandidates({
          modelId: modelToUse,
          preferFallbackFirst,
        });
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
            candidate === 'chat-model' || candidate === 'scene-model-fallback';
          let sawAnyChunk = false;
          const controller = new AbortController();
          const firstByteTimeoutMs = index === 0 ? 20000 : 15000;

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
                system: systemPromptWithMemory,
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
              system: systemPromptWithMemory,
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

        if (!isRoleplayTermination) {
          void refreshChatContinuityState({
            chatId: id,
            userId: session.user.id,
          }).catch((error) => {
            logAIError('post-finish-continuity', error);
          });
        }
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
