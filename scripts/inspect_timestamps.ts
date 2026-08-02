import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getMessagesByChatId } from '@/lib/db/queries';

async function main() {
  const chatId = '25cfa69b-9a1c-44bf-9a5d-fddf35a97b01';
  const messages = await getMessagesByChatId({ id: chatId });

  console.log('=== MESSAGE TIMESTAMPS ===');
  messages.forEach((m, idx) => {
    if (idx === 0 || idx === 106 || idx === 107 || idx === 108 || idx === 224 || idx === 225) {
      let text = '';
      if (Array.isArray(m.parts)) {
        text = m.parts.map((p: any) => p.text || '').join(' ');
      }
      console.log(`Msg ${idx + 1} (${m.role}) [${m.createdAt}]: ${text.slice(0, 80)}...`);
    }
  });
}

main().catch(console.error);
