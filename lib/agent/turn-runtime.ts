import type { EpistemicPolicy } from '@/lib/agent/research-policy';
import { chatModels } from '@/lib/ai/models';
import type { ChatMessage } from '@/lib/types';
import type { TranscriptReliability } from '@/lib/transcript-reliability';

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

const VISION_CAPABLE_ALIASES = new Set(['chat-model']);
const TEXT_ONLY_ALIASES = new Set([
  'chat-model-fallback',
  'chat-model-reasoning',
  'deepseek/deepseek-v4-flash',
  'nex-agi/nex-n2-mini',
]);

export function isTextOnlyModel(modelId: string): boolean {
  if (VISION_CAPABLE_ALIASES.has(modelId)) return false;
  if (TEXT_ONLY_ALIASES.has(modelId)) return true;
  const definition = chatModels.find((model) => model.id === modelId);
  return definition ? definition.vision === false : false;
}
