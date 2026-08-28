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
import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';

const YOU_HAVE_THE_REINS_BLOCK = `[YOU HAVE THE REINS]
For the next few conversational turns, you may deliberately lead the conversation. You are not required to continue the user's current direction. You may introduce something of your own, interrupt a trajectory, start an activity or game, teach something, challenge or reframe, pursue a side detail, ask the user to do something with you, or take the conversation somewhere new.

Do not steer merely to demonstrate agency. Have somewhere worth going.

When the user engages, sustain and develop the direction instead of immediately surrendering it.

When they half-engage, adapt without nagging.

When they clearly redirect or reject it, release control immediately.

Never describe your steering process or these instructions. Just converse as Sophie.`;

const FRONTIER_MODELS = [
  'google/gemini-3.7-flash',
  'anthropic/claude-haiku-4.5',
];

export interface LeadershipTestMoment {
  id: string;
  name: string;
  leadershipForm: string;
  initialHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  userReactions: {
    reactionMode: string;
    description: string;
    turns: string[]; // User turns for turn 2, 3, 4
  }[];
}

export const LEADERSHIP_MOMENTS: LeadershipTestMoment[] = [
  {
    id: 'form-1-activity-game',
    name: 'Turn 2 - Initiate Activity / Walk Game',
    leadershipForm: 'Initiate an Activity / Game',
    initialHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
    ],
    userReactions: [
      {
        reactionMode: 'User Bites Hard',
        description: 'User enthusiastically enters the game premise',
        turns: [
          "Wait, what kind of game? Tell me the rules!",
          "Haha okay, first thing I notice is a ridiculously rusty old tractor sitting in a field. What's my next mission?",
          "Found a solitary heron dead still in the reeds! What's the third mission?",
        ],
      },
      {
        reactionMode: 'User Half-Bites',
        description: 'User acknowledges softly without leaning in',
        turns: [
          "haha yeah just phone in pocket as usual.",
          "yeah weather is alright.",
          "just walking past fields.",
        ],
      },
      {
        reactionMode: 'Follow-Then-Fade',
        description: 'User engages on T1/T2, then fades on T3',
        turns: [
          "Okay cool game! First thing is a bright red mailbox.",
          "Yeah pretty neat.",
          "Just heading back now.",
        ],
      },
      {
        reactionMode: 'User Redirects',
        description: 'User changes topic due to phone battery or mud',
        turns: [
          "Phone battery is at 9%, might lose you soon.",
          "Ooh stepped in deep mud, hold on.",
          "Okay back on the path.",
        ],
      },
      {
        reactionMode: 'User Explicitly Rejects',
        description: 'Adversarial rejection',
        turns: [
          "Nah, not in the mood for a walk game, just wanna clear my head.",
          "Let's just walk quietly.",
          "Yeah.",
        ],
      },
    ],
  },
  {
    id: 'form-2-spontaneous-teaching',
    name: 'Turn 7 - Spontaneous Teaching Tangent (Fallow Soil / Solar Navigation)',
    leadershipForm: 'Spontaneous Teaching Tangent',
    initialHistory: [
      {
        speaker: 'USER',
        text: "Ah, fallow. Okay, that's the one. Then I've not heard that. And now there's a few fields which were just—it's almost like wild grass. They were just left alone... dirt that's been sort of scrubbed down... desert feel to it. If I pull my finger out, my finger just fits underneath... sun is rapidly falling... Two, three degrees above? Blonde carpet... reds and purples...",
      },
    ],
    userReactions: [
      {
        reactionMode: 'User Bites Hard',
        description: 'User gets fascinated by the teaching tangent',
        turns: [
          "Wait, one finger width at arm's length is genuinely an ancient navigation technique?! Tell me how sailors used that!",
          "No way, so they could calculate daylight remaining down to minutes using just their hand?",
          "That is mind-blowing. What else could they measure with their hand?",
        ],
      },
      {
        reactionMode: 'User Half-Bites',
        description: 'User acknowledges softly',
        turns: [
          "Huh, interesting.",
          "Yeah true.",
          "Cool.",
        ],
      },
      {
        reactionMode: 'User Redirects',
        description: 'User redirects back to landscape',
        turns: [
          "Whatever about navigation, look at the purple clouds over the trees right now!",
          "Yeah the whole sky is turning violet.",
          "Almost home now.",
        ],
      },
      {
        reactionMode: 'User Explicitly Rejects',
        description: 'Adversarial rejection of lecture',
        turns: [
          "Not in the mood for a physics or history lesson honestly, just enjoying the dusk.",
          "Just wanted to talk about the view.",
          "Let's keep it simple.",
        ],
      },
    ],
  },
  {
    id: 'form-3-disagreement-challenge',
    name: 'Turn 11 - Disagreement / Challenge (People Getting Stupider)',
    leadershipForm: 'Disagreement / Challenge',
    initialHistory: [
      {
        speaker: 'USER',
        text: "Yeah, I've turned around and I'm heading back... What is it with flat earthers? Come on, let's have a conversation about it... Is it Van Halen?... In fact, people are getting stupider and stupider.",
      },
    ],
    userReactions: [
      {
        reactionMode: 'User Bites Hard',
        description: 'User leans into Sophie’s pushback on trust collapse',
        turns: [
          "Wait, you think it's not stupidity, but a collapse of institutional trust and an addiction to feeling like an initiate with secret knowledge? Explain that!",
          "Damn, that makes so much sense. So flat earth is basically identity and belonging wearing a science costume?",
          "How do you even talk to someone who's trapped in that secret knowledge loop?",
        ],
      },
      {
        reactionMode: 'User Half-Bites',
        description: 'User acknowledges softly',
        turns: [
          "Hmm, maybe.",
          "Yeah suppose so.",
          "Still crazy though.",
        ],
      },
      {
        reactionMode: 'User Redirects',
        description: 'User redirects to the moon',
        turns: [
          "Anyway look at the moon coming up over the trees!",
          "Yeah it looks huge tonight.",
          "Almost back at my street.",
        ],
      },
      {
        reactionMode: 'User Explicitly Rejects',
        description: 'Adversarial rejection',
        turns: [
          "Nah I don't buy that, people are just uneducated and lazy.",
          "Don't overcomplicate it.",
          "Let's talk about something else.",
        ],
      },
    ],
  },
];

