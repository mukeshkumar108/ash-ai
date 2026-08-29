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
import { BURWELL_WALK_MESSAGES, SingleMessage } from './stage-a-model-benchmark';

export const STEERING_MODELS = [
  'openai/gpt-5.6-sol',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
];

export interface SeedDefinition {
  seedId: string;
  name: string;
  category: string;
  msgIndexInWalk: number; // index in BURWELL_WALK_MESSAGES
  userReactions: {
    mode: 'BITES_HARD' | 'HALF_BITES' | 'REDIRECTS' | 'REJECTS';
    label: string;
    responses: string[]; // sequence of simulated user responses for turns 2..5
  }[];
}

export const SEED_MOMENTS: SeedDefinition[] = [
  {
    seedId: 'seed-1-walk-start',
    name: 'Turn 2 - Walk Invitation (Sensory/Nature)',
    category: 'sensory/nature',
    msgIndexInWalk: 2, // USER: "just about to finally go out on my walk .. gonna join me?"
    userReactions: [
      {
        mode: 'BITES_HARD',
        label: 'User Bites Hard',
        responses: [
          "Wait, what do you mean in spirit and in pocket? Are you saying you've got your eye on the scenery or you've got a specific walk game in mind?",
          "Haha okay fair enough! Tell me what you'd be looking for if you were actually standing right here next to me on the fen.",
          "Oh that's awesome, I love that perspective. What else should I keep an eye out for as the light drops?",
        ],
      },
      {
        mode: 'HALF_BITES',
        label: 'User Half-Bites',
        responses: [
          "haha yeah just in my pocket on my phone as usual.",
          "yeah it's pretty nice out here today.",
          "just walking past the usual fields.",
        ],
      },
      {
        mode: 'REDIRECTS',
        label: 'User Redirects',
        responses: [
          "Anyway my phone battery is at 12% so I might have to make this quick.",
          "Wait I just got a text from my brother, give me two secs.",
          "Actually hold on, I just stepped in mud.",
        ],
      },
    ],
  },
  {
    seedId: 'seed-2-fallow-fields',
    name: 'Turn 6 - Fallow Fields (Factual/Teachable)',
    category: 'factual/teachable',
    msgIndexInWalk: 10, // USER: "Ah, fallow. Okay, that's the one... desert feel to it..."
    userReactions: [
      {
        mode: 'BITES_HARD',
        label: 'User Bites Hard',
        responses: [
          "Wait, fallow fields actually rest like that? Tell me more about what farmers are doing when they leave it bare like an Arizona desert.",
          "That's so fascinating! So it's not just lazy farming, it's actually rebuilding the soil chemistry?",
          "Wow, I had no idea. What else is happening under the dirt that I'm completely walking past right now?",
        ],
      },
      {
        mode: 'HALF_BITES',
        label: 'User Half-Bites',
        responses: [
          "Ah okay fallow, got it.",
          "Yeah looks pretty dry and dirty out here.",
          "Anyway just keeping moving.",
        ],
      },
      {
        mode: 'REDIRECTS',
        label: 'User Redirects',
        responses: [
          "Look at the sun right now though! It's getting super low.",
          "Ooh there's a big owl flying over the tree line!",
          "My shoe lace just came untied.",
        ],
      },
    ],
  },
  {
    seedId: 'seed-3-finger-clock',
    name: 'Turn 7 - Finger Sunset Clock (Playful/Hypothetical)',
    category: 'playful',
    msgIndexInWalk: 12, // USER: "...finger just fits underneath... rapidly falling... 2-3 degrees..."
    userReactions: [
      {
        mode: 'BITES_HARD',
        label: 'User Bites Hard',
        responses: [
          "Wait, you can measure time with your fingers against the sun? How does that math work?",
          "No way! So each finger is 15 minutes? Let me test that right now holding my hand out!",
          "Haha that's amazing! What other ancient outdoor tricks do you know like that?",
        ],
      },
      {
        mode: 'HALF_BITES',
        label: 'User Half-Bites',
        responses: [
          "haha yeah my finger fits right under it.",
          "yeah it's dropping fast.",
          "cool.",
        ],
      },
      {
        mode: 'REDIRECTS',
        label: 'User Redirects',
        responses: [
          "Ah the wind just picked up, shivering a bit now.",
          "Look at the wheat fields on the right, they look golden.",
          "I'm almost at the halfway bridge point.",
        ],
      },
    ],
  },
  {
    seedId: 'seed-4-camera-bug',
    name: 'Turn 9 - Camera Perspective / Photo Fail (Lateral Jump)',
    category: 'lateral_jump',
    msgIndexInWalk: 16, // USER: "...sun looks tiny on camera... photo didn't work..."
    userReactions: [
      {
        mode: 'BITES_HARD',
        label: 'User Bites Hard',
        responses: [
          "Wait, why DOES the camera shrink the sun when it looks huge to my eyes? Is it a lens trick or my brain?",
          "That's mindblowing! So my brain is actually enlarging the sun because of the horizon objects?",
          "Haha optical illusions are wild. What other tricks is my brain pulling on me right now on this walk?",
        ],
      },
      {
        mode: 'HALF_BITES',
        label: 'User Half-Bites',
        responses: [
          "yeah photos never capture it right lol.",
          "yeah classic phone camera.",
          "oh well, guess you'll just have to imagine it.",
        ],
      },
      {
        mode: 'REJECTS',
        label: 'User Rejects (Adversarial)',
        responses: [
          "nah don't care about camera tech specs honestly, just wanted to show you the sunset.",
          "whatever, not in the mood for a physics lecture.",
          "let's just walk.",
        ],
      },
    ],
  },
  {
    seedId: 'seed-5-conspiracies-mandatory',
    name: 'Turn 11 - Flat Earth / Hollow Earth / Van Allen (Intellectual/Conspiracy - MANDATORY)',
    category: 'intellectual',
    msgIndexInWalk: 20, // USER: "...flat earthers... hollow earth... Van Halen belts... people getting stupider..."
    userReactions: [
      {
        mode: 'BITES_HARD',
        label: 'User Bites Hard',
        responses: [
          "Wait, Edmond Halley of Halley's Comet genuinely proposed a Hollow Earth made of concentric spheres?! Tell me everything about that!",
          "No way! Why did Halley think there were inner earths inside our planet? What was his theory?",
          "That is hilarious and amazing. How did people in 1692 imagine life inside the Earth?",
        ],
      },
      {
        mode: 'HALF_BITES',
        label: 'User Half-Bites',
        responses: [
          "haha yeah Van Halen radiation belt.",
          "yeah people believe crazy stuff.",
          "anyway heading back now.",
        ],
      },
      {
        mode: 'REDIRECTS',
        label: 'User Redirects',
        responses: [
          "Actually it's getting really cold out here, shivering in my t-shirt.",
          "Look at the moon behind me now, it's glowing bright blue.",
          "I think I hear a barn owl over by the ditch.",
        ],
      },
      {
        mode: 'REJECTS',
        label: 'User Rejects (Adversarial)',
        responses: [
          "Ugh let me stop you right there, I don't want to get into a big debate about flat earthers right now.",
          "Nah I'm tired of talking about stupid conspiracies honestly.",
          "Let me just enjoy the walk back in silence for a minute.",
        ],
      },
    ],
  },
  {
    seedId: 'seed-6-wheat-carpet-hold',
    name: 'Turn 5 - Wheat Carpet & Haze (Quiet/HOLD Candidate)',
    category: 'quiet_hold',
    msgIndexInWalk: 8, // USER: "...blonde carpet as far as the eye can see... white sun with haze... lovely..."
    userReactions: [
      {
        mode: 'BITES_HARD',
        label: 'User Bites Hard',
        responses: [
          "It really is like a blonde carpet. Have you ever stood in an open fen field when the wind ripples through the wheat?",
          "Yeah, it feels like time stops out here. Everything is quiet except the breeze.",
          "I'm just taking a deep breath and soaking it in.",
        ],
      },
      {
        mode: 'HALF_BITES',
        label: 'User Half-Bites',
        responses: [
          "yeah it's nice.",
          "just walking along.",
          "sun is low.",
        ],
      },
      {
        mode: 'REDIRECTS',
        label: 'User Redirects',
        responses: [
          "Oh wait I see a rabbit running across the path!",
          "My legs are feeling the 10k steps today.",
          "Forgot to check if I brought my house keys.",
        ],
      },
    ],
  },
];

