import type { UserType } from '@/app/(auth)/auth';
import type { ChatModel } from './models';

interface Entitlements {
  maxMessagesPerDay: number;
  availableChatModelIds: Array<ChatModel['id']>;
}

const AVAILABLE_MODEL_IDS: Array<ChatModel['id']> = [
  'chat-model',
  'chat-model-reasoning',
  'nvidia/nemotron-3.5-lightning:thinking',
  'deepseek/deepseek-v4-flash-0731:thinking',
  'inclusionai/ling-3.0-flash:thinking',
  'zai-org/glm-5.2:thinking',
  'xiaomi/mimo-v2.5-pro-crof:thinking',
  'longcat-2.0:thinking',
  'nex-agi/nex-n2-mini',
];

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  guest: {
    maxMessagesPerDay: 20,
    availableChatModelIds: AVAILABLE_MODEL_IDS,
  },

  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: AVAILABLE_MODEL_IDS,
  },
};
