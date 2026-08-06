import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';

import type { ChatMessage } from '@/lib/types';

export function chatMessagesToLangChain(
  messages: ChatMessage[],
): BaseMessage[] {
  const result: BaseMessage[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      const content: Array<Record<string, unknown>> = [];

      for (const part of message.parts ?? []) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text });
        } else if (part.type === 'file') {
          content.push({ type: 'image_url', image_url: { url: part.url } });
        }
      }

      result.push(
        new HumanMessage({
          content: content as never,
          id: message.id,
        }),
      );
    } else if (message.role === 'assistant') {
      const text = (message.parts ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => (part as { text?: string }).text ?? '')
        .join('');

      result.push(new AIMessage({ content: text, id: message.id }));
    }
  }

  return result;
}

export function langChainMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = (message as { content?: unknown }).content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is string => typeof part === 'string')
      .join('');

    if (text) {
      return text;
    }

    return content
      .filter(
        (part): part is { type: string; text?: string } =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: string }).type === 'text',
      )
      .map((part) => part.text ?? '')
      .join('');
  }

  return '';
}
