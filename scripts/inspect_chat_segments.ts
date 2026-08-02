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
    return { turn: idx + 1, role: m.role, text };
  });

  // Search key phrases for each of the 7 segments
  console.log('=== SEARCHING FOR SEGMENT 1: Marco & Exposure Video ===');
  turns.filter(t => /marco|exposure|video/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));

  console.log('\n=== SEARCHING FOR SEGMENT 2: Outside-partner agreement & honesty rule ===');
  turns.filter(t => /agreement|rule|honest|partner|outside/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));

  console.log('\n=== SEARCHING FOR SEGMENT 3: Withholding & Kai leaving ===');
  turns.filter(t => /left|leaving|withheld|withholding|walked out|door/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));

  console.log('\n=== SEARCHING FOR SEGMENT 4: Weeks of separation & financial consequences ===');
  turns.filter(t => /weeks|separation|lease|rent|money|financial|apartment/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));

  console.log('\n=== SEARCHING FOR SEGMENT 5: Confession & engagement-ring ===');
  turns.filter(t => /ring|engagement|pawned|confess/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));

  console.log('\n=== SEARCHING FOR SEGMENT 6: Motel FaceTime sequence ===');
  turns.filter(t => /facetime|motel|camera|call/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));

  console.log('\n=== SEARCHING FOR SEGMENT 7: Final Mateo discussion ===');
  turns.filter(t => /mateo/i.test(t.text)).forEach(t => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 150)}...`));
}

main().catch(console.error);
