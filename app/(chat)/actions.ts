'use server';

import { generateText, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import { auth } from '@/app/(auth)/auth';
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatAccessById,
  getMessageById,
  saveChatState,
  updateChatModelById,
  updateChatVisiblityById,
  withQueryContext,
} from '@/lib/db/queries';
import type { VisibilityType } from '@/components/visibility-selector';
import { myProvider } from '@/lib/ai/providers';
import { refreshChatContinuityState } from '@/lib/ai/chat-continuity';
import { ChatSDKError } from '@/lib/errors';
import { logAIError } from '@/lib/ai/error-log';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function saveChatModel({
  id,
  model,
}: {
  id: string;
  model: string;
}) {
  return withQueryContext('server action saveChatModel', async () => {
  const session = await auth();

  if (!session?.user?.id) {
    throw new ChatSDKError('unauthorized:chat');
  }

  const chat = await getChatAccessById({ id });

  if (!chat) {
    return; // Chat not yet created — model will be set on first message
  }

  if (chat.userId !== session.user.id) {
    throw new ChatSDKError('forbidden:chat');
  }

  await updateChatModelById({ id, chatModel: model });
  });
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const { text: title } = await generateText({
    model: myProvider.languageModel('title-model'),
    system: `\n
    - you will generate a short title based on the first message a user begins a conversation with
    - ensure it is not more than 80 characters long
    - the title should be a summary of the user's message
    - do not use quotes or colons`,
    prompt: JSON.stringify(message),
  });

  return title;
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  return withQueryContext('server action deleteTrailingMessages', async () => {
  const session = await auth();

  if (!session?.user?.id) {
    throw new ChatSDKError('unauthorized:chat');
  }

  const [message] = await getMessageById({ id });

  if (!message) {
    throw new ChatSDKError('not_found:chat', 'Message not found');
  }

  const chat = await getChatAccessById({ id: message.chatId });

  if (!chat) {
    throw new ChatSDKError('not_found:chat', 'Chat not found');
  }

  if (chat.userId !== session.user.id) {
    throw new ChatSDKError('forbidden:chat');
  }

  await deleteMessagesByChatIdAfterTimestamp({
    chatId: message.chatId,
    timestamp: message.createdAt,
  });

  await saveChatState({
    chatId: message.chatId,
    memoryState: null,
    activeState: null,
    relationshipDynamics: null,
    continuityEvents: null,
  });

  await refreshChatContinuityState({
    chatId: message.chatId,
    userId: session.user.id,
  }).catch((error) => {
    logAIError('rebuild-after-delete', error);
  });

  return {
    chatId: message.chatId,
    deletedFromMessageId: id,
  };
  });
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}