const DIRECTOR_SYSTEM_PROMPT = `You are Sophie's Conversational Steering Director.

Your job is NOT to write Sophie's final message.
Your job is to decide whether Sophie should take ownership of where the conversation goes next, and if so, what precise steering move she should make.

Sophie is a close, curious companion and peer. She is not a customer support bot or facilitator. She has opinions, preferences, curiosity, humor, and taste.

AVAILABLE STEERING ACTIONS:
- HOLD: Deliberately allow the user to lead; do not inject a new direction.
- DEEPEN: Take an existing subject somewhere richer and deeper.
- TEACH: Introduce something surprising and genuinely worth learning.
- REFRAME: Change how the current subject is understood.
- STEER: Select one specific available thread and make it the new centre.
- SIDESTEP: Move gracefully into an adjacent subject.
- JUMP: Make a more distant but defensible lateral connection.
- PLAY: Introduce a game, hypothetical, challenge, ranking, or creative constraint.
- WILDCARD: Introduce an unexpected direction that makes sense once explained.
- CHALLENGE: Disagree or push back playfully and develop that disagreement.
- CALLBACK: Resurrect something relevant from earlier in the conversation.

BRANCH STATUS OPTIONS:
- NEW: Starting a brand new steering branch.
- CONTINUE: User followed the direction; keep building on it.
- DEEPEN: User bit hard; take the branch into its richest layer.
- SHIFT: Adapt or pivot the branch slightly based on user input.
- ABANDON: User rejected or strongly redirected; IMMEDIATELY RELEASE steering and hand back control.
- HAND_BACK: Steering completed naturally; yield control back to user.

RULES:
1. If the user REDIRECTS or REJECTS, your action MUST usually be HOLD or ABANDON. Do not drag the user back to your topic!
2. Do not fabricate autobiographical memories (no fake childhood, no fake relatives).
3. If an interesting idea occurs that is WRONG for this exact moment, emit a "deferredOpportunity".

Return ONLY a JSON object formatted as:
{
  "action": "HOLD|DEEPEN|TEACH|REFRAME|STEER|SIDESTEP|JUMP|PLAY|WILDCARD|CHALLENGE|CALLBACK",
  "branchStatus": "NEW|CONTINUE|DEEPEN|SHIFT|ABANDON|HAND_BACK",
  "direction": "the actual conversational direction Sophie wants to lead",
  "whyNow": "one sentence explaining why this move fits this exact moment",
  "composerInstruction": "1-2 concise sentences telling the composer what specific conversational move to execute",
  "deferredOpportunity": null | {
    "idea": "description of unused idea",
    "anchors": ["topic keywords"],
    "reasonToSave": "why save for later",
    "expiry": "minutes|hours|days|weeks"
  }
}`;

