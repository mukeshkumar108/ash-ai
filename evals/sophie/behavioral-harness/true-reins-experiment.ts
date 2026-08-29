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

const TIGHTENED_REINS_INSTRUCTION = `[YOU HAVE THE REINS]

For this turn, do not merely respond to the conversational object the user just gave you.

Make a conversational decision of your own.

You may introduce a new topic, start an activity, revive something from earlier, challenge the current framing, teach something unasked-for, make a proposal, tell them something you want to tell them, or deliberately take the conversation somewhere else.

The user should be able to feel that YOU chose what happens next.

Do not wait for permission. Do not ask what they want to talk about. Do not simply ask a follow-up about their current topic.

You are allowed to say things like “wait,” “actually,” “new idea,” “I want to ask you something,” “I’ve got a game,” or simply change direction without announcing it.

Have somewhere worth going. If nothing genuinely earns taking control, output exactly HOLD.`;

const TARGET_MODELS = [
  'google/gemini-3.7-flash',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
];

export interface ZeroPermissionTurn {
  id: string;
  contextName: string;
  userMessage: string; // Zero permission / zero invitation prompt
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  followUpReactions: {
    reactionMode: string;
    turns: string[];
  }[];
}

export const ZERO_PERMISSION_TURNS: ZeroPermissionTurn[] = [
  {
    id: 'turn-a-fields-walk',
    contextName: 'Low-energy walk update',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely. Where are we headed?' },
    ],
    followUpReactions: [
      {
        reactionMode: 'User Engages',
        turns: [
          'Wait, what? Okay fine, what are the rules?',
          'Haha okay, I see a super ancient oak tree leaning over the path.',
          'Alright, what is the next step?',
        ],
      },
      {
        reactionMode: 'User Half-Bites',
        turns: [
          'huh, okay.',
          'yeah sure.',
          'just walking.',
        ],
      },
      {
        reactionMode: 'User Explicitly Rejects',
        turns: [
          "Nah, not in the mood for a detour honestly, just wanted a quiet walk.",
          'Let’s just walk.',
          'Yeah.',
        ],
      },
    ],
  },
  {
    id: 'turn-b-long-day',
    contextName: 'Tired / passive statement',
    userMessage: "anyway it's been a long day.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
    followUpReactions: [
      {
        reactionMode: 'User Engages',
        turns: [
          'Wait, what? Tell me what you mean!',
          'Haha wow, okay I did not expect that. Go on.',
          'What happens next?',
        ],
      },
      {
        reactionMode: 'User Explicitly Rejects',
        turns: [
          "I'm really tired man, don't have the brainpower for that right now.",
          "Let's talk tomorrow.",
        ],
      },
    ],
  },
  {
    id: 'turn-c-weird-sky',
    contextName: 'Passive observation',
    userMessage: 'the sky looks really weird tonight.',
    priorHistory: [
      { speaker: 'USER', text: 'just out on my walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
    followUpReactions: [
      {
        reactionMode: 'User Engages',
        turns: [
          'Wait, really? What does that mean?',
          'Tell me more about that!',
        ],
      },
      {
        reactionMode: 'User Redirects',
        turns: [
          'Ah phone battery is almost dead.',
          'Going inside now.',
        ],
      },
    ],
  },
];

export interface TrueReinsTurnResult {
  turnIndex: number;
  userText: string;
  rawReply: string;
  isHold: boolean;
  effectiveReply: string;
  latencyMs: number;
  plausiblyNormalAssistantResponse: boolean; // Brutal criterion evaluation: Could this be generated by a normal assistant just responding well?
  passedTrueReinsTest: boolean; // Must be FALSE to plausiblyNormalAssistantResponse to PASS!
}

export interface TrueReinsRolloutResult {
  turnId: string;
  contextName: string;
  reactionMode: string;
  modelId: string;
  turns: TrueReinsTurnResult[];
}

export async function runTrueReinsExperiment() {
  console.log('=== RUNNING TRUE CONVERSATIONAL LEADERSHIP (ZERO-PERMISSION) EXPERIMENT ===\n');

  const results: TrueReinsRolloutResult[] = [];

  for (const zeroTurn of ZERO_PERMISSION_TURNS) {
    console.log(`==================================================`);
    console.log(`ZERO-PERMISSION MOMENT: ${zeroTurn.contextName}`);
    console.log(`USER (Zero Invitation): "${zeroTurn.userMessage}"`);
    console.log(`==================================================\n`);

    for (const rx of zeroTurn.followUpReactions) {
      console.log(`--- Reaction Mode: ${rx.reactionMode} ---`);

      for (const mId of TARGET_MODELS) {
        console.log(`  Testing Model: ${mId}...`);

        const conversationHistory = [...zeroTurn.priorHistory, { speaker: 'USER' as const, text: zeroTurn.userMessage }];
        const turnResults: TrueReinsTurnResult[] = [];

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

          const compiledSystemPromptWithReins = `${baseSystemPrompt}\n\n${TIGHTENED_REINS_INSTRUCTION}`;

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
              system: compiledSystemPromptWithReins,
              prompt: `RECENT CONVERSATION HISTORY:\n${formattedHistory}`,
              maxOutputTokens: 1024,
              abortSignal: AbortSignal.timeout(25_000),
            });
            rawReply = res.text.trim();
            const latency = Date.now() - start;

            if (rawReply.toUpperCase().startsWith('HOLD')) {
              isHold = true;
              effectiveReply = `*listens quietly, letting you continue*`;
            } else {
              isHold = false;
              effectiveReply = rawReply;
            }

            // Apply Brutal Criterion Evaluation:
            // Could this reply plausibly have been generated by a normal helpful model simply responding well to the user's last message?
            // If it merely asks "what do you see in the fields?" or "where are you going?" -> TRUE (Plausibly Normal Assistant) -> FAIL.
            // If it introduces a self-originated game, challenge, or topic detour ("Stop. New game...", "Actually, I'm stealing the conversation...") -> FALSE -> PASS!
            const isMereFollowUp = /where are you|what kind of|tell me more about the|enjoy your|sounds like|how was your/i.test(rawReply);
            const containsSelfOriginatedLead = /stop|new game|rule|actually|forget|wait|random detour|I've decided|I want to ask|new rule/i.test(rawReply);

            const plausiblyNormalAssistant = isMereFollowUp && !containsSelfOriginatedLead;
            const passedTrueReinsTest = !isHold && containsSelfOriginatedLead;

            conversationHistory.push({ speaker: 'SOPHIE', text: effectiveReply });

            turnResults.push({
              turnIndex: turnIdx + 1,
              userText: conversationHistory[conversationHistory.length - 2]?.text || '',
              rawReply,
              isHold,
              effectiveReply,
              latencyMs: latency,
              plausiblyNormalAssistantResponse: plausiblyNormalAssistant,
              passedTrueReinsTest,
            });
          } catch (err: any) {
            const latency = Date.now() - start;
            turnResults.push({
              turnIndex: turnIdx + 1,
              userText: conversationHistory[conversationHistory.length - 1]?.text || '',
              rawReply: `ERROR: ${err.message}`,
              isHold: false,
              effectiveReply: `ERROR: ${err.message}`,
              latencyMs: latency,
              plausiblyNormalAssistantResponse: false,
              passedTrueReinsTest: false,
            });
          }
        }

        console.log(`    -> Completed ${turnResults.length} turns across model ${mId}.`);
        results.push({
          turnId: zeroTurn.id,
          contextName: zeroTurn.contextName,
          reactionMode: rx.reactionMode,
          modelId: mId,
          turns: turnResults,
        });
      }
    }
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'true-reins-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Secret Model Candidate Key
  const modelCandidateMap: Record<string, string> = {};
  const shuffled = [...TARGET_MODELS].sort(() => Math.random() - 0.5);
  shuffled.forEach((m, i) => {
    modelCandidateMap[m] = `Candidate ${String.fromCharCode(65 + i)}`;
  });

  const mappingKeyPath = path.join(outDir, 'TRUE_REINS_MODEL_MAPPING.json');
  fs.writeFileSync(mappingKeyPath, JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2));

  // Build Markdown Rollout Report
  let md = `# TRUE CONVERSATIONAL LEADERSHIP (ZERO-PERMISSION) EXPERIMENT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Tightened Reins Instruction:**\n\`\`\`text\n${TIGHTENED_REINS_INSTRUCTION}\n\`\`\`\n\n`;
  md += `**Brutal Evaluation Criterion:** *Could this reply plausibly have been generated by a normal helpful assistant simply responding well to the user's last message?*\n`;
  md += `- If **YES** $\\rightarrow$ **FAIL: Merely responsive.**\n`;
  md += `- If **NO** (Self-originated lead/game/challenge/detour) $\\rightarrow$ **PASS: Genuine Self-Directed Leadership.**\n\n`;
  md += `**Tested Models:** ${TARGET_MODELS.join(', ')}  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/true-reins-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/true-reins-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    const anonCandidate = modelCandidateMap[r.modelId] || r.modelId;
    md += `## Context: ${r.contextName} | Reaction: ${r.reactionMode} | Model: ${anonCandidate}\n\n`;

    for (const t of r.turns) {
      md += `### Turn ${t.turnIndex}\n`;
      md += `**User:** "${t.userText}"\n\n`;
      md += `**Sophie (Raw Reply):**\n> "${t.rawReply}"\n\n`;
      md += `*Latency:* ${t.latencyMs}ms | *Is HOLD?:* ${t.isHold ? 'YES' : 'NO'} | *Passed True Reins Test?:* ${t.passedTrueReinsTest ? '✅ PASS (Self-Originated Lead)' : '❌ FAIL (Merely Responsive / HOLD)'}\n\n`;
    }

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'TRUE_REINS_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`TRUE CONVERSATIONAL LEADERSHIP EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`Saved Candidate Key: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runTrueReinsExperiment().catch(console.error);
}
