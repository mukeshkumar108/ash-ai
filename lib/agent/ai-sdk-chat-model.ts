import {
  BaseChatModel,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type ToolMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2FunctionTool,
  LanguageModelV2Message,
} from '@ai-sdk/provider';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Bridges a Vercel AI SDK v2 `LanguageModel` into a LangChain `BaseChatModel`
 * so the existing Ash model selection (`getLanguageModel`) can drive a
 * DeepAgents harness without a second provider setup.
 *
 * The adapter speaks the AI SDK v2 `doGenerate` / `doStream` contract and
 * performs the LangChain <-> AI SDK message and tool conversions.
 */
export class AISDKChatModel extends BaseChatModel {
  private readonly model: LanguageModelV2;
  private _boundTools: Array<BindToolsInput> = [];
  private temperature: number | undefined;
  private maxOutputTokens: number | undefined;

  constructor(
    model: LanguageModelV2,
    options: { temperature?: number; maxOutputTokens?: number } = {},
  ) {
    super({});
    this.model = model;
    this.temperature = options.temperature;
    this.maxOutputTokens = options.maxOutputTokens;
  }

  _llmType(): string {
    return 'ai-sdk-chat-model';
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Record<string, unknown>,
  ): AISDKChatModel {
    const next = new AISDKChatModel(this.model, {
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
    });
    next._boundTools = tools;
    if (kwargs) {
      if (typeof kwargs.temperature === 'number') {
        next.temperature = kwargs.temperature;
      }
      if (typeof kwargs.maxOutputTokens === 'number') {
        next.maxOutputTokens = kwargs.maxOutputTokens;
      }
    }
    return next;
  }

  async _generate(
    messages: BaseMessage[],
    options: {
      signal?: AbortSignal;
      stop?: string[];
      temperature?: number;
      maxOutputTokens?: number;
    } = {},
  ): Promise<ChatResult> {
    const toolNameById = new Map<string, string>();
    const prompt = toAISDKPrompt(messages, toolNameById);
    const tools = toAISDKTools(this._boundTools);
    const callOptions: LanguageModelV2CallOptions = {
      prompt,
      ...(tools.length > 0 ? { tools } : {}),
      temperature: options.temperature ?? this.temperature,
      maxOutputTokens: options.maxOutputTokens ?? this.maxOutputTokens,
      ...(options.stop && options.stop.length > 0
        ? { stopSequences: options.stop }
        : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    };

    const result = await this.model.doGenerate(callOptions);

    const text = result.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');

    const toolCalls = result.content
      .filter((part) => part.type === 'tool-call')
      .map((part) => ({
        id: part.toolCallId,
        name: part.toolName,
        args: parseToolInput(part.input),
      }));

    const message = new AIMessage({
      content: text,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      additional_kwargs: { finish_reason: result.finishReason },
    } as never);

    return {
      generations: [{ text, message }],
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: {
      signal?: AbortSignal;
      stop?: string[];
      temperature?: number;
      maxOutputTokens?: number;
    } = {},
  ): AsyncGenerator<ChatGenerationChunk> {
    const toolNameById = new Map<string, string>();
    const prompt = toAISDKPrompt(messages, toolNameById);
    const tools = toAISDKTools(this._boundTools);
    const callOptions: LanguageModelV2CallOptions = {
      prompt,
      ...(tools.length > 0 ? { tools } : {}),
      temperature: options.temperature ?? this.temperature,
      maxOutputTokens: options.maxOutputTokens ?? this.maxOutputTokens,
      ...(options.stop && options.stop.length > 0
        ? { stopSequences: options.stop }
        : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    };

    const { stream } = await this.model.doStream(callOptions);
    const reader = stream.getReader();
    const pendingToolCalls = new Map<
      string,
      { name: string; args: string; index: number }
    >();
    const toolCallIndexes = new Map<string, number>();
    let nextToolCallIndex = 0;

    const indexForToolCall = (id: string): number => {
      const existing = toolCallIndexes.get(id);
      if (existing !== undefined) return existing;
      const index = nextToolCallIndex;
      nextToolCallIndex += 1;
      toolCallIndexes.set(id, index);
      return index;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (value.type === 'text-delta' && value.delta) {
          yield new ChatGenerationChunk({
            text: value.delta,
            message: new AIMessageChunk({ content: value.delta }),
          });
        } else if (value.type === 'tool-call') {
          yield new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
              content: '',
              tool_call_chunks: [
                {
                  index: indexForToolCall(value.toolCallId),
                  id: value.toolCallId,
                  name: value.toolName,
                  args:
                    typeof value.input === 'string'
                      ? value.input
                      : JSON.stringify(value.input),
                },
              ],
            }),
          });
        } else if (value.type === 'tool-input-start') {
          pendingToolCalls.set(value.id, {
            name: value.toolName,
            args: '',
            index: indexForToolCall(value.id),
          });
        } else if (value.type === 'tool-input-delta') {
          const pending = pendingToolCalls.get(value.id);
          if (pending) {
            pending.args += value.delta;
          }
        } else if (value.type === 'tool-input-end') {
          const pending = pendingToolCalls.get(value.id);
          if (pending) {
            yield new ChatGenerationChunk({
              text: '',
              message: new AIMessageChunk({
                content: '',
                tool_call_chunks: [
                  {
                    index: pending.index,
                    id: value.id,
                    name: pending.name,
                    args: pending.args,
                  },
                ],
              }),
            });
            pendingToolCalls.delete(value.id);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

function toAISDKPrompt(
  messages: BaseMessage[],
  toolNameById: Map<string, string>,
): LanguageModelV2Message[] {
  const result: LanguageModelV2Message[] = [];

  for (const message of messages) {
    switch (message.getType()) {
      case 'system': {
        result.push({
          role: 'system',
          content: messageText(message.content),
        });
        break;
      }
      case 'human': {
        result.push({
          role: 'user',
          content: humanMessageParts(
            message,
          ) as unknown as LanguageModelV2Message['content'],
        } as unknown as LanguageModelV2Message);
        break;
      }
      case 'ai': {
        const parts: Array<Record<string, unknown>> = [];
        const text = messageText(message.content);

        if (text) {
          parts.push({ type: 'text', text });
        }

        for (const toolCall of (
          message as {
            tool_calls?: Array<{ id?: string; name: string; args?: unknown }>;
          }
        ).tool_calls ?? []) {
          const toolCallId = toolCall.id ?? '';
          parts.push({
            type: 'tool-call',
            toolCallId,
            toolName: toolCall.name,
            input: toolCall.args ?? {},
          });
          toolNameById.set(toolCallId, toolCall.name);
        }

        if (parts.length > 0) {
          result.push({
            role: 'assistant',
            content: parts as unknown as LanguageModelV2Message['content'],
          } as unknown as LanguageModelV2Message);
        }
        break;
      }
      case 'tool': {
        const toolMessage = message as ToolMessage;
        const toolCallId = toolMessage.tool_call_id ?? '';
        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId,
              toolName: toolNameById.get(toolCallId) ?? '',
              output: {
                type: 'text',
                value:
                  typeof message.content === 'string'
                    ? message.content
                    : JSON.stringify(message.content),
              },
            },
          ],
        });
        break;
      }
      default:
        break;
    }
  }

