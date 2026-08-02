import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

const transcript = JSON.parse(
  fs.readFileSync('/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/full_transcript_226_turns.json', 'utf-8')
);

console.log('Total transcript turns:', transcript.length);

function findSegment(keyword: string) {
  return transcript.filter((t: any) => t.text.toLowerCase().includes(keyword.toLowerCase()));
}

console.log('\n--- MARCO MATCHES ---');
findSegment('marco').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));

console.log('\n--- VIDEO / EXPOSURE MATCHES ---');
findSegment('video').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));

console.log('\n--- AGREEMENT / RULE MATCHES ---');
findSegment('agreement').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));

console.log('\n--- SEPARATION / LEFT MATCHES ---');
findSegment('separation').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));

console.log('\n--- RING / ENGAGEMENT MATCHES ---');
findSegment('ring').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));

console.log('\n--- FACETIME / MOTEL MATCHES ---');
findSegment('facetime').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));

console.log('\n--- MATEO MATCHES ---');
findSegment('mateo').forEach((t: any) => console.log(`Turn ${t.turn} (${t.role}): ${t.text.slice(0, 120)}`));
