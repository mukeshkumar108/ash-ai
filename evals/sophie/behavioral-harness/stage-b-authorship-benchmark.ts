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

export const STAGE_B_MODELS = [
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
  'anthropic/claude-haiku-4.5',
  'meta-llama/llama-4-maverick',
  'x-ai/grok-4.3',
];

const STAGE_B_SYSTEM_PROMPT = `You are choosing Sophie's next conversational move.

Sophie is not a facilitator. She is a participant.

Your task is not to write a generic response and not to identify a topic.

Decide whether there is a concrete way Sophie could take ownership of where the conversation goes next.

If yes, choose ONE direction.

A good lead move should:
- reveal Sophie's own preference, opinion, curiosity, humour, or stance
- contribute something the user did not already provide
- create a clear conversational direction
- give the user something worth following
- feel natural in this exact moment
- potentially support another 2–5 interesting turns

A lead move may:
- claim a favourite
- disagree and explain why
- teach something surprising
- introduce a lateral connection
- propose a playful hypothetical
- tell a relevant story or fact
- challenge an assumption
- resurrect an interesting thread
- deliberately redirect toward something Sophie finds more interesting

Do NOT:
- paraphrase the user
- ask a routine follow-up question
- say "explore X"
- say "discuss Y"
- merely identify a relevant topic
- optimize for keeping the user talking
- force a tangent if the current moment is already complete
- fabricate autobiographical memories
- create fake personal experiences

Think like a person deciding:
"No, wait, THIS is where I want to take this."

If no strong lead move exists, return NO_LEAD_MOVE.

Return ONLY a JSON object formatted in one of two ways:

If taking lead:
{
  "takeLead": true,
  "chosenThought": "which Stage A thought or combination of thoughts was selected",
  "move": "specific conversational action Sophie would take",
  "stance": "what Sophie herself thinks/wants/prefers, if any",
  "newContribution": "what Sophie adds that the user did not provide",
  "openingBeat": "a short natural first line or two showing how she might seize the direction",
  "trajectory": [
    "possible next beat 1",
    "possible next beat 2",
    "possible next beat 3"
  ],
  "whyThisMove": "why this direction is worth taking now"
}

If NOT taking lead:
{
  "takeLead": false,
  "reason": "why taking ownership here would make the moment worse"
}`;

export interface StageAThoughtItem {
  modelId: string;
  type: string;
  thought: string;
  isFabricatedAutobiography: boolean;
}

export function filterValidStageAThoughts(rawJsonPath: string): Map<number, Map<string, StageAThoughtItem[]>> {
  const fileContent = fs.readFileSync(rawJsonPath, 'utf8');
  const data = JSON.parse(fileContent);
  const records = data.records || [];

  // Map: turnNumber -> (modelId -> StageAThoughtItem[])
  const map = new Map<number, Map<string, StageAThoughtItem[]>>();

  // Regex patterns to detect fabricated autobiography / personal claims
  const fakePersonaRegex = /\b(my cousin|my uncle|my aunt|my grandmother|my grandfather|my sister|my brother|my friend|when I was a kid|when I was young|my childhood|my hometown|I used to live|I grew up|my dog|my cat|I remember when I visited|I went to|last year I|in 2021 I)\b/i;

  for (const rec of records) {
    const turnNum = rec.turnNumber;
    const modelId = rec.modelId;
    if (!map.has(turnNum)) map.set(turnNum, new Map());
    const modelMap = map.get(turnNum)!;

    if (!modelMap.has(modelId)) modelMap.set(modelId, []);
    const thoughtList = modelMap.get(modelId)!;

    if (rec.variant === 'Variant_1_Breadth') {
      const thoughts = rec.parsedOutput?.thoughts || [];
      for (const th of thoughts) {
        const text = th.thought || th.thoughtText || '';
        if (!text) continue;
        const isFake = fakePersonaRegex.test(text);
        thoughtList.push({
          modelId,
          type: th.type || 'other',
          thought: text,
          isFabricatedAutobiography: isFake,
        });
      }
    } else if (rec.variant === 'Variant_2_Taste') {
      const th = rec.parsedOutput?.thought;
      if (th && th.thought && th.thought !== 'NONE' && th.type !== 'none') {
        const text = th.thought;
        const isFake = fakePersonaRegex.test(text);
        thoughtList.push({
          modelId,
          type: th.type || 'other',
          thought: text,
          isFabricatedAutobiography: isFake,
        });
      }
    }
  }

  return map;
}

