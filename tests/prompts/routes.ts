import { generateUUID } from '@/lib/utils';

export const TEST_PROMPTS = {
  SKY: {
    MESSAGE: {
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      role: 'user',
      content: 'Why is the sky blue?',
      parts: [{ type: 'text', text: 'Why is the sky blue?' }],
    },
    OUTPUT_STREAM: [
      'data: {"type":"text-start","id":"STATIC_ID"}',
      'data: {"type":"text-delta","id":"STATIC_ID","delta":"Hello, world!"}',
      'data: {"type":"text-end","id":"STATIC_ID"}',
      'data: {"type":"finish"}',
      'data: [DONE]',
    ],
  },
  GRASS: {
    MESSAGE: {
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      role: 'user',
      content: 'Why is grass green?',
      parts: [{ type: 'text', text: 'Why is grass green?' }],
    },
    OUTPUT_STREAM: [
      'data: {"type":"text-start","id":"STATIC_ID"}',
      'data: {"type":"text-delta","id":"STATIC_ID","delta":"Hello, world!"}',
      'data: {"type":"text-end","id":"STATIC_ID"}',
      'data: {"type":"finish"}',
      'data: [DONE]',
    ],
  },
};
