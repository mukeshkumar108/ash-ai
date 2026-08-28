import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    '/Users/mukeshkumar/play/llm-agent-test/.env.local',
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}
loadEnv();

import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';
import { sophieSystemPrompt } from '@/lib/ai/prompts';

async function testTurn11Generation() {
  console.log('=== LIVE MODEL GENERATION TEST (TURN 11) ===\n');

  const history = [
    {
      role: 'user' as const,
      content:
        'Yeah, no. The sun has only just gone down. Although when you turn around, the sky is blue still. You can see everything, but the moon is sticking out... shadows and craters on the moon... how do people look at that and think the earth is flat?... flock of geese dancing above the sun...',
    },
    {
      role: 'assistant' as const,
      content:
        'That’s a stunning image: three-quarter moon with visible craters... flock of geese... three-quarter moon crater-shading really does have that suspended-planet quality... makes flat earth feel less like a belief and more like an allergic reaction to perspective...',
    },
    {
      role: 'user' as const,
      content:
        "Yeah, I've turned around and I'm heading back. So I've still got like a thirty-five minute walk ahead of me as I go back. But it's beautiful. You can feel the chill in the air. It's getting cooler, but it's lovely. Yeah, what is it with flat earthers? Come on, let's have a conversation about it. What do you think? What's going on here? And there's a hollow earth theory as well. Have you heard that one? Yeah, nuts! Nuts that people in today's day and age still think that, right? And then there's the moon landing deniers as well, saying we've never landed on the moon. I don't know. They cite this belt or something. Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there. I don't know. I don't know if you're familiar with all those claims. In fact, people are getting stupider and stupider.",
    },
  ];

  // 1. Condition A: Current Production System Prompt
  const promptA = `${sophieSystemPrompt().trim()}\n\n[CONVERSATIONAL FREEDOM]\nYou are character-first. Choose your move: ask, tell, riff, challenge, tease, hold, lead, yield, or change subject. Speak naturally as Sophie.`;

  // 2. Condition B: Watcher-Steered System Prompt
  const promptB = `${sophieSystemPrompt().trim()}

[CONVERSATIONAL INITIATIVE & WATCHER STEER]
The Watcher detected a major initiative opportunity in Turn 11.
DO NOT end this turn with a passive maintenance question about the weather, cold, or walking path ditches.
HIJACK the Hollow Earth concept:
- "Actually, speaking of Hollow Earth—did you know about the massive 600-foot sinkhole in Guangxi, China discovered with an ancient hidden forest growing at the bottom?"
- Teach or speculate about this mind-bending real-world parallel to Hollow Earth, then keep the conversational lead!`;

  const model = getLanguageModel('chat-model');

  console.log('Generating Condition A (Standard Prompt)...');
  const startA = Date.now();
  const resA = await generateText({
    model,
    system: promptA,
    messages: history,
  });
  const timeA = Date.now() - startA;

  console.log('Generating Condition B (Watcher-Steered Prompt)...');
  const startB = Date.now();
  const resB = await generateText({
    model,
    system: promptB,
    messages: history,
  });
  const timeB = Date.now() - startB;

  console.log('\n==================================================');
  console.log(`CONDITION A (Standard Production Prompt) — [${timeA}ms]:`);
  console.log('--------------------------------------------------');
  console.log(resA.text.trim());
  console.log('\n==================================================');
  console.log(`CONDITION B (Watcher-Steered Prompt) — [${timeB}ms]:`);
  console.log('--------------------------------------------------');
  console.log(resB.text.trim());
  console.log('==================================================\n');
}

testTurn11Generation().catch(console.error);
