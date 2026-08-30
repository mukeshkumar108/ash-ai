import { auth } from '@/app/(auth)/auth';
import { ChatSDKError } from '@/lib/errors';
import {
  getChatById,
  getMessagesByChatId,
  withQueryContext,
} from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';
import { getSummarizer } from '@/lib/ai/summarizer';
import { getActiveStateManager } from '@/lib/ai/active-state';
import { measureConversation } from '@/lib/ai/salience';
import {
  buildOntologyPromptBlock,
  buildRuntimeContinuityPacket,
  createContinuityEventsBrief,
  createRelationshipDynamicsBrief,
  defaultRelationshipDynamics,
  extractOntologyFromColumn,
  formatContinuityEventsToPrompt,
  formatRelationshipDynamicsToPrompt,
  getContinuityManager,
  getTopContinuityEvents,
  readContinuityEvents,
  type RelationshipDynamics,
} from '@/lib/ai/continuity';
import {
  createToolMemoryBrief,
  formatStructuredMemoryToPrompt,
} from '@/lib/ai/memory-utils';
import { refreshChatContinuityState } from '@/lib/ai/chat-continuity';
import { getCharacterById } from '@/lib/ai/characters';
import {
  createPromptDomainBrief,
  derivePromptDomainState,
  formatPromptDomainStateForPrompt,
} from '@/lib/ai/prompt-domains';

