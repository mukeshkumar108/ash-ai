import type { EpistemicPolicy } from '@/lib/agent/research-policy';
import {
  celebrationModelId,
  judgmentModelId,
  researchFallbackModelId,
  researchModelId,
  requiresResearch,
  shouldUseJudgmentModel,
} from '@/lib/agent/research-policy';
import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';
import { chatModels } from '@/lib/ai/models';
import type { ChatMessage } from '@/lib/types';
import type { TranscriptReliability } from '@/lib/transcript-reliability';
import type { CortexContext } from '@/lib/synapse-cortex';
import type { SceneState } from '@/lib/agent/scene-state';

export type ExecutionLane =
  | 'reply_only'
  | 'read_tools'
  | 'live_data'
  | 'research';
export type ModelRole = 'conversation' | 'judgment' | 'live_data' | 'research';

export type TurnEvent = {
  userId: string;
  chatId: string;
  currentUserText: string;
  selectedModelId: string;
  hasImageParts: boolean;
  ambient: {
    userLocation?: string | null;
    timeZone: string;
  };
  recentProvenance?: string | null;
  memoryPacket?: string | null;
  transcriptReliability?: TranscriptReliability | null;
  handshake?: {
    chatsToday: number;
    lastInteractionAt?: Date | null;
    isNewChat?: boolean;
  };
  sceneState?: SceneState;
  cortexContext?: CortexContext | null;
};

export type TurnDecision = {
  lane: ExecutionLane;
  modelRole: ModelRole;
  modelId: string;
  fallbackModelId: string;
  reason: string;
  policy: EpistemicPolicy;
};

export type TurnPacket = {
  event: TurnEvent;
  decision: TurnDecision;
  messages: ChatMessage[];
  systemPrompt: string;
};

const PRIVATE_READ_REQUEST =
  /\b(?:gmail|inbox|e-?mails?|mail|calendar|appointments?|meetings?|events?|my schedule)\b/iu;

export function needsPrivateReadTools(currentTurn: string): boolean {
  return PRIVATE_READ_REQUEST.test(currentTurn);
}

const VISION_CAPABLE_ALIASES = new Set(['chat-model']);
const TEXT_ONLY_ALIASES = new Set([
  'chat-model-fallback',
  'chat-model-reasoning',
]);

export function isTextOnlyModel(modelId: string): boolean {
  if (VISION_CAPABLE_ALIASES.has(modelId)) return false;
  if (TEXT_ONLY_ALIASES.has(modelId)) return true;
  const definition = chatModels.find((model) => model.id === modelId);
  return definition ? definition.vision === false : false;
}

export function decideTurn(
  event: TurnEvent,
  policy: EpistemicPolicy,
): TurnDecision {
  const needsPublicResearchAlongsideLiveData =
    policy.researchDepth !== 'none' || policy.authorityNeed !== 'none';
  if (
    policy.capabilityRoute === 'live_data' &&
    needsPublicResearchAlongsideLiveData
  ) {
    return {
      lane: 'research',
      modelRole: 'research',
      modelId: researchModelId(),
      fallbackModelId: researchFallbackModelId(),
      reason:
        'The compound request requires structured live data and public research.',
      policy,
    };
  }

  if (policy.capabilityRoute === 'live_data') {
    return {
      lane: 'live_data',
      modelRole: 'live_data',
      modelId: judgmentModelId(),
      fallbackModelId: event.selectedModelId,
      reason: 'The answer requires structured current local data.',
      policy,
    };
  }

  if (policy.interactionMode === 'celebration' && !event.hasImageParts) {
    return {
      lane: 'reply_only',
      modelRole: 'conversation',
      modelId: celebrationModelId(),
      fallbackModelId: event.selectedModelId,
      reason:
        'A meaningful win benefits from the calibrated celebration model.',
      policy,
    };
  }

  if (policy.interactionMode === 'safety' && !event.hasImageParts) {
    return {
      lane: 'reply_only',
      modelRole: 'judgment',
      modelId: judgmentModelId(),
      fallbackModelId: event.selectedModelId,
      reason:
        'Safety-sensitive guidance requires the judgment model, not retrieval.',
      policy,
    };
  }

  if (requiresResearch(policy)) {
    return {
      lane: 'research',
      modelRole: 'research',
      modelId: researchModelId(),
      fallbackModelId: researchFallbackModelId(),
      reason: policy.reason,
      policy,
    };
  }

  if (
    policy.capabilityRoute === 'read_tools' ||
    (!policy.classifierSucceeded &&
      needsPrivateReadTools(event.currentUserText))
  ) {
    const modelId =
      event.hasImageParts && isTextOnlyModel(event.selectedModelId)
        ? 'chat-model'
        : event.selectedModelId;
    return {
      lane: 'read_tools',
      modelRole: 'conversation',
      modelId,
      fallbackModelId: modelId,
      reason: 'The answer requires signed-in Google data.',
      policy,
    };
  }

  const judgment =
    !event.hasImageParts &&
    (policy.interactionMode === 'emotional' || shouldUseJudgmentModel(policy));
  let modelId = judgment ? judgmentModelId() : event.selectedModelId;
  if (event.hasImageParts && isTextOnlyModel(modelId)) modelId = 'chat-model';

  return {
    lane: 'reply_only',
    modelRole: judgment ? 'judgment' : 'conversation',
    modelId,
    fallbackModelId: judgment ? event.selectedModelId : modelId,
    reason: judgment
      ? 'Independent conversational judgment benefits from the judgment model.'
      : 'No external capability is needed.',
    policy,
  };
}

export function createTurnPacket({
  event,
  decision,
  messages,
  now,
  timeZone,
}: {
  event: TurnEvent;
  decision: TurnDecision;
  messages: ChatMessage[];
  now?: Date;
  timeZone?: string;
}): TurnPacket {
  return {
    event,
    decision,
    messages,
    systemPrompt: buildSophieReplySystemPrompt({
      now,
      timeZone,
      neutralQuestion: decision.policy.neutralResearchQuestion,
      interactionMode:
        decision.policy.interactionMode ??
        (decision.modelRole === 'judgment' ? 'judgment' : 'practical'),
      handshake: event.handshake,
      ambient: event.ambient,
      recentProvenance: event.recentProvenance,
      memoryPacket: event.memoryPacket,
      transcriptReliability: event.transcriptReliability,
      cortexContext: event.cortexContext,
      sceneState: event.sceneState,
    }),
  };
}
