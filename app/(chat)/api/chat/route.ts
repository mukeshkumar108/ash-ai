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
import { deriveSceneState } from '@/lib/agent/scene-state';
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
  fetchCortexContext,
  persistSophieAttention,
} from '@/lib/synapse-cortex';
import { extractSophieAttentionCandidates } from '@/lib/ai/interaction/attention';
import { commitTurnSemantics } from '@/lib/ai/interaction/commit-turn';
import {
  createStreamId,
  deleteChatById,
  getChatAccessById,
  getChatById,
  getConversationHandshakeContext,
  getMessageById,
  getMessagesByChatId,
  getUserById,
  getUserChronologyTimeline,
  getCompanionUserState,
  getTemporalSessionResidueRows,
  saveUserDefaultLocationIfMissing,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateChatSessionRouting,
  updateUserLiveSituation,
  updateUserCorrections,
  updateMessageParts,
  withQueryContext,
  db,
} from '@/lib/db/queries';
import {
  extractBehaviorCorrection,
  mergeBehaviorCorrections,
} from '@/lib/agent/user-corrections';
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
import type { TurnMemory } from '@/lib/agent/memory';
import {
  markLatestInitiativeReplied,
  scheduleInitiativeOpportunity,
} from '@/lib/ai/relationship/store';
import { transcriptReliabilitySchema } from '@/lib/transcript-reliability';
import { applyTranscriptReliabilityGuard } from '@/lib/agent/transcript-reliability';
import { classifyReentry } from '@/lib/agent/reentry';
import { computeUserChronology } from '@/lib/agent/chronology';
import { buildCompanionEntryContext } from '@/lib/agent/entry-context';
import { resolveUserTimeZone } from '@/lib/agent/timezone';
import {
  companionRuntimeAssistantMessageId,
  companionRuntimeReplyOnlyEnabled,
  executeCompanionRuntimeTurn,
  legacyCompanionRuntimeAssistantMessageId,
  type CompanionRuntimeResult,
} from '@/lib/companion-runtime';
import { initiativeOpportunityForRuntimeOutcome } from '@/lib/ai/relationship/policy';
import {
  cancelPendingBeatDeliveries,
  visibleMessagePartsAt,
} from '@/lib/agent/beat-delivery';

export const maxDuration = 300;
const CHAT_AGENT_TIMEOUT_MS = Number(
  process.env.CHAT_AGENT_TIMEOUT_MS ?? 240_000,
);