  return result;
}

function humanMessageParts(
  message: BaseMessage,
): Array<Record<string, unknown>> {
  const content = message.content;

  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }

  if (Array.isArray(content)) {
    const parts: Array<Record<string, unknown>> = [];

    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push({ type: 'text', text: block.text });
      } else if (
        block.type === 'image_url' &&
        typeof block.image_url === 'object' &&
        block.image_url !== null &&
        typeof (block.image_url as Record<string, unknown>).url === 'string'
      ) {
        parts.push({
          type: 'file',
          mediaType: 'image/*',
          data: (block.image_url as Record<string, unknown>).url as string,
        });
      }
    }

    return parts;
  }

  return [];
}

function messageText(content: BaseMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      ) {
        return block.text;
      }
      return '';
    })
    .join('');
}

function toAISDKTools(tools: BindToolsInput[]): LanguageModelV2FunctionTool[] {
  const result: LanguageModelV2FunctionTool[] = [];

  for (const bound of tools) {
    const candidate = bound as {
      name?: string;
      description?: string;
      schema?: unknown;
    };

    if (typeof candidate.name !== 'string' || !candidate.name) {
      continue;
    }

    const schema = candidate.schema;
    if (!schema) {
      continue;
    }

    try {
      result.push({
        type: 'function',
        name: candidate.name,
        ...(typeof candidate.description === 'string'
          ? { description: candidate.description }
          : {}),
        inputSchema: zodToJsonSchema(schema as never, {
          target: 'jsonSchema7',
        }) as never,
      });
    } catch (error) {
      throw new Error(`Failed to convert tool schema for ${candidate.name}`, {
        cause: error,
      });
    }
  }

  return result;
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new Error('Model returned a malformed tool call input');
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new Error('Model returned malformed tool call JSON', {
      cause: error,
    });
  }

  throw new Error('Model returned a malformed tool call input');
}
