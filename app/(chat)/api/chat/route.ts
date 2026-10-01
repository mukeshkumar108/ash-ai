import { createUIMessageStream, JsonToSseTransformStream } from 'ai';
import type { z } from 'zod';
import { auth } from '@/app/(auth)/auth';
import { createAshAgent, outputTokenBudget } from '@/lib/agent/ash-agent';
import {
  createResearchSession,
  extractResearchTrace,
  mergeResearchTraces,
} from '@/lib/agent/brave-search';
import {
  evidenceGapsForRetry,
  evidenceState,
  hasMaterialClaimCitationCoverage,
  hasOnlyGroundedCitations,
  judgmentModelId,
  markCitedSources,
  missingRequiredEvidence,
  requiresInlineCitations,
} from '@/lib/agent/research-policy';
import { isTextOnlyModel } from '@/lib/agent/turn-runtime';
import {
  createToolLanePacket,
  toolLaneDecision,
  toolLanePolicy,
  type ToolLane,
} from '@/lib/agent/tool-lane';
import {
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
import { commitTurnSemantics } from '@/lib/ai/interaction/commit-turn';
import {
  createStreamId,
  deleteChatById,
  getChatAccessById,
  getChatById,
  getMessageById,
  getMessagesByChatId,
  getUserById,
  getUserChronologyTimeline,
  saveUserDefaultLocationIfMissing,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateChatSessionRouting,
  updateMessageParts,
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
import {
  createStreamTrace,
  persistStreamTrace,
  wrapSseBody,
} from '@/lib/stream-trace';
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
import {
  markLatestInitiativeReplied,
  scheduleInitiativeOpportunity,
} from '@/lib/ai/relationship/store';
import { transcriptReliabilitySchema } from '@/lib/transcript-reliability';
import { computeUserChronology } from '@/lib/agent/chronology';
import { resolveUserTimeZone } from '@/lib/agent/timezone';
import {
  buildCompanionRuntimeTurnInput,
  companionRuntimeAssistantMessageId,
  streamCompanionRuntimeTurn,
  type CompanionRuntimeResult,
} from '@/lib/companion-runtime';
import { activeIdleOpportunity } from '@/lib/ai/relationship/policy';
import {
  cancelPendingBeatDeliveries,
  visibleMessagePartsAt,
} from '@/lib/agent/beat-delivery';

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

async function persistStreamedRuntimeReply(input: {
  result: Extract<CompanionRuntimeResult, { status: 'completed' }>;
  assistantId: string;
  chatId: string;
  userId: string;
  userMessageId: string;
  userText: string;
  userCreatedAt: Date;
  timeZone: string;
  uiMessages: ChatMessage[];
  transcriptReliability: z.infer<typeof transcriptReliabilitySchema> | null;
}) {
  const {
    result,
    assistantId,
    chatId,
    userId,
    userMessageId,
    userText,
    userCreatedAt,
    timeZone,
    uiMessages,
    transcriptReliability,
  } = input;
  const assistantCreatedAt = new Date();
  const beats =
    result.beats && result.beats.length >= 2 ? result.beats.slice(0, 3) : [];
  const delivery = result.beat_delivery ?? [];
  const textParts =
    beats.length >= 2
      ? beats.flatMap((beat, beatIndex) => {
          const item = delivery[beatIndex] ?? {
            kind:
              beatIndex === 0
                ? ('immediate' as const)
                : ('continuation' as const),
            available_after_ms: 0,
          };
          return [
            {
              type: 'data-beatDelivery' as const,
              data: {
                beatIndex,
                kind: item.kind,
                availableAt: new Date(
                  assistantCreatedAt.getTime() + item.available_after_ms,
                ).toISOString(),
              },
            },
            { type: 'text' as const, text: beat },
          ];
        })
      : [{ type: 'text' as const, text: result.assistant_message }];
  const inserted = await db
    .insert(messageTable)
    .values({
      id: assistantId,
      role: 'assistant',
      parts: textParts,
      createdAt: assistantCreatedAt,
      attachments: [],
      chatId,
    })
    .onConflictDoNothing()
    .returning({ id: messageTable.id });

  const nextSessionState = result.execution_metadata.next_session_state;
  if (
    nextSessionState &&
    typeof nextSessionState === 'object' &&
    !Array.isArray(nextSessionState)
  ) {
    const sessionRouting = nextSessionState as Record<string, unknown>;
    after(async () => {
      await updateChatSessionRouting({
        id: chatId,
        userId,
        sessionRouting,
        timeoutMs: Number(
          process.env.SESSION_ROUTING_UPDATE_TIMEOUT_MS ?? 2_000,
        ),
      }).catch((error) => {
        console.warn('[chat] streamed session routing update failed open', {
          chatId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    });
  }

  if (inserted.length === 0) return;
  after(async () => {
    const opportunity = activeIdleOpportunity(assistantCreatedAt);
    await scheduleInitiativeOpportunity({
      userId,
      chatId,
      anchorMessageId: assistantId,
      trigger: opportunity.trigger,
      notBefore: opportunity.notBefore,
      context: opportunity.context,
    }).catch(() => undefined);
    try {
      await commitTurnSemantics({
        userId,
        chatId,
        messageId: userMessageId,
        userText,
        assistantText: result.assistant_message,
        localTime: new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone,
        }).format(assistantCreatedAt),
        timeZone,
        referenceTime: assistantCreatedAt,
        recentContext: boundedEpistemicContext(uiMessages),
        signal: AbortSignal.timeout(
          Number(
            process.env.SOPHIE_COMMITMENT_INTERPRETER_TIMEOUT_MS ?? 8_000,
          ) + 15_000,
        ),
      });
    } catch (error) {
      console.warn('[tasks] streamed semantic commit failed open', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    await mirrorCompletedTurn({
      userId,
      chatId,
      userMessage: {
        id: userMessageId,
        text: userText,
        createdAt: userCreatedAt,
        inputSource: transcriptReliability?.source ?? 'typed',
        transcriptReliability,
      },
      assistantMessage: {
        id: assistantId,
        text: result.assistant_message,
        createdAt: assistantCreatedAt,
      },
    });
  });
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
        developerModelOverride,
        sessionModeAction,
        targetedSceneSlots,
      }: {
        id: string;
        message: ChatMessage;
        selectedChatModel: ChatModel['id'];
        selectedVisibilityType: VisibilityType;
        developerModelOverride?: string;
        sessionModeAction?:
          | 'start_session_one'
          | 'start_invited_discovery'
          | 'stop';
        targetedSceneSlots?: string[];
      } = requestBody;

      const session = await auth();

      if (!session?.user) {
        return new ChatSDKError('unauthorized:chat').toResponse();
      }

      const chat = await getChatById({ id });

      if (!chat) {
        await saveChat({
          id,
          userId: session.user.id,
          title: 'New chat',
          characterId: 'neutral',
          visibility: selectedVisibilityType,
          chatModel: selectedChatModel,
        });
        // A title is navigation metadata, not a dependency of Sophie's reply.
        // Generate it after the response so a second model call cannot delay
        // the first turn. Ownership is checked again by the update query.
        after(async () => {
          try {
            const title = await generateTitleFromUserMessage({ message });
            await updateChatTitleById({
              id,
              userId: session.user.id,
              title,
            });
          } catch (error) {
            console.warn('[chat] deferred title generation failed', {
              chatId: id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        });
      } else {
        if (chat.userId !== session.user.id) {
          return new ChatSDKError('forbidden:chat').toResponse();
        }
      }

      // Ensure the session user has a row so chat/message foreign keys hold.
      const userProfile = await getUserById(session.user.id);
      const timeZone = resolveUserTimeZone(userProfile?.timeZone);
      const messagesFromDb = await getMessagesByChatId({ id });
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

      const currentSessionRouting = (chat?.sessionRouting ?? {}) as Record<
        string,
        unknown
      >;
      const existingSessionMode =
        currentSessionRouting.sessionMode &&
        typeof currentSessionRouting.sessionMode === 'object' &&
        !Array.isArray(currentSessionRouting.sessionMode)
          ? (currentSessionRouting.sessionMode as Record<string, unknown>)
          : {};
      const requestedSessionMode = sessionModeAction
        ? sessionModeAction === 'stop'
          ? {
              ...existingSessionMode,
              active: false,
              exitReason: 'explicit_user_action',
            }
          : {
              active: true,
              type:
                sessionModeAction === 'start_session_one'
                  ? 'session_one'
                  : 'invited_discovery',
              enteredAt: new Date().toISOString(),
              turnCount: 0,
              turnBudget: sessionModeAction === 'start_session_one' ? 20 : 8,
              targetedSceneSlots: targetedSceneSlots ?? [],
              exitReason: null,
            }
        : existingSessionMode;
      // Resident Runtime state (`residentWorld`, scene, receipts, last Jev) is
      // carried verbatim from the previous Runtime result; the product adds
      // only the user's explicit session-mode button state.
      const sessionRoutingSeed = {
        ...currentSessionRouting,
        sessionMode: requestedSessionMode,
      };
      // A button press is explicit user-owned authority state, not disposable
      // request metadata. Persist it before generation so a provider failure or
      // mobile reconnect cannot silently lose the selected mode.
      if (sessionModeAction) {
        await updateChatSessionRouting({
          id,
          userId: session.user.id,
          sessionRouting: sessionRoutingSeed,
        });
      }
      const userCreatedAt = new Date();
      // A new user turn invalidates any continuation bubble they have not yet
      // seen. Persist cancellation so refresh/mobile reconnect cannot dump a
      // stale continuation, and exclude unseen text from model history.
      const canonicalMessagesFromDb = [...messagesFromDb];
      const latestAssistantIndex = canonicalMessagesFromDb.findLastIndex(
        (entry) => entry.role === 'assistant',
      );
      if (latestAssistantIndex >= 0) {
        const latestAssistant = canonicalMessagesFromDb[latestAssistantIndex];
        const cancellation = cancelPendingBeatDeliveries(
          latestAssistant.parts,
          userCreatedAt,
        );
        if (cancellation.changed) {
          await updateMessageParts({
            id: latestAssistant.id,
            parts: cancellation.parts,
          });
          canonicalMessagesFromDb[latestAssistantIndex] = {
            ...latestAssistant,
            parts: cancellation.parts as typeof latestAssistant.parts,
          };
        }
      }
      const visibleCanonicalMessages = canonicalMessagesFromDb.map((entry) => ({
        ...entry,
        parts: visibleMessagePartsAt(
          entry.parts,
          userCreatedAt,
        ) as typeof entry.parts,
      }));

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
        ...convertToUIMessages(visibleCanonicalMessages),
        sanitizedMessage,
      ].filter(
        (msg, index, self) => self.findIndex((m) => m.id === msg.id) === index,
      );

      // Keep the most recent context window for the model.
      const contextWindowSize = Number(process.env.CONTEXT_WINDOW_SIZE ?? 40);
      let messagesToSend = uiMessages.slice(-Math.max(3, contextWindowSize));

      // Authoritative cross-thread user chronology (canonical `Message_v2`,
      // user role only, across all of the user's chats, strictly before this
      // incoming turn). Assistant/tool activity does not extend a sitting.
      const [userChronologyTimeline] = await Promise.all([
        getUserChronologyTimeline({
          userId: session.user.id,
          before: userCreatedAt,
        }),
      ]);
      const chronology = computeUserChronology({
        interactionTimes: userChronologyTimeline.userMessages,
        now: userCreatedAt,
        timeZone,
      });
      // Deterministic chronology fact the Runtime consumes (new sitting,
      // first contact of the user's day). Facts only; no posture or opening.
      const runtimeEntryContext = {
        chronology: {
          temporalSession: chronology.newTemporalSession ? 'new' : 'same',
          userDay: chronology.userDayKey,
          daypart: chronology.daypart,
          firstContactToday: chronology.isFirstContactUserDay,
          gapMinutes: chronology.inactivityGapMinutes,
          sessionStartedAt:
            chronology.currentTemporalSessionStartedAt.toISOString(),
        },
      };
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

      // If the user is replying after a proactive Sophie message, connect the
      // reply to that initiative for simple acceptance/latency inspection.
      after(() =>
        markLatestInitiativeReplied({
          userId: session.user.id,
          chatId: id,
          replyMessageId: message.id,
          repliedAt: userCreatedAt,
        }).catch((error) => {
          console.warn('[relationship] failed to record initiative reply', {
            chatId: id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }),
      );

      const currentUserText = sanitizedMessage.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n');
      const transcriptReliabilityPart = sanitizedMessage.parts.find(
        (part) => part.type === 'data-transcriptReliability',
      );
      const transcriptReliability = transcriptReliabilitySchema
        .nullable()
        .parse(
          transcriptReliabilityPart?.type === 'data-transcriptReliability'
            ? transcriptReliabilityPart.data
            : null,
        );
      // Delivery medium for spoken/text cadence. Voice is authoritative from
      // audio input; otherwise a minimal device hint distinguishes mobile from
      // desktop text without a full device-detection framework.
      const medium =
        transcriptReliabilityPart?.type === 'data-transcriptReliability'
          ? ('voice' as const)
          : /mobile|android|iphone|ipad|tablet/iu.test(
                request.headers.get('user-agent') ?? '',
              )
            ? ('mobile_text' as const)
            : ('desktop' as const);
      const hasImageParts = sanitizedMessage.parts.some(
        (part) => part.type === 'file',
      );
      let runtimeCompleted: Extract<
        CompanionRuntimeResult,
        { status: 'completed' }
      > | null = null;
      let pendingSessionRouting: Record<string, unknown> | null = null;
      let toolLane: ToolLane | null = null;
      const assistantId = companionRuntimeAssistantMessageId(id, message.id);

      // The one conversational path: Companion Runtime. No local fallback.
      {
        const runtimeMessages = await presignFilePartUrls(uiMessages);
        const runtimeCurrent = runtimeMessages.at(-1);
        const runtimeTurnInput = buildCompanionRuntimeTurnInput({
          turnId: message.id,
          conversationId: id,
          selectedModelAlias: selectedChatModel,
          currentText: currentUserText,
          currentParts: runtimeCurrent?.parts ?? sanitizedMessage.parts,
          history: runtimeMessages.slice(0, -1) as never,
          userId: session.user.id,
          timeZone,
          entryContext: runtimeEntryContext,
          sessionRouting: sessionRoutingSeed,
          medium,
          transcriptReliability,
        });
        const runtimeRequestStartedAt = performance.now();
        const runtimeTraceOrigin = performance.now();
        const resumableContext = getStreamContext();
        const streamTrace = createStreamTrace(
          runtimeTraceOrigin,
          Boolean(resumableContext),
        );
        const runtimeEvents = streamCompanionRuntimeTurn(
          runtimeTurnInput,
          request.signal,
        );
        let firstRuntimeDelta: { delta: string; elapsed_ms: number } | null =
          null;
        let runtimeResult: CompanionRuntimeResult | null = null;
        while (!firstRuntimeDelta && !runtimeResult) {
          const next = await runtimeEvents.next();
          streamTrace.mark(performance.now(), 'runtimeStreamConnectedMs');
          if (next.done) {
            throw new Error(
              'Companion Runtime stream ended before a terminal event',
            );
          }
          if (next.value.type === 'error') {
            throw new Error(
              `Companion Runtime ${next.value.data.error.error_code}: ${next.value.data.error.message}`,
            );
          }
          if (next.value.type === 'text_delta') {
            streamTrace.mark(performance.now(), 'runtimeFirstTextDeltaMs');
            firstRuntimeDelta = next.value.data;
          } else if (next.value.type === 'completed') {
            runtimeResult = next.value.data.result;
          }
        }

        if (firstRuntimeDelta) {
          const streamId = generateUUID();
          await createStreamId({ streamId, chatId: id });
          const firstDelta = firstRuntimeDelta;
          const stream = createUIMessageStream({
            execute: async ({ writer: dataStream }) => {
              const beatMarker = '<<<BEAT>>>';
              let beatIndex = 0;
              let partId = `${assistantId}-beat-0`;
              let partOpen = false;
              let markerBuffer = '';
              let clientFirstTokenAt: number | null = null;

              const openPart = () => {
                if (partOpen) return;
                dataStream.write({
                  type: 'data-beatDelivery',
                  data: {
                    beatIndex,
                    kind: beatIndex === 0 ? 'immediate' : 'continuation',
                    availableAt: new Date().toISOString(),
                  },
                });
                dataStream.write({ type: 'text-start', id: partId });
                partOpen = true;
              };
              const emitText = (text: string) => {
                if (!text) return;
                openPart();
                if (clientFirstTokenAt === null) {
                  clientFirstTokenAt = performance.now();
                  streamTrace.mark(
                    clientFirstTokenAt,
                    'firstDataStreamWriteMs',
                  );
                  console.info('[latency-waterfall] client_first_token', {
                    turnId: message.id,
                    clientTtftMs: Math.round(
                      clientFirstTokenAt - runtimeRequestStartedAt,
                    ),
                    runtimeDeltaElapsedMs: firstDelta.elapsed_ms,
                  });
                }
                dataStream.write({
                  type: 'text-delta',
                  id: partId,
                  delta: text,
                });
              };
              const consumeDelta = (delta: string) => {
                markerBuffer += delta;
                while (markerBuffer.includes(beatMarker)) {
                  const markerAt = markerBuffer.indexOf(beatMarker);
                  emitText(markerBuffer.slice(0, markerAt));
                  markerBuffer = markerBuffer.slice(
                    markerAt + beatMarker.length,
                  );
                  if (partOpen)
                    dataStream.write({ type: 'text-end', id: partId });
                  beatIndex += 1;
                  partId = `${assistantId}-beat-${beatIndex}`;
                  partOpen = false;
                }
                let held = 0;
                for (let size = 1; size < beatMarker.length; size += 1) {
                  if (markerBuffer.endsWith(beatMarker.slice(0, size)))
                    held = size;
                }
                const safe = held ? markerBuffer.slice(0, -held) : markerBuffer;
                markerBuffer = held ? markerBuffer.slice(-held) : '';
                emitText(safe);
              };
              const startBeat = (nextBeatIndex: number) => {
                emitText(markerBuffer);
                markerBuffer = '';
                if (partOpen)
                  dataStream.write({ type: 'text-end', id: partId });
                beatIndex = nextBeatIndex;
                partId = `${assistantId}-beat-${beatIndex}`;
                partOpen = false;
              };

              dataStream.write({ type: 'start', messageId: assistantId });
              consumeDelta(firstDelta.delta);
              let completed: Extract<
                CompanionRuntimeResult,
                { status: 'completed' }
              > | null = null;
              for await (const event of runtimeEvents) {
                if (event.type === 'text_delta') consumeDelta(event.data.delta);
                else if (event.type === 'beat_start') {
                  startBeat(event.data.beat_index);
                } else if (event.type === 'error') {
                  throw new Error(
                    `Companion Runtime ${event.data.error.error_code}: ${event.data.error.message}`,
                  );
                } else if (event.type === 'completed') {
                  if (event.data.result.status !== 'completed') {
                    throw new Error(
                      'Companion Runtime deferred after emitting foreground text',
                    );
                  }
                  streamTrace.mark(performance.now(), 'runtimeCompletedMs');
                  completed = event.data.result;
                  break;
                }
              }
              emitText(markerBuffer);
              markerBuffer = '';
              if (partOpen) dataStream.write({ type: 'text-end', id: partId });
              if (!completed)
                throw new Error('Companion Runtime stream had no completion');

              await persistStreamedRuntimeReply({
                result: completed,
                assistantId,
                chatId: id,
                userId: session.user.id,
                userMessageId: message.id,
                userText: currentUserText,
                userCreatedAt,
                timeZone,
                uiMessages,
                transcriptReliability,
              });
              const completedAt = performance.now();
              console.info('[latency-waterfall] streamed_runtime_complete', {
                turnId: message.id,
                clientTtftMs:
                  clientFirstTokenAt === null
                    ? null
                    : Math.round(clientFirstTokenAt - runtimeRequestStartedAt),
                totalCompletionMs: Math.round(
                  completedAt - runtimeRequestStartedAt,
                ),
                runtimeTiming: completed.execution_metadata.timing ?? null,
              });
              after(() =>
                persistStreamTrace({
                  turnId: message.id,
                  chatId: id,
                  env: isProductionEnvironment ? 'production' : 'development',
                  trace: streamTrace,
                  runtimeTiming: completed.execution_metadata.timing ?? null,
                }),
              );
              dataStream.write({ type: 'finish' });
            },
            generateId: generateUUID,
          });
          const streamContext = getStreamContext();
          if (streamContext) {
            return new Response(
              await streamContext.resumableStream(streamId, () =>
                wrapSseBody(
                  stream.pipeThrough(new JsonToSseTransformStream()) as never,
                  streamTrace,
                ),
              ),
            );
          }
          return new Response(
            wrapSseBody(
              stream.pipeThrough(new JsonToSseTransformStream()) as never,
              streamTrace,
            ),
          );
        }
        if (!runtimeResult) {
          throw new Error(
            'Companion Runtime produced neither text nor a result',
          );
        }

        if (runtimeResult.status === 'completed') {
          const nextSessionState =
            runtimeResult.execution_metadata.next_session_state;
          if (
            nextSessionState &&
            typeof nextSessionState === 'object' &&
            !Array.isArray(nextSessionState)
          ) {
            // A completed foreground reply is the durable user-facing result.
            // Session routing is useful bookkeeping, but must never sit between
            // that result and assistant-message persistence. Schedule it only
            // after the canonical reply is saved, with a database-side timeout.
            pendingSessionRouting = nextSessionState as Record<string, unknown>;
          }
          runtimeCompleted = runtimeResult;
        } else {
          toolLane = runtimeResult.execution_lane;
          if (
            runtimeResult.next_session_state &&
            typeof runtimeResult.next_session_state === 'object' &&
            !Array.isArray(runtimeResult.next_session_state)
          ) {
            pendingSessionRouting = runtimeResult.next_session_state;
          }
        }
      }

      // Tool lanes only: the Runtime's Jev routed the turn to a capability the
      // product executes (signed-in Google reads, live weather, public
      // research). Lane policy is fixed per lane; nothing here interprets the
      // user's meaning or chooses a conversational move.
      const turnDecision = toolLane
        ? toolLaneDecision({
            lane: toolLane,
            selectedModelId: selectedChatModel,
            hasImageParts,
          })
        : null;
      const epistemicPolicy = turnDecision?.policy ?? toolLanePolicy('read_tools');
      const researchTurn = turnDecision?.lane === 'research';
      const modelToUse = turnDecision?.modelId ?? runtimeCompleted?.model_used ?? '';

      console.info(
        `[chat] lane=${turnDecision?.lane ?? 'reply_only'} model=${modelToUse} runtime=${runtimeCompleted ? 'completed' : 'deferred'}`,
      );
      if (transcriptReliability) {
        console.info('[chat] audio transcript reliability', {
          chatId: id,
          messageId: message.id,
          source: transcriptReliability.source,
          status: transcriptReliability.status,
          confidence: transcriptReliability.confidence,
          signals: transcriptReliability.signals,
          memoryEligible: transcriptReliability.status === 'reliable',
        });
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
      const turnPacket = turnDecision
        ? createToolLanePacket({
            decision: turnDecision,
            messages: presignedMessages,
            ambient: {
              userLocation: userProfile?.rpLocation ?? null,
              timeZone,
            },
            transcriptReliability,
          })
        : null;

      // Run the agent to completion before streaming so the assistant message
      // is persisted before the response is returned. This keeps conversation
      // persistence deterministic and makes reconnect/resume restorations
      // reliable without a token-by-token model stream.
      const textPartId = generateUUID();
      let finalText = '';
      // Native multi-beat output (from the Companion Runtime): 1..3 intentional
      // conversational beats. One logical assistant turn is persisted with one
      // `text` part per beat so the UI renders each as its own bubble.
      let finalBeats: string[] = [];
      let finalBeatDelivery: Array<{
        kind: 'immediate' | 'continuation';
        available_after_ms: number;
      }> = [];
      let researchTrace: ResearchTrace = { activities: [], sources: [] };
      let existingRuntimeAssistant = false;

      if (toolLane) {
        const [existingAssistant] = await getMessageById({ id: assistantId });
        if (
          existingAssistant?.chatId === id &&
          existingAssistant.role === 'assistant'
        ) {
          existingRuntimeAssistant = true;
          const existingParts = existingAssistant.parts as ChatMessage['parts'];
          const existingText = existingParts.find(
            (part) => part.type === 'text',
          );
          const existingResearch = existingParts.find(
            (part) => part.type === 'data-research',
          );
          finalText =
            existingText?.type === 'text' ? existingText.text : finalText;
          researchTrace =
            existingResearch?.type === 'data-research'
              ? existingResearch.data
              : researchTrace;
        }
      }

      try {
        const agentSignal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(CHAT_AGENT_TIMEOUT_MS),
        ]);
        if (existingRuntimeAssistant) {
          console.info(
            `[chat] companion_runtime deferred replay reused canonical assistant id=${assistantId}`,
          );
        } else if (runtimeCompleted) {
          finalText = runtimeCompleted.assistant_message;
          const beats = runtimeCompleted.beats;
          finalBeats = beats && beats.length >= 2 ? beats.slice(0, 3) : [];
          finalBeatDelivery = runtimeCompleted.beat_delivery ?? [];
          console.info(
            `[chat] companion_runtime reply model=${runtimeCompleted.model_used} provider=${runtimeCompleted.provider_used} fallback=${runtimeCompleted.used_fallback} finish_reason=${runtimeCompleted.finish_reason} chars=${finalText.length} beats=${finalBeats.length}`,
          );
        } else if (!turnDecision || !turnPacket) {
          throw new Error('Companion Runtime returned no completed turn or tool lane');
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
            const finalSpeakerModelId = selectedChatModel;
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
      // Beats persist as one logical assistant turn with one text part per beat
      // (each rendered as its own bubble). Deterministic content: the joined
      // text stays the canonical single-text projection for Honcho/chronology.
      const assistantTextParts =
        finalBeats.length >= 2
          ? finalBeats.flatMap((beat, beatIndex) => {
              const delivery = finalBeatDelivery[beatIndex] ?? {
                kind:
                  beatIndex === 0
                    ? ('immediate' as const)
                    : ('continuation' as const),
                available_after_ms: beatIndex * 10_000,
              };
              return [
                {
                  type: 'data-beatDelivery' as const,
                  data: {
                    beatIndex,
                    kind: delivery.kind,
                    availableAt: new Date(
                      assistantCreatedAt.getTime() +
                        delivery.available_after_ms,
                    ).toISOString(),
                  },
                },
                { type: 'text' as const, text: beat },
              ];
            })
          : [{ type: 'text' as const, text: finalText }];
      const assistantMessage = {
        id: assistantId,
        role: 'assistant',
        parts: [
          ...(researchTrace.activities.length > 0
            ? [{ type: 'data-research', data: researchTrace }]
            : []),
          ...assistantTextParts,
        ],
        createdAt: assistantCreatedAt,
        attachments: [],
        chatId: id,
      } as const;
      let shouldMirrorCompletedTurn = !existingRuntimeAssistant;
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(messageTable)
          .values(assistantMessage)
          .onConflictDoNothing()
          .returning({ id: messageTable.id });
        shouldMirrorCompletedTurn =
          !existingRuntimeAssistant && inserted.length > 0;
      });

      if (pendingSessionRouting) {
        const sessionRouting = pendingSessionRouting;
        after(async () => {
          try {
            await updateChatSessionRouting({
              id,
              userId: session.user.id,
              sessionRouting,
              timeoutMs: Number(
                process.env.SESSION_ROUTING_UPDATE_TIMEOUT_MS ?? 2_000,
              ),
            });
          } catch (error) {
            console.warn('[chat] session routing update failed open', {
              chatId: id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        });
      }

      // Honcho is a derived, write-only memory mirror at this stage. Register
      // the best-effort write only after both canonical messages are durable,
      // and keep it entirely outside Sophie prompt assembly and generation.
      if (shouldMirrorCompletedTurn) {
        after(async () => {
          const opportunity = activeIdleOpportunity(assistantCreatedAt);
          await scheduleInitiativeOpportunity({
            userId: session.user.id,
            chatId: id,
            anchorMessageId: assistantId,
            trigger: opportunity.trigger,
            notBefore: opportunity.notBefore,
            context: opportunity.context,
          }).catch((error) => {
            console.warn(
              '[relationship] failed to schedule durable opportunity',
              {
                chatId: id,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            );
          });
          const completedTurn: Parameters<typeof mirrorCompletedTurn>[0] = {
            userId: session.user.id,
            chatId: id,
            userMessage: {
              id: message.id,
              text: currentUserText,
              createdAt: userCreatedAt,
              inputSource: transcriptReliability?.source ?? 'typed',
              transcriptReliability,
            },
            assistantMessage: {
              id: assistantId,
              text: finalText,
              createdAt: assistantCreatedAt,
            },
          };
          // Fast-path semantic commit runs BEFORE the Cortex turn is enqueued
          // (mirrorCompletedTurn below): this establishes the happens-before
          // "fast actions durable -> outbox row exists", so any later outbox
          // delivery resolves the app message's TurnAction ledger into
          // materialized_actions. A sweep can never see the turn before the
          // fast path committed.
          try {
            const semanticCommit = await commitTurnSemantics({
              userId: session.user.id,
              chatId: id,
              messageId: message.id,
              userText: currentUserText,
              assistantText: finalText,
              localTime: new Intl.DateTimeFormat('en-GB', {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone,
              }).format(assistantCreatedAt),
              timeZone,
              referenceTime: assistantCreatedAt,
              recentContext: boundedEpistemicContext(uiMessages),
              signal: AbortSignal.timeout(
                Number(
                  process.env.SOPHIE_COMMITMENT_INTERPRETER_TIMEOUT_MS ?? 8_000,
                ) + 15_000,
              ),
            });
            if (semanticCommit.committed.length > 0) {
              console.info('[tasks] fast-path committed actions', {
                chatId: id,
                messageId: message.id,
                actions: semanticCommit.committed.map((entry) => ({
                  action: entry.action,
                  taskId: entry.taskId,
                  title: entry.title,
                })),
              });
            }
            if (semanticCommit.clarifications.length > 0) {
              console.info('[tasks] fast-path surfaced ambiguity', {
                chatId: id,
                messageId: message.id,
                clarifications: semanticCommit.clarifications,
              });
            }
          } catch (error) {
            console.warn('[tasks] fast-path semantic commit failed open', {
              chatId: id,
              messageId: message.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
          await mirrorCompletedTurn(completedTurn);
        });
      }

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
          // Beats stream as separate text parts in delivery order. Presentation
          // timing belongs to the client; the Vercel function must not block
          // between already-completed beats.
          if (finalBeats.length >= 2) {
            for (
              let beatIndex = 0;
              beatIndex < finalBeats.length;
              beatIndex += 1
            ) {
              const delivery = finalBeatDelivery[beatIndex] ?? {
                kind:
                  beatIndex === 0
                    ? ('immediate' as const)
                    : ('continuation' as const),
                available_after_ms: beatIndex * 10_000,
              };
              dataStream.write({
                type: 'data-beatDelivery',
                data: {
                  beatIndex,
                  kind: delivery.kind,
                  availableAt: new Date(
                    assistantCreatedAt.getTime() + delivery.available_after_ms,
                  ).toISOString(),
                },
              });
              const beatPartId = `${assistantId}-beat-${beatIndex}`;
              dataStream.write({
                type: 'text-start',
                id: beatPartId,
              });
              dataStream.write({
                type: 'text-delta',
                id: beatPartId,
                delta: finalBeats[beatIndex],
              });
              dataStream.write({ type: 'text-end', id: beatPartId });
            }
          } else {
            dataStream.write({ type: 'text-start', id: textPartId });
            dataStream.write({
              type: 'text-delta',
              id: textPartId,
              delta: finalText,
            });
            dataStream.write({ type: 'text-end', id: textPartId });
          }
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