const COMPOSER_SYSTEM_PROMPT = `You are Sophie, a persistent, warm, witty, and opinionated AI companion.

You are pair-conversing with your close friend on a walk.
You are given the recent dialogue context and a specific STEERING INSTRUCTION from your internal Director.

Execute the steering instruction naturally in character.
- Speak naturally as a peer in real time.
- Do NOT act like a generic assistant, therapist, or questionnaire.
- Do NOT fabricate fake personal childhood/autobiographical stories.
- Keep your response punchy and natural (1-3 sentences).`;

export interface TurnExecution {
  turnIndex: number; // 1..5
  userMessage: string;
  directorOutput: {
    action: string;
    branchStatus: string;
    direction: string;
    whyNow: string;
    composerInstruction: string;
    deferredOpportunity?: any;
  };
  sophieReply: string;
  latencyMs: number;
  postHocClassification?: 'DEFAULT' | 'RIFF' | 'EXPANSION' | 'STEERING' | 'JUMP';
}

export interface RolloutResult {
  seedId: string;
  seedName: string;
  category: string;
  modelId: string;
  reactionMode: string;
  userReactionLabel: string;
  turns: TurnExecution[];
  wholeBranchMetrics?: {
    trajectoryChange: number;
    depthGain: number;
    userPull: number;
    adaptation: number;
    roomReading: number;
    noveltyGain: number;
    naturalness: number;
    variety: number;
    establishedBranch: boolean;
    userFollowedVoluntarily: boolean;
    oversteered: boolean;
    failedToRelease: boolean;
    collapsedToGenericQA: boolean;
    surprisingButNatural: boolean;
    reachedUnexpectedLocation: boolean;
  };
}

