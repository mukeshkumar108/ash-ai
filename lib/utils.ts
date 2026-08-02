import type {
  CoreAssistantMessage,
  CoreToolMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/lib/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';
import { formatISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const { code, cause } = await response.json();
        throw new ChatSDKError(code as ErrorCode, cause);
      }

      const bodyText = await response.text();

      if (
        response.status === 504 ||
        bodyText.includes('FUNCTION_INVOCATION_TIMEOUT') ||
        bodyText.includes('Task timed out')
      ) {
        throw new ChatSDKError('timeout:chat', bodyText);
      }

      throw new Error(
        `Request failed with status ${response.status}: ${bodyText.slice(0, 200)}`,
      );
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type ResponseMessageWithoutId = CoreToolMessage | CoreAssistantMessage;
type ResponseMessage = ResponseMessageWithoutId & { id: string };

export function getMostRecentUserMessage(messages: Array<UIMessage>) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}

export function getDocumentTimestampByIndex(
  documents: Array<Document>,
  index: number,
) {
  if (!documents) return new Date();
  if (index > documents.length) return new Date();

  return documents[index].createdAt;
}

export function getTrailingMessageId({
  messages,
}: {
  messages: Array<ResponseMessage>;
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) return null;

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function mergePaginatedMessages(
  existingMessages: ChatMessage[],
  incomingMessages: ChatMessage[],
) {
  if (incomingMessages.length === 0) {
    return existingMessages;
  }

  if (existingMessages.length === 0) {
    return incomingMessages;
  }

  const firstIncomingId = incomingMessages[0]?.id;
  const overlapIndex = existingMessages.findIndex(
    (message) => message.id === firstIncomingId,
  );

  if (overlapIndex >= 0) {
    return [...existingMessages.slice(0, overlapIndex), ...incomingMessages];
  }

  const lastIncomingId = incomingMessages[incomingMessages.length - 1]?.id;
  const existingStartsAfterIncoming = existingMessages.some(
    (message) => message.id === lastIncomingId,
  );

  if (existingStartsAfterIncoming) {
    return [...incomingMessages, ...existingMessages];
  }

  return [...existingMessages, ...incomingMessages];
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
