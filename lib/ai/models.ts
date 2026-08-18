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
    id: 'nvidia/nemotron-3.5-lightning:thinking',
    name: 'Nemotron 3.5 Lightning',
    description: 'NanoGPT thinking variant',
    vision: false,
  },
  {
    id: 'deepseek/deepseek-v4-flash-0731:thinking',
    name: 'DeepSeek V4 Flash 0731',
    description: 'NanoGPT thinking variant',
    vision: false,
  },
  {
    id: 'inclusionai/ling-3.0-flash:thinking',
    name: 'Ling 3.0 Flash',
    description: 'NanoGPT thinking variant',
    vision: false,
  },
  {
    id: 'zai-org/glm-5.2:thinking',
    name: 'GLM 5.2',
    description: 'NanoGPT thinking variant',
    vision: false,
  },
  {
    id: 'xiaomi/mimo-v2.5-pro-crof:thinking',
    name: 'MiMo V2.5 Pro',
    description: 'NanoGPT thinking variant',
    vision: false,
  },
  {
    id: 'longcat-2.0:thinking',
    name: 'LongCat 2.0',
    description: 'NanoGPT thinking variant',
    vision: false,
  },
  {
    id: 'nex-agi/nex-n2-mini',
    name: 'Nex N2 Mini',
    description: 'NanoGPT Nex N2 Mini',
    vision: false,
  },
];