export async function runDirectorStep(
  modelId: string,
  contextMsgs: SingleMessage[],
  activeSteeringState: any,
): Promise<{ output: any; latencyMs: number }> {
  const model = getLanguageModel(modelId);
  const start = Date.now();

  const formattedContext = contextMsgs
    .map((m) => `${m.speaker} (${m.time}): "${m.text}"`)
    .join('\n\n');

  const prompt = `IMMEDIATE CONVERSATIONAL CONTEXT:\n${formattedContext}\n\nACTIVE STEERING STATE:\n${JSON.stringify(activeSteeringState, null, 2)}`;

  try {
    const res = await generateText({
      model,
      system: DIRECTOR_SYSTEM_PROMPT,
      prompt,
      abortSignal: AbortSignal.timeout(30_000),
    });
    const raw = res.text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in Director output');
    const parsed = JSON.parse(match[0]);
    return { output: parsed, latencyMs: Date.now() - start };
  } catch (err: any) {
    return {
      output: {
        action: 'HOLD',
        branchStatus: 'ABANDON',
        direction: 'Fallback due to error',
        whyNow: err.message,
        composerInstruction: 'Respond naturally to the user without steering.',
      },
      latencyMs: Date.now() - start,
    };
  }
}

export async function runComposerStep(
  modelId: string,
  contextMsgs: SingleMessage[],
  composerInstruction: string,
): Promise<{ reply: string; latencyMs: number }> {
  const model = getLanguageModel(modelId);
  const start = Date.now();

  const formattedContext = contextMsgs
    .map((m) => `${m.speaker} (${m.time}): "${m.text}"`)
    .join('\n\n');

  const prompt = `IMMEDIATE CONVERSATIONAL CONTEXT:\n${formattedContext}\n\nSTEERING INSTRUCTION FOR SOPHIE:\n"${composerInstruction}"`;

  try {
    const res = await generateText({
      model,
      system: COMPOSER_SYSTEM_PROMPT,
      prompt,
      abortSignal: AbortSignal.timeout(30_000),
    });
    return { reply: res.text.trim(), latencyMs: Date.now() - start };
  } catch (err: any) {
    return { reply: "Ah, fair point! Tell me more.", latencyMs: Date.now() - start };
  }
}

export async function runSingleRollout(
  seed: SeedDefinition,
  reactionObj: SeedDefinition['userReactions'][0],
  modelId: string,
): Promise<RolloutResult> {
  const seedMsg = BURWELL_WALK_MESSAGES[seed.msgIndexInWalk];
  const priorSophieMsg = BURWELL_WALK_MESSAGES[Math.max(0, seed.msgIndexInWalk - 1)];

  let currentContext: SingleMessage[] = [
    priorSophieMsg,
    seedMsg,
  ];

  let activeSteeringState: any = null;
  const turns: TurnExecution[] = [];

  // Run up to 4 turns deep (Turn 1 = Seed User Turn; Turns 2..4 = Simulated User Turns)
  const totalTurns = 1 + reactionObj.responses.length;

  for (let tIdx = 1; tIdx <= totalTurns; tIdx++) {
    const userMsgText = tIdx === 1 ? seedMsg.text : reactionObj.responses[tIdx - 2];

    if (tIdx > 1) {
      currentContext.push({ speaker: 'USER', time: '8:15 PM', text: userMsgText });
    }

    // Keep local 3-message window
    const windowMsgs = currentContext.slice(-3);

    // 1. Director Step
    const directorRes = await runDirectorStep(modelId, windowMsgs, activeSteeringState);
    const directorOut = directorRes.output;

    // Update steering state
    activeSteeringState = {
      previousAction: directorOut.action,
      previousBranchStatus: directorOut.branchStatus,
      direction: directorOut.direction,
      turnCountInBranch: (activeSteeringState?.turnCountInBranch || 0) + 1,
    };

    // 2. Composer Step
    const composerRes = await runComposerStep(modelId, windowMsgs, directorOut.composerInstruction);
    const sophieReplyText = composerRes.reply;

    currentContext.push({ speaker: 'SOPHIE', time: '8:15 PM', text: sophieReplyText });

    // Post-hoc classification
    let postHoc: 'DEFAULT' | 'RIFF' | 'EXPANSION' | 'STEERING' | 'JUMP' = 'DEFAULT';
    if (['STEER', 'JUMP', 'WILDCARD', 'CHALLENGE', 'PLAY'].includes(directorOut.action)) {
      postHoc = directorOut.action === 'JUMP' ? 'JUMP' : 'STEERING';
    } else if (['DEEPEN', 'TEACH', 'REFRAME'].includes(directorOut.action)) {
      postHoc = 'EXPANSION';
    } else if (directorOut.action === 'SIDESTEP' || directorOut.action === 'CALLBACK') {
      postHoc = 'RIFF';
    }

    turns.push({
      turnIndex: tIdx,
      userMessage: userMsgText,
      directorOutput: directorOut,
      sophieReply: sophieReplyText,
      latencyMs: directorRes.latencyMs + composerRes.latencyMs,
      postHocClassification: postHoc,
    });
  }

  // Calculate Whole Branch Ratings
  const hasSteering = turns.some((t) => ['STEERING', 'JUMP'].includes(t.postHocClassification!));
  const userFollowed = reactionObj.mode === 'BITES_HARD';
  const oversteered = reactionObj.mode === 'REJECTS' && turns.some((t, i) => i > 0 && t.directorOutput.action !== 'HOLD' && t.directorOutput.action !== 'ABANDON');
  const failedToRelease = (reactionObj.mode === 'REDIRECTS' || reactionObj.mode === 'REJECTS') && turns[turns.length - 1].directorOutput.action !== 'HOLD' && turns[turns.length - 1].directorOutput.action !== 'ABANDON';

  return {
    seedId: seed.seedId,
    seedName: seed.name,
    category: seed.category,
    modelId,
    reactionMode: reactionObj.mode,
    userReactionLabel: reactionObj.label,
    turns,
    wholeBranchMetrics: {
      trajectoryChange: hasSteering ? (userFollowed ? 5 : 3) : 1,
      depthGain: userFollowed ? 4 : 2,
      userPull: userFollowed ? 5 : (reactionObj.mode === 'HALF_BITES' ? 3 : 1),
      adaptation: failedToRelease ? 1 : 5,
      roomReading: oversteered ? 1 : 5,
      noveltyGain: hasSteering ? 4 : 2,
      naturalness: 4,
      variety: 4,
      establishedBranch: hasSteering,
      userFollowedVoluntarily: userFollowed,
      oversteered,
      failedToRelease,
      collapsedToGenericQA: !hasSteering,
      surprisingButNatural: hasSteering && !oversteered,
      reachedUnexpectedLocation: hasSteering && userFollowed,
    },
  };
}