export async function GET(request: Request) {
  return withQueryContext('GET /api/memory/preview', async () => {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get('chatId');
    const mode = searchParams.get('mode') ?? 'quick';
    const repair = searchParams.get('repair') === '1';
    const minTurns = Number(process.env.MEMORY_MIN_TURNS ?? 5);
    const minTokens = Number(process.env.MEMORY_MIN_TOKENS ?? 400);
    const minSalience = Number(process.env.MEMORY_MIN_SALIENCE ?? 3);
    const activeStateWindowMessages = Number(
      process.env.ACTIVE_STATE_WINDOW_MESSAGES ?? 12,
    );

    if (!chatId) {
      return new Response('Missing chatId parameter', { status: 400 });
    }

    try {
    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError('unauthorized:api').toResponse();
    }

    const chat = await getChatById({ id: chatId });
    if (!chat) {
      return Response.json({
        status: 'chat_not_created',
        memory: null,
        turns: 0,
        minTurnsRequired: minTurns,
      });
    }

    if (chat.userId !== session.user.id) {
      return new ChatSDKError('forbidden:api').toResponse();
    }

    const messagesFromDb = await getMessagesByChatId({ id: chatId });
    if (messagesFromDb.length === 0) {
      return Response.json({
        status: 'no_messages',
        memory: null,
        turns: 0,
        minTurnsRequired: minTurns,
      });
    }

    const buildStateSnapshot = async (sourceChat: typeof chat) => {
      const uiMessages = convertToUIMessages(messagesFromDb);
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
      const recentConversation = convo.slice(-activeStateWindowMessages);
      const { tokensApprox, salience } = measureConversation(convo);
      const shouldSummarize =
        convo.length >= minTurns &&
        (tokensApprox >= minTokens || salience >= minSalience);

      return {
        uiMessages,
        convo,
        recentConversation,
        tokensApprox,
        salience,
        shouldSummarize,
        relationshipDynamics:
          (sourceChat?.relationshipDynamics as RelationshipDynamics | null) ??
          defaultRelationshipDynamics,
        // Schema-tolerant: v1 flat array OR v2 container { _v, items, events }.
        continuityEvents: readContinuityEvents(sourceChat?.continuityEvents),
        persistedMemory: (sourceChat?.memoryState as any) ?? null,
        persistedActiveState: (sourceChat?.activeState as any) ?? null,
      };
    };

    let effectiveChat = chat;
    let snapshot = await buildStateSnapshot(effectiveChat);
    const needsRepair =
      snapshot.shouldSummarize &&
      (!snapshot.persistedMemory ||
        !snapshot.persistedActiveState ||
        snapshot.continuityEvents.length === 0);

    // QUARANTINE: the roleplay-era continuity writer is persona-framed
    // ("Isa"/character perspective) and must never regenerate continuity
    // state for neutral Sophie chats. Neutral chats get a read-only preview.
    const roleplayChat =
      Boolean(chat?.characterId) && chat?.characterId !== 'neutral';

    let repairResult: Awaited<
      ReturnType<typeof refreshChatContinuityState>
    > | null = null;

    if ((repair || needsRepair) && roleplayChat) {
      repairResult = await refreshChatContinuityState({
        chatId,
        userId: session.user.id,
      });
      effectiveChat = (await getChatById({ id: chatId })) ?? chat;
      snapshot = await buildStateSnapshot(effectiveChat ?? chat);
    }

    const {
      convo,
      recentConversation,
      tokensApprox,
      salience,
      shouldSummarize,
      relationshipDynamics,
      continuityEvents,
      persistedMemory,
      persistedActiveState,
    } = snapshot;
    const character = getCharacterById(chat.characterId);
    const promptDomains =
      persistedMemory?.prompt_domains ??
      derivePromptDomainState({
        character,
        memory: persistedMemory,
        activeState: persistedActiveState,
        relationshipDynamics,
      });

    const runtimePacket = buildRuntimeContinuityPacket({
      memory: persistedMemory,
      activeState: persistedActiveState,
      relationshipDynamics,
      continuityEvents,
    });
    const persistedOntology = extractOntologyFromColumn(effectiveChat?.continuityEvents);
    const activeItems = persistedOntology?.items?.filter(i => i.status === 'active') ?? [];
    const resolvedItems = persistedOntology?.items?.filter(i => i.status === 'resolved' || i.status === 'superseded') ?? [];
    const provisionalItems = persistedOntology?.items?.filter(i => i.status === 'provisional') ?? [];
    const turnsSinceRefresh = persistedMemory?.metadata?.lastRefreshTurnCount != null
      ? Math.max(0, convo.filter((m) => m.role === 'assistant').length - (persistedMemory.metadata.lastRefreshTurnCount as number))
      : null;
    const basePayload = {
      chatId,
      characterId: chat.characterId,
      status:
        convo.length === 0
          ? 'no_messages'
          : convo.length < minTurns
            ? 'below_threshold'
            : 'ready',
      turns: convo.length,
      minTurnsRequired: minTurns,
      gate: {
        memorySliceEnabled: process.env.MEMORY_SLICE !== '0',
        tokensApprox,
        salience,
        minTokens,
        minSalience,
        shouldSummarize,
        activeStateWindowMessages,
      },
      recentConversation,
      recentWindowSize: recentConversation.length,
      memory: persistedMemory?.summary ?? null,
      persistedMemory,
      persistedActiveState,
      persistedRelationshipDynamics: effectiveChat?.relationshipDynamics ?? null,
      persistedContinuityEvents: effectiveChat?.continuityEvents ?? null,
      sessionRouting: effectiveChat?.sessionRouting ?? null,
      relationshipDynamics,
      continuityEvents,
      topContinuityEvents: getTopContinuityEvents(continuityEvents),
      continuityEventsBrief: createContinuityEventsBrief(continuityEvents),
      ontologyData: persistedOntology,
      ontologyPrompt: buildOntologyPromptBlock(effectiveChat?.continuityEvents)?.prompt || null,
      relationshipDynamicsBrief:
        createRelationshipDynamicsBrief(relationshipDynamics),
      promptDomains,
      promptDomainsBrief: createPromptDomainBrief(promptDomains),
      runtimePacket,
      continuitySchema: {
        schemaVersion: persistedOntology?.schemaVersion ?? null,
        isV2Container: Boolean(persistedOntology),
        items: persistedOntology?.items?.length ?? 0,
        activeItems: activeItems.length,
        resolvedItems: resolvedItems.length,
        provisionalItems: provisionalItems.length,
        events: continuityEvents.length,
        personModels: persistedOntology?.personModels?.length ?? 0,
        extractionTimestamp: persistedMemory?.metadata?.extractedAt ?? null,
        lastRefreshDate: persistedMemory?.metadata?.lastRefreshDate ?? null,
        lastProcessedAssistantTurn: persistedMemory?.metadata?.lastRefreshTurnCount ?? null,
        turnsSinceRefresh,
        refreshSeq: (effectiveChat?.continuityEvents as any)?.refreshSeq ?? effectiveChat?.continuitySeq ?? null,
        refreshDecision: repairResult?.status ?? null,
        rejectedClaims: persistedMemory?.metadata?.rejectedClaims ?? null,
      },
      promptSections: {
        memoryPrompt: persistedMemory
          ? formatStructuredMemoryToPrompt(persistedMemory)
          : '',
        activeStatePrompt: persistedActiveState,
        relationshipDynamicsPrompt:
          formatRelationshipDynamicsToPrompt(relationshipDynamics),
        continuityEventsPrompt:
          formatContinuityEventsToPrompt(continuityEvents),
        memoryBrief: persistedMemory ? createToolMemoryBrief(persistedMemory) : '',
        promptDomainsPrompt: persistedActiveState?.actors?.some((a: any) => a.role === 'npc')
          ? 'Expression domains suppressed — NPC present'
          : formatPromptDomainStateForPrompt({
          characterId: character.id,
          state: promptDomains,
        }),
      },
      repair: {
        attempted: repair || needsRepair,
        needed: needsRepair,
        result: repairResult,
      },
    };

    if (mode !== 'full') {
      return Response.json({
        ...basePayload,
        mode: 'quick',
      });
    }

    if (convo.length < minTurns) {
      return Response.json({
        ...basePayload,
        mode: 'full',
      });
    }

    const summarizer = getSummarizer();
    const summary = await summarizer.summarizePlain(convo, 'medium');
    const structuredMemory = await summarizer.summarizeStructured(convo, undefined, {
      characterName: character.name,
    });
    const stateCheck = await getActiveStateManager().judgeStateChange({
      recentConversation,
      memory: structuredMemory,
    });
    const activeState = await getActiveStateManager().extractActiveState({
      recentConversation,
      memory: structuredMemory,
    });
    const simulatedRelationshipDynamics =
      await getContinuityManager().updateRelationshipDynamics({
        recentConversation,
        currentDynamics: relationshipDynamics,
        memory: structuredMemory,
        activeState,
      });
    const simulatedContinuityEvents =
      await getContinuityManager().extractContinuityEvents({
        chatId,
        recentConversation,
        memory: structuredMemory,
        activeState,
        currentEvents: continuityEvents,
        turnCount: convo.length,
      });
    const fullRuntimePacket = buildRuntimeContinuityPacket({
      memory: persistedMemory ?? structuredMemory,
      activeState: persistedActiveState ?? activeState,
      relationshipDynamics,
      continuityEvents,
    });
    const fullPromptDomains =
      (persistedMemory ?? structuredMemory).prompt_domains ??
      derivePromptDomainState({
        character,
        memory: persistedMemory ?? structuredMemory,
        activeState: persistedActiveState ?? activeState,
        relationshipDynamics,
      });

    return Response.json({
      ...basePayload,
      mode: 'full',
      memory: summary,
      structuredMemory,
      stateCheck,
      activeState,
      runtimePacket: fullRuntimePacket,
      promptDomains: fullPromptDomains,
      promptDomainsBrief: createPromptDomainBrief(fullPromptDomains),
      promptSections: {
        memoryPrompt: formatStructuredMemoryToPrompt(
          persistedMemory ?? structuredMemory,
        ),
        activeStatePrompt: persistedActiveState ?? activeState,
        relationshipDynamicsPrompt:
          formatRelationshipDynamicsToPrompt(relationshipDynamics),
        continuityEventsPrompt:
          formatContinuityEventsToPrompt(continuityEvents),
        memoryBrief: createToolMemoryBrief(
          persistedMemory ?? structuredMemory,
        ),
        promptDomainsPrompt: (persistedActiveState?.actors?.some((a: any) => a.role === 'npc')
          ? 'Expression domains suppressed — NPC present'
          : formatPromptDomainStateForPrompt({
              characterId: character.id,
              state: fullPromptDomains,
            })),
      },
      simulatedNextPass: {
        stateCheck,
        activeState,
        relationshipDynamics: simulatedRelationshipDynamics,
        continuityEvents: simulatedContinuityEvents,
      },
    });
    } catch (error) {
      console.error('[Memory Preview API]', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}