function runtimeMemoryPacket(
  memory: Record<string, unknown> | null,
): TurnMemory {
  return {
    decision: {
      needsMemory: Boolean(memory?.needs_memory),
      memoryQuestion:
        typeof memory?.memory_question === 'string'
          ? memory.memory_question
          : null,
      reason: 'Prepared by Companion Runtime.',
      confidence: 1,
    },
    retrievalMode:
      (memory?.retrieval_mode as TurnMemory['retrievalMode']) ?? null,
    result: typeof memory?.result === 'string' ? memory.result : null,
    packet: typeof memory?.packet === 'string' ? memory.packet : null,
    decisionLatencyMs: 0,
    retrievalLatencyMs: null,
    failed: Boolean(memory?.failed),
    empty: memory == null || Boolean(memory.empty),
  };
}

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
      const [messagesFromDb, crossChatHandshake, companionUserState] =
        await Promise.all([
          getMessagesByChatId({ id }),
          getConversationHandshakeContext({
            userId: session.user.id,
            currentChatId: id,
            timeZone,
          }),
          getCompanionUserState({ userId: session.user.id }),
        ]);
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

      const currentChatLastInteraction =
        messagesFromDb.at(-1)?.createdAt ?? null;
      const candidates = [
        currentChatLastInteraction,
        crossChatHandshake.lastInteractionAt,
      ].filter(
        (value): value is Date =>
          value instanceof Date && !Number.isNaN(value.getTime()),
      );
      const handshake = {
        chatsToday: crossChatHandshake.chatsToday,
        lastInteractionAt:
          candidates.sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        isNewChat: messagesFromDb.length === 0,
      };
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
      const sessionRoutingSeed = {
        ...currentSessionRouting,
        sessionMode: requestedSessionMode,
        userCorrections:
          companionUserState.corrections ??
          currentSessionRouting.userCorrections ??
          [],
        // Immediate-world state follows the authenticated user across chats.
        // Per-chat state remains a backward-compatible fallback during rollout.
        liveSituation:
          companionUserState.liveSituation ??
          currentSessionRouting.liveSituation ??
          {},
        meaningfulSessionCount: crossChatHandshake.meaningfulSessionCount,
        relationship:
          currentSessionRouting.relationship ??
          crossChatHandshake.relationshipSeed ??
          null,
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
      const allowedDeveloperOverride =
        process.env.SOPHIE_DEV_MODEL_OVERRIDE_ENABLED === 'true'
          ? developerModelOverride
          : undefined;
      const reentry = classifyReentry({
        totalPriorUserTurns: crossChatHandshake.totalUserTurns,
        chronology,
        manualModelOverride: allowedDeveloperOverride,
      });
      const residueRows =
        chronology.newTemporalSession &&
        chronology.previousTemporalSessionStartedAt
          ? await getTemporalSessionResidueRows({
              userId: session.user.id,
              // Fetch a bounded historical pool so bridge candidates may come
              // from more than only the immediately preceding sitting.
              startedAt: new Date(
                chronology.previousTemporalSessionStartedAt.getTime() -
                  7 * 24 * 60 * 60_000,
              ),
              before: new Date(
                Math.min(
                  userCreatedAt.getTime(),
                  (chronology.previousTemporalSessionEndedAt?.getTime() ??
                    userCreatedAt.getTime()) +
                    30 * 60_000,
                ),
              ),
            })
          : [];
      const entryContext = buildCompanionEntryContext({
        userId: session.user.id,
        chronology,
        timeZone,
        residueRows,
        thread: {
          id,
          title: chat?.title ?? null,
          durableObjective:
            typeof currentSessionRouting.currentObjective === 'string'
              ? currentSessionRouting.currentObjective
              : null,
        },
      });
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
      const behaviorCorrection = extractBehaviorCorrection({
        text: currentUserText,
        sourceTurnId: message.id,
      });
      const userCorrections = mergeBehaviorCorrections(
        companionUserState.corrections,
        behaviorCorrection,
      );
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
      const recentProvenance = recentRetrievalProvenance(uiMessages);
      let sceneState: ReturnType<typeof deriveSceneState>;
      let epistemicPolicy: Awaited<ReturnType<typeof assessEpistemicPolicy>>;
      let turnMemory: Awaited<ReturnType<typeof prepareTurnMemory>>;
      let cortexContext: Awaited<ReturnType<typeof fetchCortexContext>>;
      let turnDecision: ReturnType<typeof decideTurn>;
      let runtimeCompleted: Extract<
        CompanionRuntimeResult,
        { status: 'completed' }
      > | null = null;
      let pendingSessionRouting: Record<string, unknown> | null = null;
      let runtimeDeferred = false;

      if (companionRuntimeReplyOnlyEnabled()) {
        const runtimeMessages = await presignFilePartUrls(uiMessages);
        const runtimeCurrent = runtimeMessages.at(-1);
        const runtimeResult = await executeCompanionRuntimeTurn({
          contract_version: 'v1',
          turn_id: message.id,
          conversation_id: id,
          companion_id: 'sophie',
          selected_model_id: reentry.selectedForegroundModel,
          current_sanitized_message: currentUserText,
          message_parts: runtimeCurrent?.parts ?? sanitizedMessage.parts,
          canonical_history: runtimeMessages.slice(0, -1).map((entry) => ({
            id: entry.id,
            role: entry.role,
            content: entry.parts
              .filter((part) => part.type === 'text')
              .map((part) => ('text' in part ? part.text : ''))
              .join('\n'),
            created_at: entry.metadata?.createdAt,
            parts: entry.parts.filter(
              (part) => part.type === 'text' || part.type === 'file',
            ),
          })),
          trusted_user_context: {
            user_id: session.user.id,
            timezone: timeZone,
            userLocation: userProfile?.rpLocation ?? null,
            handshake: {
              ...handshake,
              lastInteractionAt:
                handshake.lastInteractionAt?.toISOString() ?? null,
            },
            reentry,
            entry_context: entryContext,
            session_routing: sessionRoutingSeed,
            medium,
          },
          recent_provenance: { summary: recentProvenance },
          capability_grant: {
            allow_read_tools: true,
            allow_live_data: true,
            allow_research: true,
            granted_scopes: ['read_tools', 'live_data', 'research'],
          },
          transcript_reliability: transcriptReliability,
        });

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
          sceneState = runtimeResult.scene_state as typeof sceneState;
          epistemicPolicy =
            runtimeResult.epistemic_classification as typeof epistemicPolicy;
          turnMemory = runtimeMemoryPacket(runtimeResult.honcho_memory_packet);
          cortexContext =
            runtimeResult.cortex_context_packet as typeof cortexContext;
          turnDecision = {
            lane: 'reply_only',
            modelRole:
              runtimeResult.execution_metadata.model_role === 'judgment'
                ? 'judgment'
                : 'conversation',
            modelId: runtimeResult.model_used,
            fallbackModelId: runtimeResult.model_used,
            reason: 'Executed by Companion Runtime.',
            policy: epistemicPolicy,
          };
        } else {
          runtimeDeferred = true;
          sceneState = runtimeResult.scene_state as typeof sceneState;
          epistemicPolicy =
            runtimeResult.epistemic_classification as typeof epistemicPolicy;
          turnMemory = runtimeMemoryPacket(runtimeResult.honcho_memory_packet);
          cortexContext =
            runtimeResult.cortex_context_packet as typeof cortexContext;
          turnDecision = {
            lane: runtimeResult.execution_lane,
            modelRole: runtimeResult.model_role,
            modelId: runtimeResult.model_id,
            fallbackModelId: runtimeResult.fallback_model_id,
            reason: runtimeResult.reason,
            policy: epistemicPolicy,
          };
        }
      } else {
        sceneState = deriveSceneState({
          messages: messagesFromDb.map((entry) => ({
            role: entry.role,
            createdAt: entry.createdAt,
            text: Array.isArray(entry.parts)
              ? entry.parts
                  .filter((part: any) => part?.type === 'text')
                  .map((part: any) => String(part.text ?? ''))
                  .join('\n')
              : '',
          })),
          currentTurn: currentUserText,
          now: userCreatedAt,
          timeZone,
        });
        const recentConversation = boundedEpistemicContext(uiMessages);
        [epistemicPolicy, turnMemory, cortexContext] = await Promise.all([
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
          fetchCortexContext({
            userId: session.user.id,
            chatId: id,
            timeZone,
            lastInteractionTime: handshake?.lastInteractionAt ?? null,
            sceneState,
            chronology,
          }),
        ]);
        epistemicPolicy = applyTranscriptReliabilityGuard(
          epistemicPolicy,
          transcriptReliability,
        );
        recordMemoryTrace({
          userId: session.user.id,
          chatId: id,
          userTurn: currentUserText,
          ...turnMemory,
        });
        turnDecision = decideTurn(
          {
            userId: session.user.id,
            chatId: id,
            currentUserText,
            selectedModelId: selectedChatModel,
            hasImageParts,
            ambient: {
              userLocation: userProfile?.rpLocation ?? null,
              timeZone,
            },
            recentProvenance,
            memoryPacket: turnMemory.packet,
            transcriptReliability,
            handshake,
            sceneState,
            cortexContext,
            reentry,
            entryContext,
          },
          epistemicPolicy,
        );
      }

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
        recentProvenance,
        memoryPacket: turnMemory?.packet ?? null,
        transcriptReliability,
        handshake,
        sceneState,
        cortexContext,
        reentry,
        entryContext,
      };
      const researchTurn = turnDecision.lane === 'research';
      const modelToUse = turnDecision.modelId;

      console.info(
        `[chat] lane=${turnDecision.lane} role=${turnDecision.modelRole} interaction=${epistemicPolicy.interactionMode ?? 'unset'} classifier_ran=${epistemicPolicy.classifierRan} classifier_ok=${epistemicPolicy.classifierSucceeded} depth=${epistemicPolicy.researchDepth} freshness=${epistemicPolicy.freshnessNeed} authority=${epistemicPolicy.authorityNeed} sensitivity=${epistemicPolicy.sourceSensitivity} confidence=${epistemicPolicy.confidence.toFixed(2)} memory=${turnMemory.decision.needsMemory ? turnMemory.retrievalMode : 'no'} memory_ms=${turnMemory.decisionLatencyMs + (turnMemory.retrievalLatencyMs ?? 0)} model=${modelToUse} reentry=${reentry.class} reentry_turn=${reentry.turnIndex} route_reason=${JSON.stringify(reentry.routeReason)} override=${reentry.manualOverride}`,
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
      let assistantId = companionRuntimeReplyOnlyEnabled()
        ? companionRuntimeAssistantMessageId(id, message.id)
        : generateUUID();
      if (companionRuntimeReplyOnlyEnabled()) {
        const legacyAssistantId = legacyCompanionRuntimeAssistantMessageId(
          message.id,
        );
        const [legacyAssistant] = await getMessageById({
          id: legacyAssistantId,
        });
        if (
          legacyAssistant?.chatId === id &&
          legacyAssistant.role === 'assistant'
        ) {
          assistantId = legacyAssistantId;
        }
        if (behaviorCorrection) {
          after(async () => {
            try {
              await updateUserCorrections({
                userId: session.user.id,
                corrections: userCorrections,
              });
            } catch (error) {
              console.warn('[chat] user correction update failed open', {
                chatId: id,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          });
        }
      }
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

      if (runtimeDeferred) {
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
        } else if (turnDecision.lane === 'reply_only') {
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
      if (companionRuntimeReplyOnlyEnabled()) {
        const inserted = await db
          .insert(messageTable)
          .values(assistantMessage)
          .onConflictDoNothing()
          .returning({ id: messageTable.id });
        shouldMirrorCompletedTurn =
          !existingRuntimeAssistant && inserted.length > 0;
      } else {
        await saveMessages({ messages: [assistantMessage] });
      }

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
        const liveSituation = sessionRouting.liveSituation;
        if (
          liveSituation &&
          typeof liveSituation === 'object' &&
          !Array.isArray(liveSituation)
        ) {
          after(async () => {
            try {
              await updateUserLiveSituation({
                userId: session.user.id,
                liveSituation: liveSituation as Record<string, unknown>,
              });
            } catch (error) {
              console.warn('[chat] user live-situation update failed open', {
                chatId: id,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          });
        }
      }

      // Honcho is a derived, write-only memory mirror at this stage. Register
      // the best-effort write only after both canonical messages are durable,
      // and keep it entirely outside Sophie prompt assembly and generation.
      if (shouldMirrorCompletedTurn) {
        after(async () => {
          const opportunity = initiativeOpportunityForRuntimeOutcome(
            runtimeCompleted?.execution_metadata,
            assistantCreatedAt,
          );
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
          try {
            const candidates = await extractSophieAttentionCandidates({
              recentContext: boundedEpistemicContext(uiMessages),
              userText: currentUserText,
              assistantText: finalText,
            });
            await persistSophieAttention({
              userId: session.user.id,
              chatId: id,
              sourceMessageId: message.id,
              sourceAssistantMessageId: assistantId,
              candidates,
              now: assistantCreatedAt,
            });
          } catch (error) {
            console.warn('[interaction] attention extraction failed open', {
              chatId: id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
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
