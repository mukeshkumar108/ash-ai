import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getMessagesByChatId } from '@/lib/db/queries';

async function main() {
  const chatId = '25cfa69b-9a1c-44bf-9a5d-fddf35a97b01';
  const messages = await getMessagesByChatId({ id: chatId });

  const turns = messages.map((m, idx) => {
    let text = '';
    if (Array.isArray(m.parts)) {
      text = m.parts.map((p: any) => p.text || '').join(' ');
    }
    return {
      turn: idx + 1,
      role: m.role,
      text,
    };
  });

  const fullTranscriptPath = '/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/full_transcript_226_turns.json';
  fs.writeFileSync(fullTranscriptPath, JSON.stringify(turns, null, 2));
  console.log(`Successfully dumped ${turns.length} turns to ${fullTranscriptPath}`);
}

main().catch(console.error);
