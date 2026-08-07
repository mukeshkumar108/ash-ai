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
  researchFallbackModelId,
  researchModelId,
  requiresInlineCitations,
  shouldUseResearchModel,
  shouldUseJudgmentModel,
} from '@/lib/agent/research-policy';
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
  getMessagesByChatId,
  getUserById,
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
import { type ChatModel, chatModels } from '@/lib/ai/models';
import type { VisibilityType } from '@/components/visibility-selector';

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

function retryableModelError(error: unknown): boolean {
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
  if (candidate.cause && retryableModelError(candidate.cause)) return true;
  return (
    candidate.name === 'AI_APICallError' ||
    /(?:no model available|provider|rate.?limit|overload|unavailable|timeout)/iu.test(
      candidate.message ?? '',
    )
  );
}

// Internal aliases whose underlying model accepts image input. Used to keep
// image requests from falling back to text-only models.
const VISION_CAPABLE_ALIASES = new Set<string>(['chat-model']);

// Internal aliases whose underlying model is text-only (rejects image parts).
const TEXT_ONLY_ALIASES = new Set<string>([
  'chat-model-fallback',
  'chat-model-reasoning',
]);

function isTextOnlyModel(modelId: string): boolean {
  if (VISION_CAPABLE_ALIASES.has(modelId)) return false;
  if (TEXT_ONLY_ALIASES.has(modelId)) return true;
  const def = chatModels.find((chatModel) => chatModel.id === modelId);
  return def ? def.vision === false : false;
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

      const currentUserText = sanitizedMessage.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n');
      const epistemicPolicy = await assessEpistemicPolicy({
        currentTurn: currentUserText,
        recentContext: boundedEpistemicContext(uiMessages),
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            Number(process.env.EPISTEMIC_POLICY_TIMEOUT_MS ?? 8_000),
          ),
        ]),
      });
      const researchTurn = shouldUseResearchModel(epistemicPolicy);
      const judgmentTurn =
        !sanitizedMessage.parts.some((part) => part.type === 'file') &&
        shouldUseJudgmentModel(epistemicPolicy, currentUserText);
      let modelToUse: string = researchTurn
        ? researchModelId()
        : judgmentTurn
          ? judgmentModelId()
          : selectedChatModel;

      console.info(
        `[chat] epistemic classifier_ran=${epistemicPolicy.classifierRan} classifier_ok=${epistemicPolicy.classifierSucceeded} depth=${epistemicPolicy.researchDepth} freshness=${epistemicPolicy.freshnessNeed} authority=${epistemicPolicy.authorityNeed} sensitivity=${epistemicPolicy.sourceSensitivity} confidence=${epistemicPolicy.confidence.toFixed(2)} judgment=${judgmentTurn} model=${modelToUse}`,
      );

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

      const presignedMessages = await presignFilePartUrls(messagesToSend);

      // Run the agent to completion before streaming so the assistant message
      // is persisted before the response is returned. This keeps conversation
      // persistence deterministic and makes reconnect/resume restorations
      // reliable without a token-by-token model stream.
      const assistantId = generateUUID();
      const textPartId = generateUUID();
      let finalText = '';
      let researchTrace: ResearchTrace = { activities: [], sources: [] };

      try {
        const lcMessages = chatMessagesToLangChain(presignedMessages);
        const researchSession = createResearchSession();
        const agentSignal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS),
        ]);
        let activeAgentModel = modelToUse;
        const fallbackAgentModel = researchTurn
          ? researchFallbackModelId()
          : judgmentTurn
            ? selectedChatModel
            : modelToUse;
        const invokeAgent = (
          agentModel: string,
          retry: boolean,
          missing: string[] = [],
          inputMessages = lcMessages,
        ) =>
          createAshAgent({
            userId: session.user.id,
            modelId: agentModel,
            researchRequirement: {
              reason: epistemicPolicy.reason,
              retry,
              researchDepth: epistemicPolicy.researchDepth,
              freshnessNeed: epistemicPolicy.freshnessNeed,
              authorityNeed: epistemicPolicy.authorityNeed,
              sourceSensitivity: epistemicPolicy.sourceSensitivity,
              neutralResearchQuestion: epistemicPolicy.neutralResearchQuestion,
              userDeclinedResearch: epistemicPolicy.userDeclinedResearch,
              missing,
            },
            researchSession,
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
              (!researchTurn && !judgmentTurn) ||
              !retryableModelError(error) ||
              fallbackAgentModel === activeAgentModel ||
              agentSignal.aborted
            ) {
              throw error;
            }
            console.warn(
              `[chat] agent model fallback from=${activeAgentModel} to=${fallbackAgentModel}`,
            );
            activeAgentModel = fallbackAgentModel;
            return invokeAgent(activeAgentModel, retry, missing, inputMessages);
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
            const synthesis = await synthesizeSophieAnswer({
              model: finalSpeakerModelId.startsWith('openai/gpt-5.6-')
                ? getPinnedOpenAIModel(finalSpeakerModelId)
                : getLanguageModel(finalSpeakerModelId),
              conversation: textConversation(presignedMessages),
              policy: epistemicPolicy,
              handoff,
              signal: agentSignal,
              maxOutputTokens: outputTokenBudget(epistemicPolicy.researchDepth),
            });
            if (
              synthesis.text.trim() &&
              hasOnlyGroundedCitations(synthesis.text, researchTrace)
            ) {
              finalText = synthesis.text;
            } else if (synthesis.text.trim()) {
              console.warn(
                '[chat] Sophie synthesis introduced an ungrounded citation; returning research draft',
              );
              finalText = candidateText;
            }
            if (synthesis.finishReason === 'length') {
              console.warn('[chat] Sophie synthesis reached output limit');
            }
          } catch (error) {
            if (agentSignal.aborted) throw error;
            console.warn(
              '[chat] Sophie synthesis failed; returning complete research draft',
            );
            finalText = candidateText;
          }
        } else if (truncated) {
          finalText =
            "I couldn't complete that answer within the response limit, and I don't want to show you a cut-off version. Please try again in a moment.";
        } else {
          finalText = candidateText;
        }
      } catch (error) {
        logAIError('chat-agent', error);
        throw error;
      }

      if (!finalText) {
        finalText = 'I could not generate a response.';
      }
      researchTrace = markCitedSources(researchTrace, finalText);

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
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          },
        ],
      });

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
