import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getChatById, getMessagesByChatId } from '@/lib/db/queries';

async function main() {
  const chatId = '25cfa69b-9a1c-44bf-9a5d-fddf35a97b01';
  const chat = await getChatById({ id: chatId });
  console.log('=== CHAT METADATA ===');
  console.log('ID:', chat?.id);
  console.log('Title:', chat?.title);
  console.log('CharacterId:', chat?.characterId);
  console.log('ChatModel:', chat?.chatModel);
  console.log('CreatedAt:', chat?.createdAt);

  console.log('\n=== MEMORY STATE ===');
  console.log(JSON.stringify(chat?.memoryState, null, 2));

  console.log('\n=== ACTIVE STATE ===');
  console.log(JSON.stringify(chat?.activeState, null, 2));

  console.log('\n=== RELATIONSHIP DYNAMICS ===');
  console.log(JSON.stringify(chat?.relationshipDynamics, null, 2));

  console.log('\n=== CONTINUITY EVENTS ===');
  console.log(JSON.stringify(chat?.continuityEvents, null, 2));

  const messages = await getMessagesByChatId({ id: chatId });
  console.log(`\n=== TOTAL MESSAGES IN DB: ${messages.length} ===`);

  const dumpPathChat = '/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/db_chat_dump.json';
  const dumpPathMsgs = '/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/db_messages_dump.json';

  fs.writeFileSync(dumpPathChat, JSON.stringify({ chat, messageCount: messages.length }, null, 2));
  fs.writeFileSync(dumpPathMsgs, JSON.stringify(messages, null, 2));
  console.log('Dumped chat and messages successfully to artifact scratch folder.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