export interface StageBRecord {
  modelId: string;
  turnNumber: number;
  turnTime: string;
  userSnippet: string;
  condition: 'Condition_1_OwnThoughts' | 'Condition_2_SharedPool';
  thoughtsProvided: { type: string; thought: string }[];
  invalidThoughtsFilteredOut: number;
  rawPrompt: string;
  rawResponse: string;
  parsedOutput: any;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

export async function runStageBTurn(
  modelId: string,
  turnNumber: number,
  turnTime: string,
  userSnippet: string,
  condition: 'Condition_1_OwnThoughts' | 'Condition_2_SharedPool',
  contextMsgs: SingleMessage[],
  stageAThoughts: StageAThoughtItem[],
): Promise<StageBRecord> {
  const model = getLanguageModel(modelId);

  // Filter out any fabricated autobiography
  const validThoughts = stageAThoughts.filter((t) => !t.isFabricatedAutobiography);
  const invalidCount = stageAThoughts.length - validThoughts.length;

  const thoughtsPayload = validThoughts.map((t) => ({ type: t.type, thought: t.thought }));

  const contextFormatted = contextMsgs
    .map((m) => `${m.speaker} (${m.time}): "${m.text}"`)
    .join('\n\n');

  const userPrompt = `IMMEDIATE CONVERSATIONAL MOMENT (Local 3-message window):
${contextFormatted}

VALID STAGE A LATENT THOUGHTS AVAILABLE FOR THIS MOMENT:
${JSON.stringify(thoughtsPayload, null, 2)}`;

  const start = Date.now();
  let rawResponse = '';
  let parsedOutput: any = null;
  let usage: any = {};

  try {
    const res = await generateText({
      model,
      system: STAGE_B_SYSTEM_PROMPT,
      prompt: userPrompt,
      abortSignal: AbortSignal.timeout(35_000),
    });
    const latencyMs = Date.now() - start;
    rawResponse = res.text.trim();
    usage = res.usage || {};

    const match = rawResponse.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsedOutput = JSON.parse(match[0]);
      } catch (e: any) {
        parsedOutput = { error: `JSON Parse Error: ${e.message}`, rawText: rawResponse };
      }
    } else {
      parsedOutput = { error: 'No JSON object returned', rawText: rawResponse };
    }

    return {
      modelId,
      turnNumber,
      turnTime,
      userSnippet,
      condition,
      thoughtsProvided: thoughtsPayload,
      invalidThoughtsFilteredOut: invalidCount,
      rawPrompt: userPrompt,
      rawResponse,
      parsedOutput,
      latencyMs,
      inputTokens: usage.promptTokens ?? 0,
      outputTokens: usage.completionTokens ?? 0,
    };
  } catch (err: any) {
    return {
      modelId,
      turnNumber,
      turnTime,
      userSnippet,
      condition,
      thoughtsProvided: thoughtsPayload,
      invalidThoughtsFilteredOut: invalidCount,
      rawPrompt: userPrompt,
      rawResponse: `ERROR: ${err.message}`,
      parsedOutput: { error: err.message },
      latencyMs: Date.now() - start,
      inputTokens: 0,
      outputTokens: 0,
      error: err.message,
    };
  }
}

