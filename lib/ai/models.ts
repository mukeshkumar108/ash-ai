export const DEFAULT_CHAT_MODEL: string = 'chat-model';

export interface ChatModel {
  id: string;
  name: string;
  description: string;
  /**
   * Whether the model accepts image input. `undefined` means unknown — the
   * request is allowed through and the provider decides.
   */
  vision?: boolean;
}

export const chatModels: Array<ChatModel> = [
  {
    id: 'chat-model',
    name: 'Chat model',
    description: 'Default primary model',
    vision: true,
  },
  {
    id: 'chat-model-reasoning',
    name: 'Reasoning model',
    description: 'Default reasoning model',
    vision: false,
  },
  {
    id: 'bytedance/doubao-seed-character',
    name: 'Doubao Seed Character',
    description: 'NanoGPT bytedance doubao seed character',
    vision: true,
  },
  {
    id: 'Gemma-4-31B-Dark-Gemistry',
    name: 'Gemma 4 31B Dark Gemistry',
    description: 'NanoGPT Gemma 4 31B Dark Gemistry',
    vision: true,
  },
  {
    id: 'Gemma-4-31B-Gembrain-uncensored-heretic',
    name: 'Gemma 4 31B Gembrain Heretic',
    description: 'NanoGPT Gemma 4 31B Gembrain uncensored heretic',
    vision: true,
  },
  {
    id: 'Qwen3.5-27B-earica-Derestricted',
    name: 'Qwen 3.5 27B Earica Derestricted',
    description: 'NanoGPT Qwen 3.5 27B earica Derestricted',
    vision: true,
  },
  {
    id: 'Gemma-4-31B-DarkIdol',
    name: 'Gemma 4 31B Dark Idol',
    description: 'NanoGPT Gemma 4 31B Dark Idol',
    vision: true,
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    description: 'NanoGPT DeepSeek V4 Flash',
    vision: false,
  },
  {
    id: 'deepseek-ai/deepseek-v3.2-exp',
    name: 'DeepSeek V3.2 Exp',
    description: 'NanoGPT DeepSeek V3.2 Exp',
    vision: false,
  },
  {
    id: 'huihui-ai/DeepSeek-R1-Distill-Qwen-32B-abliterated',
    name: 'DeepSeek R1 Distill Qwen 32B',
    description: 'NanoGPT DeepSeek R1 Distill Qwen 32B abliterated',
    vision: false,
  },
];
