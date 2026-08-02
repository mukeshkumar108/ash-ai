import type { UserType } from '@/app/(auth)/auth';
import type { ChatModel } from './models';

interface Entitlements {
  maxMessagesPerDay: number;
  availableChatModelIds: Array<ChatModel['id']>;
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  guest: {
    maxMessagesPerDay: 20,
    availableChatModelIds: [
      'chat-model',
      'chat-model-reasoning',
      'bytedance/doubao-seed-character',
      'Gemma-4-31B-Dark-Gemistry',
      'Gemma-4-31B-Gembrain-uncensored-heretic',
      'Qwen3.5-27B-earica-Derestricted',
      'Gemma-4-31B-DarkIdol',
      'deepseek/deepseek-v4-flash',
      'deepseek-ai/deepseek-v3.2-exp',
      'huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated',
    ],
  },

  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: [
      'chat-model',
      'chat-model-reasoning',
      'bytedance/doubao-seed-character',
      'Gemma-4-31B-Dark-Gemistry',
      'Gemma-4-31B-Gembrain-uncensored-heretic',
      'Qwen3.5-27B-earica-Derestricted',
      'Gemma-4-31B-DarkIdol',
      'deepseek/deepseek-v4-flash',
      'deepseek-ai/deepseek-v3.2-exp',
      'huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated',
    ],
  },
};