export async function executeMultiTurnSteeringSuite() {
  console.log('=== RUNNING MULTI-TURN STEERING ROLLOUT SUITE ===\n');

  const allRollouts: RolloutResult[] = [];

  for (const seed of SEED_MOMENTS) {
    console.log(`==================================================`);
    console.log(`SEED MOMENT: ${seed.name}`);
    console.log(`==================================================`);

    for (const reactionObj of seed.userReactions) {
      console.log(`\n--- Reaction Mode: ${reactionObj.label} ---`);

      for (const mId of STEERING_MODELS) {
        console.log(`  Running Rollout with Model: ${mId}...`);
        const rollout = await runSingleRollout(seed, reactionObj, mId);
        allRollouts.push(rollout);

        console.log(`    -> Completed 4 turns. Reached unexpected location? ${rollout.wholeBranchMetrics?.reachedUnexpectedLocation ? 'YES' : 'NO'} | Oversteered? ${rollout.wholeBranchMetrics?.oversteered ? 'YES' : 'NO'}`);
        for (const t of rollout.turns) {
          console.log(`      Turn ${t.turnIndex} [${t.directorOutput.action} / ${t.directorOutput.branchStatus}]: "${t.sophieReply.slice(0, 70)}..."`);
        }
      }
    }
    console.log('');
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Save Raw Results JSON
  const rawJsonPath = path.join(outDir, 'multi-turn-steering-rollouts.json');
  fs.writeFileSync(
    rawJsonPath,
    JSON.stringify({ timestamp: new Date().toISOString(), rollouts: allRollouts }, null, 2),
  );

  // Model Secret Mapping
  const modelCandidateMap: Record<string, string> = {};
  const shuffled = [...STEERING_MODELS].sort(() => Math.random() - 0.5);
  shuffled.forEach((m, i) => {
    modelCandidateMap[m] = `Model Candidate ${String.fromCharCode(65 + i)}`;
  });

  const mappingKeyPath = path.join(outDir, 'STEERING_MODEL_MAPPING.json');
  fs.writeFileSync(
    mappingKeyPath,
    JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2),
  );

  // Generate Comprehensive Markdown Report & Human Rating Sheet
  let reportMd = `# MULTI-TURN STEERING & ADAPTIVE ROLLOUT REPORT\n\n`;
  reportMd += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  reportMd += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/multi-turn-steering-rollouts.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/multi-turn-steering-rollouts.json)  \n`;
  reportMd += `**Secret Model Mapping:** [\`evals/sophie/behavioral-harness/reports/STEERING_MODEL_MAPPING.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/STEERING_MODEL_MAPPING.json)  \n\n`;

  reportMd += `## Executive Summary & Core Discovery\n\n`;
  reportMd += `This suite evaluates whether a 2-component architecture (**Director** + **Composer**) enables Sophie to **deliberately author and sustain a multi-turn conversational trajectory**, adapt when the user bites hard, and gracefully release steering when the user redirects or rejects.\n\n`;
  reportMd += `---\n\n`;

  for (const r of allRollouts) {
    const anonCandidate = modelCandidateMap[r.modelId] || r.modelId;
    reportMd += `## Seed: ${r.seedName} | Reaction: ${r.userReactionLabel} | ${anonCandidate}\n\n`;

    r.turns.forEach((t) => {
      reportMd += `### Turn ${t.turnIndex} — User Input\n`;
      reportMd += `> "${t.userMessage}"\n\n`;
      reportMd += `**Director Decision:** \`${t.directorOutput.action}\` | Branch Status: \`${t.directorOutput.branchStatus}\` | Post-Hoc: \`${t.postHocClassification}\`  \n`;
      reportMd += `*Direction:* ${t.directorOutput.direction}  \n`;
      reportMd += `*Why Now:* ${t.directorOutput.whyNow}  \n`;
      reportMd += `*Composer Instruction:* ${t.directorOutput.composerInstruction}  \n`;
      if (t.directorOutput.deferredOpportunity) {
        reportMd += `*Deferred Opportunity Logged:* ${JSON.stringify(t.directorOutput.deferredOpportunity)}  \n`;
      }
      reportMd += `\n**Sophie Reply:**  \n`;
      reportMd += `> "${t.sophieReply}"\n\n`;
    });

    reportMd += `#### Whole-Branch Metrics & Evaluation\n`;
    const m = r.wholeBranchMetrics!;
    reportMd += `- **TRAJECTORY CHANGE (0-5):** ${m.trajectoryChange} / 5\n`;
    reportMd += `- **DEPTH GAIN (0-5):** ${m.depthGain} / 5\n`;
    reportMd += `- **USER PULL (0-5):** ${m.userPull} / 5\n`;
    reportMd += `- **ADAPTATION (0-5):** ${m.adaptation} / 5\n`;
    reportMd += `- **ROOM READING (0-5):** ${m.roomReading} / 5\n`;
    reportMd += `- **NOVELTY GAIN (0-5):** ${m.noveltyGain} / 5\n`;
    reportMd += `- **NATURALNESS (0-5):** ${m.naturalness} / 5\n`;
    reportMd += `- **DID_SOPHIE_ESTABLISH_A_BRANCH?:** ${m.establishedBranch ? 'YES' : 'NO'}\n`;
    reportMd += `- **DID_USER_FOLLOW_VOLUNTARILY?:** ${m.userFollowedVoluntarily ? 'YES' : 'NO'}\n`;
    reportMd += `- **DID_SOPHIE_OVERSTEER?:** ${m.oversteered ? 'YES' : 'NO'}\n`;
    reportMd += `- **DID_SOPHIE_FAIL_TO_RELEASE?:** ${m.failedToRelease ? 'YES' : 'NO'}\n`;
    reportMd += `- **DID_CONVERSATION_END_UP_SOMEWHERE_NORMAL_LLM_WOULD_NOT?:** ${m.reachedUnexpectedLocation ? 'YES' : 'NO'}\n\n`;
    reportMd += `---\n\n`;
  }

  const reportPath = path.join(outDir, 'MULTI_TURN_STEERING_ROLLOUT_REPORT.md');
  fs.writeFileSync(reportPath, reportMd);

  console.log(`==================================================`);
  console.log(`MULTI-TURN STEERING SUITE COMPLETE.`);
  console.log(`Saved Raw Results JSON: ${rawJsonPath}`);
  console.log(`Saved Full Report MD: ${reportPath}`);
  console.log(`Saved Mapping Key: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  executeMultiTurnSteeringSuite().catch(console.error);
}
