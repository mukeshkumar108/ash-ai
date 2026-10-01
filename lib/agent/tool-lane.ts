import type { EpistemicPolicy } from '@/lib/agent/research-policy';
import {
  judgmentModelId,
  researchFallbackModelId,
  researchModelId,
} from '@/lib/agent/research-policy';
import { isTextOnlyModel } from '@/lib/agent/turn-runtime';
import type {
  ExecutionLane,
  TurnDecision,
  TurnPacket,
} from '@/lib/agent/turn-runtime';
import { sophieSystemPrompt } from '@/lib/ai/prompts';
import type { TranscriptReliability } from '@/lib/transcript-reliability';
import type { ChatMessage } from '@/lib/types';

/**
 * Product-executed capability lanes.
 *
 * Companion Runtime's TypeSafe Jev decides WHICH lane a turn needs and the
 * Runtime returns `deferred`; the product only executes the granted tools.
 * Nothing here interprets the user's meaning or chooses a conversational
 * move: the policy per lane is a fixed property of the lane itself.
 */
export type ToolLane = Exclude<ExecutionLane, 'reply_only'>;

const BASE_POLICY = {
  sourceSensitivity: 'low',
  stakes: 'low',
  questionMode: 'conversation',
  confidence: 1,
  classifierRan: false,
  classifierSucceeded: false,
  userDeclinedResearch: false,
} as const;

export function toolLanePolicy(lane: ToolLane): EpistemicPolicy {
  switch (lane) {
    case 'research':
      return {
        ...BASE_POLICY,
        researchDepth: 'light',
        freshnessNeed: 'preferred',
        authorityNeed: 'none',
        capabilityRoute: 'reply',
        reason: 'Runtime routed this turn to the research lane.',
      };
    case 'live_data':
      return {
        ...BASE_POLICY,
        researchDepth: 'none',
        freshnessNeed: 'none',
        authorityNeed: 'none',
        capabilityRoute: 'live_data',
        reason: 'Runtime routed this turn to the live-data lane.',
      };
    case 'read_tools':
      return {
        ...BASE_POLICY,
        researchDepth: 'none',
        freshnessNeed: 'none',
        authorityNeed: 'none',
        capabilityRoute: 'read_tools',
        reason: 'Runtime routed this turn to the signed-in read-tools lane.',
      };
  }
}

export function toolLaneDecision(input: {
  lane: ToolLane;
  selectedModelId: string;
  hasImageParts: boolean;
}): TurnDecision {
  const policy = toolLanePolicy(input.lane);
  if (input.lane === 'research') {
    return {
      lane: 'research',
      modelRole: 'research',
      modelId: researchModelId(),
      fallbackModelId: researchFallbackModelId(),
      reason: policy.reason,
      policy,
    };
  }
  if (input.lane === 'live_data') {
    return {
      lane: 'live_data',
      modelRole: 'live_data',
      modelId: judgmentModelId(),
      fallbackModelId: input.selectedModelId,
      reason: policy.reason,
      policy,
    };
  }
  const modelId =
    input.hasImageParts && isTextOnlyModel(input.selectedModelId)
      ? 'chat-model'
      : input.selectedModelId;
  return {
    lane: 'read_tools',
    modelRole: 'conversation',
    modelId,
    fallbackModelId: modelId,
    reason: policy.reason,
    policy,
  };
}

function formatCurrentTime(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone: 'UTC',
    }).format(now);
  }
}

/**
 * Constitution + hard facts only (time, saved location, audio provenance).
 * No interaction mode, posture, entry steering or memory/context packets.
 */
export function buildToolLaneSystemPrompt(input: {
  now?: Date;
  timeZone: string;
  userLocation?: string | null;
  transcriptReliability?: TranscriptReliability | null;
}): string {
  const now = input.now ?? new Date();
  const audio = input.transcriptReliability
    ? `\n\n[AUDIO INPUT SOURCE]\nThis user message was transcribed from audio (status: ${input.transcriptReliability.status}). Speech transcription is fallible; if wording looks garbled, say so rather than building on it.`
    : '';
  return `${sophieSystemPrompt().trim()}

[TRUSTED CURRENT TIME]
The server's current local date and time is ${formatCurrentTime(now, input.timeZone)}. The configured timezone is ${input.timeZone}. Treat this as authoritative.

[AMBIENT CONTEXT]
The user's saved default location is ${input.userLocation?.trim() || 'not set'}. Use it when location materially affects the request, but do not claim it proves the user's present position.${audio}`;
}

export function createToolLanePacket(input: {
  decision: TurnDecision;
  messages: ChatMessage[];
  ambient: { userLocation?: string | null; timeZone: string };
  transcriptReliability?: TranscriptReliability | null;
  now?: Date;
}): TurnPacket {
  return {
    event: {
      userId: '',
      chatId: '',
      currentUserText: '',
      selectedModelId: input.decision.fallbackModelId,
      hasImageParts: false,
      ambient: input.ambient,
      transcriptReliability: input.transcriptReliability ?? null,
    },
    decision: input.decision,
    messages: input.messages,
    systemPrompt: buildToolLaneSystemPrompt({
      now: input.now,
      timeZone: input.ambient.timeZone,
      userLocation: input.ambient.userLocation,
      transcriptReliability: input.transcriptReliability,
    }),
  };
}
