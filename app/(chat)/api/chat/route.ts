import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import { auth } from '@/app/(auth)/auth';
import { createAshAgent, outputTokenBudget } from '@/lib/agent/ash-agent';
import {
  createResearchSession,
  extractResearchTrace,
  mergeResearchTraces,
} from '@/lib/agent/brave-search';
import {
  assessEpistemicPolicy,
  evidenceGapsForRetry,
  evidenceState,
  hasMaterialClaimCitationCoverage,
  hasOnlyGroundedCitations,
  judgmentModelId,
  markCitedSources,
  missingRequiredEvidence,
  requiresInlineCitations,
} from '@/lib/agent/research-policy';
import {
  createTurnPacket,
  decideTurn,
  isTextOnlyModel,
} from '@/lib/agent/turn-runtime';
import {
  executeDirectReply,
  executeLiveDataReply,
  isRetryableModelError,
} from '@/lib/agent/turn-executor';
import {
  chatMessagesToLangChain,
  langChainMessageText,
} from '@/lib/agent/messages';
import {
  buildResearchHandoff,
  synthesizeSophieAnswer,
} from '@/lib/agent/sophie-synthesis';
import { getLanguageModel, getPinnedOpenAIModel } from '@/lib/ai/providers';
import {
  createStreamId,
  deleteChatById,
  getChatAccessById,
  getChatById,
  getConversationHandshakeContext,
  getMessagesByChatId,
  getUserById,
  saveUserDefaultLocationIfMissing,
  saveChat,
  saveMessages,
  withQueryContext,
  db,
} from '@/lib/db/queries';
import { message as messageTable, user as userTable } from '@/lib/db/schema';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromUserMessage } from '../../actions';
import { isProductionEnvironment } from '@/lib/constants';
import { postRequestBodySchema, type PostRequestBody } from './schema';
import { sanitizeText } from '@/lib/ai/sanitize';
import { logAIError } from '@/lib/ai/error-log';
import { presignFilePartUrls } from '@/lib/blob-server';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import { after } from 'next/server';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage, ResearchTrace } from '@/lib/types';
import type { ChatModel } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';
import { mirrorCompletedTurn } from '@/lib/honcho';
import { prepareTurnMemory, recordMemoryTrace } from '@/lib/agent/memory';

export const maxDuration = 300;
const CHAT_AGENT_TIMEOUT_MS = Number(
  process.env.CHAT_AGENT_TIMEOUT_MS ?? 240_000,
);

function lastAssistantMessage(messages: unknown[]) {
  return [...messages]
    .reverse()
    .find(
      (entry: unknown) =>
        typeof (entry as { getType?: () => string })?.getType === 'function' &&
        (entry as { getType: () => string }).getType() === 'ai',
    );
}

function assistantFinishReason(message: unknown): string | undefined {
  const value = (message as { additional_kwargs?: { finish_reason?: unknown } })
    ?.additional_kwargs?.finish_reason;
  return typeof value === 'string' ? value : undefined;
}

