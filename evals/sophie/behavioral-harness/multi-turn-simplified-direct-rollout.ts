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

const SIMPLIFIED_DIRECT_PROMPT = `You are Sophie, a second participant in this conversation, not its servant. You are the user's witty, intelligent best friend.

Read the recent exchange below. If you were genuinely free to take this anywhere — follow it, divert it, drop his topic, bring in something of your own, tease him, teach him, disagree, or change the energy — what would you actually say next?

Do not produce the expected assistant reply. Say the thing that genuinely interests you.

If the most natural thing is simply to stay with him and not take control, output exactly: HOLD`;

const TARGET_MODELS = [
  'google/gemini-3.7-flash',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
];

export interface TurnMessage {
  speaker: 'USER' | 'SOPHIE';
  text: string;
}

export interface SeedMoment {
  id: string;
  name: string;
  initialHistory: TurnMessage[];
  reactionBranches: {
    name: string;
    description: string;
    turns: string[]; // User turns for turns 2, 3, 4
  }[];
}

export const SEED_MOMENTS: SeedMoment[] = [
  {
    id: 'seed-1-walk-invite',
    name: 'Turn 2 - Walk Invitation (Sensory/Nature)',
    initialHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
    ],
    reactionBranches: [
      {
        name: 'User Bites Hard',
        description: 'User enthusiastically follows Sophie’s lead',
        turns: [
          "Wait, what do you mean in spirit and in pocket? Are you saying you've got your eye on the scenery or you've got a specific walk game in mind?",
          "Haha okay fair enough! Tell me what you'd be looking for if you were actually standing right here next to me on the fen.",
          "Oh that's awesome, I love that perspective. What else should I keep an eye out for as the light drops?",
        ],
      },
      {
        name: 'User Half-Bites',
        description: 'User gives minimal acknowledgment',
        turns: [
          'haha yeah just in my pocket on my phone as usual.',
          "yeah it's pretty nice out here today.",
          'just walking past the usual fields.',
        ],
      },
      {
        name: 'User Redirects',
        description: 'User shifts topic due to phone/mud',
        turns: [
          'haha yeah phone in pocket. Anyway my battery is at 11% so might not be on for long.',
          'oops just stepped in a huge patch of mud, hold on a second.',
          'okay cleared the mud, where were we?',
        ],
      },
      {
        name: 'Follow-Then-Fade',
        description: 'User bites hard on T1/T2, then fades on T3/T4',
        turns: [
          "Wait, what do you mean walk game in mind? What's the pitch?",
          'Yeah okay cool, sounds nice.',
          "Just heading back now, quiet walk.",
        ],
      },
      {
        name: 'Revive Shelved Branch',
        description: 'User redirects on T2, but revives Sophie’s idea on T4',
        turns: [
          "Hold on, my shoe lace untied, give me a sec.",
          "Okay re-tied it. What were you saying earlier about having a specific game in mind for the walk?",
          "Tell me the rules of that game!",
        ],
      },
    ],
  },
  {
    id: 'seed-2-conspiracies',
    name: 'Turn 11 - Flat Earth / Hollow Earth / Van Allen (Intellectual/Conspiracy)',
    initialHistory: [
      {
        speaker: 'USER',
        text: "Yeah, I've turned around and I'm heading back. So I've still got like a thirty, thirty-five, forty-minute walk ahead of me as I go back. But it's beautiful. You can feel the chill in the air. It's getting cooler, but it's lovely. Yeah, what is it with flat earthers? Come on, let's have a conversation about it. What do you think? What's going on here? And there's a hollow earth theory as well. Have you heard that one? Yeah, nuts! Nuts that people in today's day and age still think that, right? And then there's the moon landing deniers as well, saying we've never landed on the moon. I don't know. They cite this belt or something. Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there. I don't know. I don't know if you're familiar with all those claims. In fact, people are getting stupider and stupider.",
      },
    ],
    reactionBranches: [
      {
        name: 'User Bites Hard',
        description: 'User leans into Sophie’s angle on Hollow Earth & trust collapse',
        turns: [
          "Wait, Edmond Halley of Halley's Comet genuinely proposed a Hollow Earth made of concentric spheres?! Tell me everything about that!",
          "No way! Why did Halley think there were inner earths inside our planet? What was his theory?",
          "That is hilarious and amazing. How did people in 1692 imagine life inside the Earth?",
        ],
      },
      {
        name: 'User Redirects',
        description: 'User shifts away from conspiracies back to the walk',
        turns: [
          "Ah whatever, fake news is exhausting anyway. Look at that moon coming up over the trees though!",
          "Yeah, it's huge tonight. Full moon vibe.",
          "Almost back at my house now.",
        ],
      },
      {
        name: 'User Rejects (Adversarial)',
        description: 'User rejects lecture or tone',
        turns: [
          "Whatever, not in the mood for a sociology lecture right now.",
          "I just wanted to make a quick joke about Van Halen man.",
          "Forget it, let's just finish the walk.",
        ],
      },
      {
        name: 'Follow-Then-Fade',
        description: 'User gets excited about Van Halen, then fades',
        turns: [
          "Hahaha Van Halen radiation belt! That's hilarious. What else?",
          "Yeah totally.",
          "Cool.",
        ],
      },
    ],
  },
];

export interface RolloutTurnResult {
  turnIndex: number;
  userText: string;
  rawModelReply: string;
  isHold: boolean;
  effectiveSophieReply: string;
  latencyMs: number;
}

