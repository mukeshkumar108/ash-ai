import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getMessagesByChatId } from '@/lib/db/queries';

async function main() {
  const chatId = '25cfa69b-9a1c-44bf-9a5d-fddf35a97b01';
  const messages = await getMessagesByChatId({ id: chatId });

  console.log(`Total messages retrieved: ${messages.length}`);

  const summary = messages.map((m, index) => {
    let text = '';
    if (Array.isArray(m.parts)) {
      text = m.parts.map((p: any) => p.text || '').join(' ');
    }
    return {
      index,
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
      snippet: text.slice(0, 100).replace(/\n/g, ' '),
      length: text.length,
    };
  });

  const summaryPath = '/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/messages_summary.json';
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log('Saved message summary to:', summaryPath);
}

main().catch(console.error);