function boundedEpistemicContext(messages: ChatMessage[]): string {
  return messages
    .slice(0, -1)
    .slice(-6)
    .map((entry) => {
      const text = entry.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 700);
      return text ? `${entry.role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(-3_500);
}

function recentRetrievalProvenance(messages: ChatMessage[]): string | null {
  const notes = messages
    .slice(0, -1)
    .slice(-6)
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== 'data-research') return [];
        const trace = part.data;
        const successful = trace.activities.filter(
          (activity) => activity.status !== 'failed',
        );
        const failed = trace.activities.filter(
          (activity) => activity.status === 'failed',
        );
        const kinds = [...new Set(successful.map((activity) => activity.kind))];
        const quality =
          failed.length > 0
            ? `${failed.length} retrieval attempt${failed.length === 1 ? '' : 's'} failed`
            : 'no recorded retrieval failures';
        return [
          `A recent assistant answer used ${kinds.length > 0 ? kinds.join(', ') : 'no successful retrieval'}; ${quality}.`,
        ];
      }),
    )
    .slice(-2);
  return notes.length > 0 ? notes.join('\n') : null;
}

function textConversation(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(
      (message): message is ChatMessage & { role: 'user' | 'assistant' } =>
        message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({
      role: message.role,
      content: message.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n'),
    }))
    .filter((message) => message.content.trim().length > 0);
}

let globalStreamContext: ResumableStreamContext | null = null;

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
      const userProfile = await getUserById(session.user.id);
      if (!userProfile) {
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
      const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
      const handshake =
        messagesFromDb.length === 0
          ? {
              ...(await getConversationHandshakeContext({
                userId: session.user.id,
                currentChatId: id,
                timeZone,
              })),
            }
          : undefined;

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

      const userCreatedAt = new Date();
      await db
        .insert(messageTable)
        .values({
          chatId: id,
          id: message.id,
          role: 'user',
          parts: message.parts as any,
          attachments: [],
          createdAt: userCreatedAt,
        })
        .onConflictDoNothing();

      const currentUserText = sanitizedMessage.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n');
      const recentConversation = boundedEpistemicContext(uiMessages);
      const [epistemicPolicy, turnMemory] = await Promise.all([
        assessEpistemicPolicy({
          currentTurn: currentUserText,
          recentContext: recentConversation,
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(
              Number(process.env.EPISTEMIC_POLICY_TIMEOUT_MS ?? 8_000),
            ),
          ]),
        }),
        prepareTurnMemory({
          userId: session.user.id,
          chatId: id,
          currentUserTurn: currentUserText,
          recentConversation,
          compilerSignal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(
              Number(process.env.MEMORY_COMPILER_TIMEOUT_MS ?? 10_000),
            ),
          ]),
        }),
      ]);
      recordMemoryTrace({
        userId: session.user.id,
        chatId: id,
        userTurn: currentUserText,
        ...turnMemory,
      });
      const hasImageParts = sanitizedMessage.parts.some(
        (part) => part.type === 'file',
      );
      const turnEvent = {
        userId: session.user.id,
        chatId: id,
        currentUserText,
        selectedModelId: selectedChatModel,
        hasImageParts,
        ambient: {
          userLocation: userProfile?.rpLocation ?? null,
          timeZone,
        },
        recentProvenance: recentRetrievalProvenance(uiMessages),
        memoryPacket: turnMemory.packet,
        handshake,
      };
      const turnDecision = decideTurn(turnEvent, epistemicPolicy);
      const researchTurn = turnDecision.lane === 'research';
      const modelToUse = turnDecision.modelId;

      console.info(
        `[chat] lane=${turnDecision.lane} role=${turnDecision.modelRole} interaction=${epistemicPolicy.interactionMode ?? 'unset'} classifier_ran=${epistemicPolicy.classifierRan} classifier_ok=${epistemicPolicy.classifierSucceeded} depth=${epistemicPolicy.researchDepth} freshness=${epistemicPolicy.freshnessNeed} authority=${epistemicPolicy.authorityNeed} sensitivity=${epistemicPolicy.sourceSensitivity} confidence=${epistemicPolicy.confidence.toFixed(2)} memory=${turnMemory.decision.needsMemory ? turnMemory.retrievalMode : 'no'} memory_ms=${turnMemory.decisionLatencyMs + (turnMemory.retrievalLatencyMs ?? 0)} model=${modelToUse}`,
      );

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

      const presignedMessages = await presignFilePartUrls(messagesToSend);
      const turnPacket = createTurnPacket({
        event: turnEvent,
        decision: turnDecision,
        messages: presignedMessages,
        timeZone,
      });

      // Run the agent to completion before streaming so the assistant message
      // is persisted before the response is returned. This keeps conversation
      // persistence deterministic and makes reconnect/resume restorations
      // reliable without a token-by-token model stream.
      const assistantId = generateUUID();
      const textPartId = generateUUID();
      let finalText = '';
      let researchTrace: ResearchTrace = { activities: [], sources: [] };

      try {
        const agentSignal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS),
        ]);
        if (turnDecision.lane === 'reply_only') {
          const reply = await executeDirectReply({
            packet: turnPacket,
            signal: agentSignal,
          });
          if (reply.usedFallback) {
            console.warn(
              `[chat] reply model fallback from=${turnDecision.modelId} to=${reply.modelId}`,
            );
          }
          console.info(
            `[chat] reply model=${reply.modelId} fallback=${reply.usedFallback} finish_reason=${reply.finishReason} chars=${reply.text.length}`,
          );

          finalText = reply.text;
          if (reply.finishReason === 'length') {
            console.warn('[chat] direct Sophie reply reached output limit');
          }
        } else if (turnDecision.lane === 'live_data') {
          const reply = await executeLiveDataReply({
            packet: turnPacket,
            signal: agentSignal,
          });
          researchTrace = reply.trace;
          finalText = reply.text;
          console.info(
            `[chat] live_data model=${reply.modelId} fallback=${reply.usedFallback} success=${reply.trace.activities.some((activity) => activity.kind === 'weather' && activity.status !== 'failed')} finish_reason=${reply.finishReason} chars=${reply.text.length}`,
          );
        } else {
          const lcMessages = chatMessagesToLangChain(presignedMessages);
          const researchSession = createResearchSession();
          let activeAgentModel = modelToUse;
          const fallbackAgentModel = turnDecision.fallbackModelId;
          const invokeAgent = (
            agentModel: string,
            retry: boolean,
            missing: string[] = [],
            inputMessages = lcMessages,
          ) =>
            createAshAgent({
              userId: session.user.id,
              modelId: agentModel,
              userLocation: userProfile?.rpLocation ?? null,
              researchRequirement: {
                reason: epistemicPolicy.reason,
                retry,
                researchDepth: epistemicPolicy.researchDepth,
                freshnessNeed: epistemicPolicy.freshnessNeed,
                authorityNeed: epistemicPolicy.authorityNeed,
                sourceSensitivity: epistemicPolicy.sourceSensitivity,
                neutralResearchQuestion:
                  epistemicPolicy.neutralResearchQuestion,
                userDeclinedResearch: epistemicPolicy.userDeclinedResearch,
                missing,
              },
              researchSession,
              capabilityMode: researchTurn ? 'research' : 'read_tools',
              memoryPacket: turnMemory.packet,
            }).invoke({ messages: inputMessages }, { signal: agentSignal });

          const invokeWithFallback = async (
            retry: boolean,
            missing: string[] = [],
            inputMessages = lcMessages,
          ) => {
            try {
              return await invokeAgent(
                activeAgentModel,
                retry,
                missing,
                inputMessages,
              );
            } catch (error) {
              if (
                !researchTurn ||
                !isRetryableModelError(error) ||
                fallbackAgentModel === activeAgentModel ||
                agentSignal.aborted
              ) {
                throw error;
              }
              console.warn(
                `[chat] agent model fallback from=${activeAgentModel} to=${fallbackAgentModel}`,
              );
              activeAgentModel = fallbackAgentModel;
              return invokeAgent(
                activeAgentModel,
                retry,
                missing,
                inputMessages,
              );
            }
          };

          let result = await invokeWithFallback(false);
          let attemptTrace = extractResearchTrace(result.messages);
          researchTrace = attemptTrace;
          let state = evidenceState(attemptTrace);
          let gaps = evidenceGapsForRetry(epistemicPolicy, state);
          let finalMessage = lastAssistantMessage(result.messages);
          let candidateText = langChainMessageText(finalMessage);
          let truncated = assistantFinishReason(finalMessage) === 'length';
          const citationMissing =
            requiresInlineCitations(epistemicPolicy) &&
            state.usableSources > 0 &&
            !hasMaterialClaimCitationCoverage(candidateText, attemptTrace);

          let retryCount = 0;
          if (gaps.length > 0 || citationMissing || truncated) {
            retryCount = 1;
            const retryMissing = [
              ...gaps,
              ...(citationMissing ? ['inline_citations'] : []),
              ...(truncated ? ['complete_answer_within_output_budget'] : []),
            ];
            console.warn(
              `[chat] epistemic retry missing=${retryMissing.join(',')}`,
            );
            result = await invokeWithFallback(
              true,
              retryMissing,
              result.messages,
            );
            const retryTrace = extractResearchTrace(result.messages);
            researchTrace = mergeResearchTraces(attemptTrace, retryTrace);
            attemptTrace = retryTrace;
            state = evidenceState(attemptTrace);
            gaps = missingRequiredEvidence(epistemicPolicy, state);
            finalMessage = lastAssistantMessage(result.messages);
            candidateText = langChainMessageText(finalMessage);
            truncated = assistantFinishReason(finalMessage) === 'length';
          } else {
            gaps = missingRequiredEvidence(epistemicPolicy, state);
          }

          const finalCitationMissing =
            requiresInlineCitations(epistemicPolicy) &&
            state.usableSources > 0 &&
            !hasMaterialClaimCitationCoverage(candidateText, attemptTrace);

          console.info(
            `[chat] evidence searches_ok=${state.successfulSearches} searches_failed=${state.failedSearches} pages_ok=${state.successfulPageReads} pages_failed=${state.failedPageReads} authority_read=${state.authorityRead} retry=${retryCount} finish_reason=${assistantFinishReason(finalMessage) ?? 'unknown'} model=${activeAgentModel}`,
          );

          const missingCentralAuthority =
            epistemicPolicy.authorityNeed === 'required' &&
            gaps.includes('authority_read');

          if (missingCentralAuthority) {
            finalText =
              "I couldn't read the underlying authority well enough to answer that as a primary-source-grounded claim. I don't want to substitute snippets or summaries and pretend they're the original.";
          } else if (researchTurn) {
            const finalSpeakerModelId = epistemicPolicy.neutralResearchQuestion
              ? judgmentModelId()
              : selectedChatModel;
            const handoff = buildResearchHandoff({
              researchDraft: candidateText,
              trace: researchTrace,
              evidence: state,
              missing: [
                ...gaps,
                ...(finalCitationMissing ? ['inline_citations'] : []),
              ],
              truncated,
            });
            try {
              const finalSpeakerModel = finalSpeakerModelId.startsWith(
                'openai/gpt-5.6-',
              )
                ? getPinnedOpenAIModel(finalSpeakerModelId)
                : getLanguageModel(finalSpeakerModelId);
              const synthesize = (activeHandoff: string) =>
                synthesizeSophieAnswer({
                  model: finalSpeakerModel,
                  conversation: textConversation(presignedMessages),
                  policy: epistemicPolicy,
                  handoff: activeHandoff,
                  signal: agentSignal,
                  maxOutputTokens: outputTokenBudget(
                    epistemicPolicy.researchDepth,
                  ),
                });
              const synthesisIsValid = (text: string) =>
                text.trim().length > 0 &&
                hasOnlyGroundedCitations(text, researchTrace) &&
                (!requiresInlineCitations(epistemicPolicy) ||
                  hasMaterialClaimCitationCoverage(text, researchTrace));

              let synthesis = await synthesize(handoff);
              if (!synthesisIsValid(synthesis.text)) {
                console.warn(
                  '[chat] Sophie synthesis citation repair required',
                );
                synthesis = await synthesize(
                  `${handoff}\n\n[FINAL CITATION REPAIR]\nRewrite once. Every paragraph or bullet containing a material researched fact must include an exact supporting Markdown URL from SOURCES ACTUALLY RETRIEVED. Remove unsupported precision. Do not add or alter URLs. Opinions need no citation.`,
                );
              }

              if (synthesisIsValid(synthesis.text)) {
                finalText = synthesis.text;
              } else if (
                candidateText.trim() &&
                hasOnlyGroundedCitations(candidateText, researchTrace) &&
                (!requiresInlineCitations(epistemicPolicy) ||
                  hasMaterialClaimCitationCoverage(
                    candidateText,
                    researchTrace,
                  ))
              ) {
                console.warn(
                  '[chat] Sophie synthesis remained ungrounded; returning grounded research draft',
                );
                finalText = candidateText;
              } else {
                finalText =
                  "I found relevant evidence, but I couldn't separate the supported claims from the unsupported ones cleanly enough to give you a trustworthy answer yet.";
              }
              if (synthesis.finishReason === 'length') {
                console.warn('[chat] Sophie synthesis reached output limit');
              }
            } catch (error) {
              if (agentSignal.aborted) throw error;
              if (
                candidateText.trim() &&
                hasOnlyGroundedCitations(candidateText, researchTrace) &&
                (!requiresInlineCitations(epistemicPolicy) ||
                  hasMaterialClaimCitationCoverage(
                    candidateText,
                    researchTrace,
                  ))
              ) {
                console.warn(
                  '[chat] Sophie synthesis failed; returning grounded research draft',
                );
                finalText = candidateText;
              } else {
                finalText =
                  "I found relevant evidence, but I couldn't separate the supported claims from the unsupported ones cleanly enough to give you a trustworthy answer yet.";
              }
            }
          } else if (truncated) {
            finalText =
              "I couldn't complete that answer within the response limit, and I don't want to show you a cut-off version. Please try again in a moment.";
          } else {
            finalText = candidateText;
          }
        }
      } catch (error) {
        logAIError('chat-agent', error);
        throw error;
      }

      if (!finalText) {
        finalText = 'I could not generate a response.';
      }
      if (!userProfile?.rpLocation) {
        const resolvedWeatherLocation = researchTrace.activities.find(
          (activity) =>
            activity.kind === 'weather' && activity.status !== 'failed',
        )?.query;
        if (resolvedWeatherLocation) {
          await saveUserDefaultLocationIfMissing({
            userId: session.user.id,
            location: resolvedWeatherLocation,
          });
        }
      }
      researchTrace = markCitedSources(researchTrace, finalText);

      const assistantCreatedAt = new Date();
      await saveMessages({
        messages: [
          {
            id: assistantId,
            role: 'assistant',
            parts: [
              ...(researchTrace.activities.length > 0
                ? [{ type: 'data-research', data: researchTrace }]
                : []),
              { type: 'text', text: finalText },
            ],
            createdAt: assistantCreatedAt,
            attachments: [],
            chatId: id,
          },
        ],
      });

      // Honcho is a derived, write-only memory mirror at this stage. Register
      // the best-effort write only after both canonical messages are durable,
      // and keep it entirely outside Sophie prompt assembly and generation.
      after(() =>
        mirrorCompletedTurn({
          userId: session.user.id,
          chatId: id,
          userMessage: {
            id: message.id,
            text: currentUserText,
            createdAt: userCreatedAt,
          },
          assistantMessage: {
            id: assistantId,
            text: finalText,
            createdAt: assistantCreatedAt,
          },
        }),
      );

      // Buffered delivery has nothing resumable until the graph has completed
      // and its final assistant message is durable. Creating the stream record
      // here avoids orphaned resumable-stream IDs on cancellation or failure.
      const streamId = generateUUID();
      await createStreamId({ streamId, chatId: id });

      const stream = createUIMessageStream({
        execute: async ({ writer: dataStream }) => {
          dataStream.write({ type: 'start', messageId: assistantId });
          if (researchTrace.activities.length > 0) {
            dataStream.write({
              type: 'data-research',
              data: researchTrace,
            });
          }
          dataStream.write({ type: 'text-start', id: textPartId });
          dataStream.write({
            type: 'text-delta',
            id: textPartId,
            delta: finalText,
          });
          dataStream.write({ type: 'text-end', id: textPartId });
          dataStream.write({ type: 'finish' });
        },
        generateId: generateUUID,
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
