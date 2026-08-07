import { expect, test } from '@playwright/test';
import { MockLanguageModelV2 } from 'ai/test';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

import { AISDKChatModel } from '@/lib/agent/ai-sdk-chat-model';

function generated(content: Array<Record<string, unknown>>) {
  return {
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: 'tool-calls' as const,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    content: content as never,
    warnings: [],
  };
}

test('adapter preserves system, multipart, tool-call, and tool-result ordering', async () => {
  let prompt: unknown;
  const model = new MockLanguageModelV2({
    doGenerate: async (options) => {
      prompt = options.prompt;
      return generated([{ type: 'text', text: 'done' }]);
    },
  });
  const adapter = new AISDKChatModel(model);

  await adapter.invoke([
    new SystemMessage({
      content: [{ type: 'text', text: 'system rules' }] as never,
    }),
    new HumanMessage({
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image_url',
          image_url: { url: 'https://files.example.test/image.png' },
        },
      ],
    }),
    new AIMessage({
      content: [{ type: 'text', text: 'checking' }] as never,
      tool_calls: [
        { id: 'call-1', name: 'first_tool', args: { value: 1 } },
        { id: 'call-2', name: 'second_tool', args: { value: 2 } },
      ],
    }),
    new ToolMessage({
      tool_call_id: 'call-1',
      content: '{"ok":true}',
    }),
    new ToolMessage({
      tool_call_id: 'call-2',
      content: '{"ok":false}',
    }),
  ]);

  expect(prompt).toEqual([
    { role: 'system', content: 'system rules' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'file',
          mediaType: 'image/*',
          data: 'https://files.example.test/image.png',
        },
      ],
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking' },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'first_tool',
          input: { value: 1 },
        },
        {
          type: 'tool-call',
          toolCallId: 'call-2',
          toolName: 'second_tool',
          input: { value: 2 },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'first_tool',
          output: { type: 'text', value: '{"ok":true}' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-2',
          toolName: 'second_tool',
          output: { type: 'text', value: '{"ok":false}' },
        },
      ],
    },
  ]);
});

test('adapter preserves multiple generated tool calls and rejects malformed input', async () => {
  const valid = new AISDKChatModel(
    new MockLanguageModelV2({
      doGenerate: async () =>
        generated([
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'first_tool',
            input: { value: 1 },
          },
          {
            type: 'tool-call',
            toolCallId: 'call-2',
            toolName: 'second_tool',
            input: '{"value":2}',
          },
        ]),
    }),
  );

  const response = (await valid.invoke([new HumanMessage('go')])) as AIMessage;
  expect(response.additional_kwargs.finish_reason).toBe('tool-calls');
  expect(response.tool_calls).toEqual([
    { id: 'call-1', name: 'first_tool', args: { value: 1 } },
    { id: 'call-2', name: 'second_tool', args: { value: 2 } },
  ]);

  const malformed = new AISDKChatModel(
    new MockLanguageModelV2({
      doGenerate: async () =>
        generated([
          {
            type: 'tool-call',
            toolCallId: 'bad-call',
            toolName: 'first_tool',
            input: '{not json',
          },
        ]),
    }),
  );

  await expect(malformed.invoke([new HumanMessage('go')])).rejects.toThrow(
    'malformed tool call JSON',
  );
});

test('adapter forwards invocation cancellation to the AI SDK model', async () => {
  let receivedSignal: AbortSignal | undefined;
  const model = new MockLanguageModelV2({
    doGenerate: async (options) => {
      receivedSignal = options.abortSignal;
      return generated([{ type: 'text', text: 'done' }]);
    },
  });
  const adapter = new AISDKChatModel(model);
  const controller = new AbortController();

  await adapter.invoke([new HumanMessage('hello')], {
    signal: controller.signal,
  });

  expect(receivedSignal).toBe(controller.signal);
});
