import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getMessagesByChatId } from '@/lib/db/queries';

async function main() {
  const chatId = '25cfa69b-9a1c-44bf-9a5d-fddf35a97b01';
  const messages = await getMessagesByChatId({ id: chatId });

  const storyKeywords = ['marco', 'video', 'agreement', 'rule', 'honest', 'separation', 'ring', 'engagement', 'facetime', 'motel', 'mateo', 'college', 'kiss'];

  const matches: Array<{ index: number; role: string; text: string; keywords: string[] }> = [];

  messages.forEach((m, idx) => {
    let text = '';
    if (Array.isArray(m.parts)) {
      text = m.parts.map((p: any) => p.text || '').join(' ');
    }
    const lower = text.toLowerCase();
    const foundKeywords = storyKeywords.filter(kw => lower.includes(kw));

    if (foundKeywords.length > 0) {
      matches.push({
        index: idx,
        role: m.role,
        text,
        keywords: foundKeywords,
      });
    }
  });

  console.log(`Found ${matches.length} matching messages out of ${messages.length}`);

  const outputPath = '/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/storyline_matches.json';
  fs.writeFileSync(outputPath, JSON.stringify(matches, null, 2));
  console.log('Saved storyline matches to:', outputPath);
}

main().catch(console.error);
