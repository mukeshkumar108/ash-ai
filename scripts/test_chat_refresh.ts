import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { refreshChatContinuityState } from '@/lib/ai/chat-continuity';

async function main() {
  const chatId = '25cfa69b-9a1c-44bf-9a5d-fddf35a97b01';
  const chat = await getChatById({ id: chatId });

  console.log('Testing refreshChatContinuityState on chat:', chatId);
  console.log('User ID:', chat?.userId);

  if (!chat) {
    console.error('Chat not found!');
    return;
  }

  const result = await refreshChatContinuityState({
    chatId,
    userId: chat.userId,
  });

  console.log('=== REFRESH RESULT ===');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