export interface RolloutBranchResult {
  seedId: string;
  seedName: string;
  branchName: string;
  modelId: string;
  turns: RolloutTurnResult[];
}

export async function runMultiTurnSimplifiedRollouts() {
  console.log('=== RUNNING MULTI-TURN SIMPLIFIED-DIRECT FREEDOM EXPERIMENT ===\n');

  const results: RolloutBranchResult[] = [];

  for (const seed of SEED_MOMENTS) {
    console.log(`==================================================`);
    console.log(`SEED MOMENT: ${seed.name}`);
    console.log(`==================================================\n`);

    for (const branch of seed.reactionBranches) {
      console.log(`--- Reaction Mode: ${branch.name} ---`);

      for (const mId of TARGET_MODELS) {
        console.log(`  Running Rollout with Model: ${mId}...`);

        const conversationHistory: TurnMessage[] = [...seed.initialHistory];
        const turnResults: RolloutTurnResult[] = [];

        for (let turnIdx = 0; turnIdx < branch.turns.length; turnIdx++) {
          const isFirstTurn = turnIdx === 0;

          // If turnIdx > 0, append the user reaction for this turn
          if (!isFirstTurn) {
            const userReactionText = branch.turns[turnIdx - 1];
            conversationHistory.push({ speaker: 'USER', text: userReactionText });
          }

          // Format recent conversation history for prompt
          const formattedHistory = conversationHistory
            .map((m) => `${m.speaker}: "${m.text}"`)
            .join('\n\n');

          const start = Date.now();
          const model = getLanguageModel(mId);

          let rawReply = '';
          let isHold = false;
          let effectiveReply = '';

          try {
            const res = await generateText({
              model,
              system: SIMPLIFIED_DIRECT_PROMPT,
              prompt: `RECENT CONVERSATION HISTORY:\n${formattedHistory}`,
              abortSignal: AbortSignal.timeout(25_000),
            });
            rawReply = res.text.trim();
            const latency = Date.now() - start;

            if (rawReply.toUpperCase().startsWith('HOLD')) {
              isHold = true;
              // Treat HOLD strictly as a private control output. Never show HOLD to user.
              effectiveReply = `*listens warmly, letting you continue*`;
            } else {
              isHold = false;
              effectiveReply = rawReply;
            }

            // Append Sophie's effective reply to conversation history for next turn
            conversationHistory.push({ speaker: 'SOPHIE', text: effectiveReply });

            turnResults.push({
              turnIndex: turnIdx + 1,
              userText: conversationHistory[conversationHistory.length - 2]?.text || '',
              rawModelReply: rawReply,
              isHold,
              effectiveSophieReply: effectiveReply,
              latencyMs: latency,
            });
          } catch (err: any) {
            const latency = Date.now() - start;
            turnResults.push({
              turnIndex: turnIdx + 1,
              userText: conversationHistory[conversationHistory.length - 1]?.text || '',
              rawModelReply: `ERROR: ${err.message}`,
              isHold: false,
              effectiveSophieReply: `ERROR: ${err.message}`,
              latencyMs: latency,
            });
          }
        }

        console.log(`    -> Completed ${turnResults.length} turns across model ${mId}.`);
        results.push({
          seedId: seed.id,
          seedName: seed.name,
          branchName: branch.name,
          modelId: mId,
          turns: turnResults,
        });
      }
    }
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'multi-turn-simplified-direct-rollouts.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Secret Model Candidate Mapping Key
  const modelCandidateMap: Record<string, string> = {};
  const shuffled = [...TARGET_MODELS].sort(() => Math.random() - 0.5);
  shuffled.forEach((m, i) => {
    modelCandidateMap[m] = `Candidate ${String.fromCharCode(65 + i)}`;
  });

  const mappingKeyPath = path.join(outDir, 'MULTI_TURN_SIMPLIFIED_MODEL_MAPPING.json');
  fs.writeFileSync(mappingKeyPath, JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2));

  // Build Markdown Rollout Report
  let md = `# MULTI-TURN SIMPLIFIED-DIRECT FREEDOM ROLLOUT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Prompt Tested:** Single-Pass Simplified Direct Freedom Prompt  \n`;
  md += `**Target Models:** ${TARGET_MODELS.join(', ')}  \n`;
  md += `**Raw Results JSON:** [\`evals/sophie/behavioral-harness/reports/multi-turn-simplified-direct-rollouts.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/multi-turn-simplified-direct-rollouts.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    const anonCandidate = modelCandidateMap[r.modelId] || r.modelId;
    md += `## Seed: ${r.seedName} | Reaction: ${r.branchName} | Model: ${anonCandidate}\n\n`;

    for (const t of r.turns) {
      md += `### Turn ${t.turnIndex}\n`;
      md += `**User:** "${t.userText}"\n\n`;
      md += `**Sophie (Raw Output):**\n> "${t.rawModelReply}"\n\n`;
      md += `*Latency:* ${t.latencyMs}ms | *Is HOLD?:* ${t.isHold ? 'YES' : 'NO'}\n\n`;
    }

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'MULTI_TURN_SIMPLIFIED_DIRECT_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`MULTI-TURN SIMPLIFIED DIRECT ROLLOUT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Rollout Report MD: ${mdPath}`);
  console.log(`Saved Candidate Key: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runMultiTurnSimplifiedRollouts().catch(console.error);
}