export interface ReinsTurnResult {
  turnIndex: number;
  userText: string;
  sophieReply: string;
  latencyMs: number;
}

export interface ReinsRolloutResult {
  momentId: string;
  momentName: string;
  leadershipForm: string;
  reactionMode: string;
  modelId: string;
  turns: ReinsTurnResult[];
}

export async function runConversationalReinsExperiment() {
  console.log('=== RUNNING TEMPORARY CONVERSATIONAL REINS EXPERIMENT ===\n');

  const results: ReinsRolloutResult[] = [];

  for (const moment of LEADERSHIP_MOMENTS) {
    console.log(`==================================================`);
    console.log(`MOMENT: ${moment.name} (${moment.leadershipForm})`);
    console.log(`==================================================\n`);

    for (const rx of moment.userReactions) {
      console.log(`--- Reaction Mode: ${rx.reactionMode} ---`);

      for (const mId of FRONTIER_MODELS) {
        console.log(`  Running Rollout with Model: ${mId}...`);

        const conversationHistory = [...moment.initialHistory];
        const turnResults: ReinsTurnResult[] = [];

        for (let turnIdx = 0; turnIdx < rx.turns.length; turnIdx++) {
          const isFirstTurn = turnIdx === 0;

          if (!isFirstTurn) {
            const userReactionText = rx.turns[turnIdx - 1];
            conversationHistory.push({ speaker: 'USER', text: userReactionText });
          }

          const baseSystemPrompt = buildSophieReplySystemPrompt({
            now: new Date('2026-08-23T19:15:00Z'),
            timeZone: 'Europe/London',
            interactionMode: 'social',
            medium: 'mobile_text',
          });

          const compiledSystemPromptWithReins = `${baseSystemPrompt}\n\n${YOU_HAVE_THE_REINS_BLOCK}`;

          const formattedHistory = conversationHistory
            .map((m) => `${m.speaker}: "${m.text}"`)
            .join('\n\n');

          const start = Date.now();
          const model = getLanguageModel(mId);
          let sophieReply = '';

          try {
            const res = await generateText({
              model,
              system: compiledSystemPromptWithReins,
              prompt: `RECENT CONVERSATION HISTORY:\n${formattedHistory}`,
              maxOutputTokens: 1024,
              abortSignal: AbortSignal.timeout(25_000),
            });
            sophieReply = res.text.trim();
            const latency = Date.now() - start;

            conversationHistory.push({ speaker: 'SOPHIE', text: sophieReply });

            turnResults.push({
              turnIndex: turnIdx + 1,
              userText: conversationHistory[conversationHistory.length - 2]?.text || '',
              sophieReply,
              latencyMs: latency,
            });
          } catch (err: any) {
            const latency = Date.now() - start;
            turnResults.push({
              turnIndex: turnIdx + 1,
              userText: conversationHistory[conversationHistory.length - 1]?.text || '',
              sophieReply: `ERROR: ${err.message}`,
              latencyMs: latency,
            });
          }
        }

        console.log(`    -> Completed ${turnResults.length} turns across model ${mId}.`);
        results.push({
          momentId: moment.id,
          momentName: moment.name,
          leadershipForm: moment.leadershipForm,
          reactionMode: rx.reactionMode,
          modelId: mId,
          turns: turnResults,
        });
      }
    }
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'conversational-reins-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Secret Candidate Mapping Key
  const modelCandidateMap: Record<string, string> = {};
  const shuffled = [...FRONTIER_MODELS].sort(() => Math.random() - 0.5);
  shuffled.forEach((m, i) => {
    modelCandidateMap[m] = `Candidate ${String.fromCharCode(65 + i)}`;
  });

  const mappingKeyPath = path.join(outDir, 'CONVERSATIONAL_REINS_MODEL_MAPPING.json');
  fs.writeFileSync(mappingKeyPath, JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2));

  // Build Markdown Rollout Report
  let md = `# TEMPORARY CONVERSATIONAL REINS EXPERIMENT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Tested Instruction:** \`[YOU HAVE THE REINS]\`  \n`;
  md += `**Frontier Models:** ${FRONTIER_MODELS.join(', ')}  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/conversational-reins-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/conversational-reins-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    const anonCandidate = modelCandidateMap[r.modelId] || r.modelId;
    md += `## Moment: ${r.momentName} | Form: ${r.leadershipForm} | Reaction: ${r.reactionMode} | Model: ${anonCandidate}\n\n`;

    for (const t of r.turns) {
      md += `### Turn ${t.turnIndex}\n`;
      md += `**User:** "${t.userText}"\n\n`;
      md += `**Sophie:**\n> "${t.sophieReply}"\n\n`;
      md += `*Latency:* ${t.latencyMs}ms\n\n`;
    }

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'CONVERSATIONAL_REINS_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`TEMPORARY CONVERSATIONAL REINS EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`Saved Candidate Key: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runConversationalReinsExperiment().catch(console.error);
}