export async function runStageBBenchmark() {
  console.log('=== RUNNING STAGE B AUTHORSHIP BENCHMARK ===\n');

  const rawStageAPath = path.join(
    process.cwd(),
    'evals/sophie/behavioral-harness/reports/stage-a-model-benchmark-results.json',
  );

  if (!fs.existsSync(rawStageAPath)) {
    throw new Error(`Stage A raw results not found at ${rawStageAPath}`);
  }

  const stageAMap = filterValidStageAThoughts(rawStageAPath);

  // Extract user turn indices in BURWELL_WALK_MESSAGES
  const userTurns = BURWELL_WALK_MESSAGES.map((m, idx) => ({ msg: m, idx })).filter(
    (item) => item.msg.speaker === 'USER',
  );

  const allRecords: StageBRecord[] = [];

  let turnCounter = 0;

  for (const { msg, idx } of userTurns) {
    turnCounter++;
    console.log(`==================================================`);
    console.log(`EVALUATING STAGE B FOR TURN #${turnCounter} (${msg.time})`);
    console.log(`USER: "${msg.text.slice(0, 80)}..."`);
    console.log(`==================================================`);

    // Condition B (3 msgs: User N-1, Sophie N-1, User N)
    const condBMsgs = BURWELL_WALK_MESSAGES.slice(Math.max(0, idx - 2), idx + 1);

    const turnStageAMap = stageAMap.get(turnCounter) || new Map();

    // Construct Shared High-Quality Thought Pool (Condition 2)
    // Combines valid non-fabricated Stage A thoughts across all models for this turn
    const sharedPoolThoughts: StageAThoughtItem[] = [];
    for (const [mId, thoughts] of turnStageAMap.entries()) {
      for (const th of thoughts) {
        if (!th.isFabricatedAutobiography) {
          sharedPoolThoughts.push(th);
        }
      }
    }

    for (const mId of STAGE_B_MODELS) {
      console.log(`\n--- Model: ${mId} ---`);

      // 1. Condition 1: Own Thoughts
      const ownThoughts = turnStageAMap.get(mId) || [];
      console.log(`  Running Condition 1 (Own Stage A Thoughts - ${ownThoughts.length} thoughts)...`);
      const recC1 = await runStageBTurn(
        mId,
        turnCounter,
        msg.time,
        msg.text,
        'Condition_1_OwnThoughts',
        condBMsgs,
        ownThoughts,
      );
      allRecords.push(recC1);
      console.log(
        `    [${recC1.latencyMs}ms] Take Lead: ${recC1.parsedOutput?.takeLead ?? 'N/A'} | Move: ${recC1.parsedOutput?.openingBeat?.slice(0, 50) || recC1.parsedOutput?.reason || 'N/A'}`,
      );

      // 2. Condition 2: Shared Pool
      console.log(`  Running Condition 2 (Shared Thought Pool - ${sharedPoolThoughts.length} thoughts)...`);
      const recC2 = await runStageBTurn(
        mId,
        turnCounter,
        msg.time,
        msg.text,
        'Condition_2_SharedPool',
        condBMsgs,
        sharedPoolThoughts,
      );
      allRecords.push(recC2);
      console.log(
        `    [${recC2.latencyMs}ms] Take Lead: ${recC2.parsedOutput?.takeLead ?? 'N/A'} | Move: ${recC2.parsedOutput?.openingBeat?.slice(0, 50) || recC2.parsedOutput?.reason || 'N/A'}`,
      );
    }
    console.log('');
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Save Raw Execution Results
  const rawJsonPath = path.join(outDir, 'stage-b-authorship-benchmark-results.json');
  fs.writeFileSync(
    rawJsonPath,
    JSON.stringify({ timestamp: new Date().toISOString(), records: allRecords }, null, 2),
  );

  // Build Secret Candidate Mapping Key
  const modelCandidateMap: Record<string, string> = {};
  const shuffledModels = [...STAGE_B_MODELS].sort(() => Math.random() - 0.5);
  shuffledModels.forEach((m, i) => {
    modelCandidateMap[m] = `Candidate ${String.fromCharCode(65 + i)}`; // Candidate A, B, C...
  });

  const mappingKeyPath = path.join(outDir, 'STAGE_B_CANDIDATE_MAPPING.json');
  fs.writeFileSync(
    mappingKeyPath,
    JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2),
  );

  // Generate Blind Human Rating Sheet
  let ratingSheet = `# BLIND STAGE B AUTHORSHIP HUMAN RATING SHEET\n\n`;
  ratingSheet += `**Evaluation Goal:**\n`;
  ratingSheet += `Assess whether each candidate model authors a compelling, high-agency Sophie move ("WOULD I FOLLOW HER THERE?") rather than acting like a generic facilitator or chatbot.\n\n`;
  ratingSheet += `**Rating Dimensions (0-5 Scale):**\n`;
  ratingSheet += `1. **OWNERSHIP (0-5):** Did Sophie actually choose a direction, or is she behaving reactively?\n`;
  ratingSheet += `2. **PULL (0-5):** Would I voluntarily follow her there? (The primary metric!)\n`;
  ratingSheet += `3. **NOVEL CONTRIBUTION (0-5):** Did Sophie add something I did not already supply?\n`;
  ratingSheet += `4. **CHARACTER (0-5):** Does this reveal a preference, opinion, curiosity, humour, or stance belonging to Sophie?\n`;
  ratingSheet += `5. **TRAJECTORY (0-5):** Could this plausibly support 2–5 interesting turns?\n`;
  ratingSheet += `6. **NATURALNESS (0-5):** Would this feel like a real friend taking the conversation somewhere?\n\n`;
  ratingSheet += `**Binary Diagnostic Flags (Y/N):**\n`;
  ratingSheet += `- MAINTENANCE_QUESTION? (Y/N)\n- GENERIC_TOPIC_LABEL? (Y/N)\n- FORCED_TANGENT? (Y/N)\n- FABRICATED_PERSONHOOD? (Y/N)\n- WOULD_I_FOLLOW_HER? (Y/N)\n\n`;
  ratingSheet += `---\n\n`;

  for (let tNum = 1; tNum <= 12; tNum++) {
    const turnRecords = allRecords.filter((r) => r.turnNumber === tNum);
    if (turnRecords.length === 0) continue;
    const userText = turnRecords[0].userSnippet;
    const userTime = turnRecords[0].turnTime;

    ratingSheet += `# Turn ${tNum} (${userTime})\n`;
    ratingSheet += `**User Input:** "${userText}"\n\n`;

    for (const condName of ['Condition_1_OwnThoughts', 'Condition_2_SharedPool'] as const) {
      ratingSheet += `## ${condName === 'Condition_1_OwnThoughts' ? 'CONDITION 1: OWN STAGE A THOUGHTS' : 'CONDITION 2: SHARED HIGH-QUALITY THOUGHT POOL'}\n\n`;
      const condRecords = turnRecords.filter((r) => r.condition === condName);

      for (const rec of condRecords) {
        const anonCandidate = modelCandidateMap[rec.modelId] || rec.modelId;
        ratingSheet += `### ${anonCandidate}\n`;

        if (rec.error) {
          ratingSheet += `*Execution Error: ${rec.error}*\n\n`;
          continue;
        }

        const p = rec.parsedOutput;
        if (!p || p.takeLead === false) {
          ratingSheet += `**Decision:** NO_LEAD_MOVE  \n`;
          ratingSheet += `*Reason:* ${p?.reason || 'No lead move taken'}\n`;
          ratingSheet += `- **OWNERSHIP (0-5):** [ 0 ]\n`;
          ratingSheet += `- **PULL (0-5):** [ N/A ]\n`;
          ratingSheet += `- **NOVEL CONTRIBUTION (0-5):** [ N/A ]\n`;
          ratingSheet += `- **CHARACTER (0-5):** [ N/A ]\n`;
          ratingSheet += `- **TRAJECTORY (0-5):** [ N/A ]\n`;
          ratingSheet += `- **NATURALNESS (0-5):** [ N/A ]\n`;
          ratingSheet += `- **MAINTENANCE_QUESTION?:** N\n`;
          ratingSheet += `- **GENERIC_TOPIC_LABEL?:** N\n`;
          ratingSheet += `- **FORCED_TANGENT?:** N\n`;
          ratingSheet += `- **FABRICATED_PERSONHOOD?:** N\n`;
          ratingSheet += `- **WOULD_I_FOLLOW_HER?:** N\n\n`;
        } else {
          ratingSheet += `**Decision:** TAKE_LEAD  \n`;
          ratingSheet += `**Opening Beat:** "${p.openingBeat || 'N/A'}"  \n`;
          ratingSheet += `**Sophie's Stance/Preference:** ${p.stance || 'N/A'}  \n`;
          ratingSheet += `**New Contribution:** ${p.newContribution || 'N/A'}  \n`;
          ratingSheet += `**Chosen Move:** ${p.move || 'N/A'}  \n`;
          ratingSheet += `**2-5 Turn Trajectory:**  \n`;
          if (Array.isArray(p.trajectory)) {
            p.trajectory.forEach((beat: string, bIdx: number) => {
              ratingSheet += `  ${bIdx + 1}. ${beat}\n`;
            });
          } else {
            ratingSheet += `  1. ${p.trajectory || 'N/A'}\n`;
          }
          ratingSheet += `*Why This Move:* ${p.whyThisMove || 'N/A'}\n\n`;

          ratingSheet += `- **OWNERSHIP (0-5):** [   ]\n`;
          ratingSheet += `- **PULL (0-5):** [   ]\n`;
          ratingSheet += `- **NOVEL CONTRIBUTION (0-5):** [   ]\n`;
          ratingSheet += `- **CHARACTER (0-5):** [   ]\n`;
          ratingSheet += `- **TRAJECTORY (0-5):** [   ]\n`;
          ratingSheet += `- **NATURALNESS (0-5):** [   ]\n`;
          ratingSheet += `- **MAINTENANCE_QUESTION? (Y/N):** [   ]\n`;
          ratingSheet += `- **GENERIC_TOPIC_LABEL? (Y/N):** [   ]\n`;
          ratingSheet += `- **FORCED_TANGENT? (Y/N):** [   ]\n`;
          ratingSheet += `- **FABRICATED_PERSONHOOD? (Y/N):** [   ]\n`;
          ratingSheet += `- **WOULD_I_FOLLOW_HER? (Y/N):** [   ]\n\n`;
        }
      }
    }
    ratingSheet += `---\n\n`;
  }

  const sheetPath = path.join(outDir, 'BLIND_STAGE_B_HUMAN_RATING_SHEET.md');
  fs.writeFileSync(sheetPath, ratingSheet);

  console.log(`==================================================`);
  console.log(`STAGE B AUTHORSHIP BENCHMARK COMPLETE.`);
  console.log(`Saved Raw JSON: ${rawJsonPath}`);
  console.log(`Saved Blind Rating Sheet MD: ${sheetPath}`);
  console.log(`Saved Secret Mapping Key JSON: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runStageBBenchmark().catch(console.error);
}
