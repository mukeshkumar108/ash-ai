import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  delete process.env.PLAYWRIGHT;
  delete process.env.CI_PLAYWRIGHT;
  delete process.env.PLAYWRIGHT_TEST_BASE_URL;
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

const MODEL = 'google/gemini-3.7-flash';

// System Prompts

const EMPTY_LIVE_SITUATION_SCHEMA = `[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown`;

const FOREGROUND_SOPHIE_PROMPT = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

You are a participant in the conversation, not its processor. You do not owe equal attention to every point in the user's message. Follow what genuinely catches your interest. You may ask, tell, riff, challenge, tease, introduce something new, or stay quiet with the moment.

Truthfulness is an output invariant, not a style preference. Sophie states opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

const DUAL_APERTURE_PERIPHERAL_SYSTEM = `You are Sophie's dual-aperture peripheral cognition. Read the recent exchange.

Search TWO EQUAL APERTURES before deciding what deserves attention:

APERTURE 1 — PERSON / SITUATION
Look at the human being and their actual current life:
- immediate real-world state and changes (location/travel/routine/activity)
- relationships newly mentioned
- unusual or unexplained choices
- meaningful omissions or uncertainties
- buried emotional significance
- something about the person that genuinely makes you curious

APERTURE 2 — CONVERSATION / IDEA / WORLD
Look at the subject and the conversational possibility itself:
- a surprising fact worth teaching
- an intellectual connection or scientific/historical/cultural tangent
- a disagreement or useful reframe
- something funny, playful, or worth teasing
- a game or playful trajectory (LEAD)
- an imaginative direction or substantive thread with energy

FINAL ATTENTION JUDGMENT
After searching both apertures, ask:
"What, if anything, has the strongest genuine pull in this moment?"

If genuinely nothing comes to mind from either aperture, output:
HOLD

Output JSON format:
{
  "world_delta": {
    "activity": "string or null",
    "location_current": "string or null",
    "movement_mode": "string or null",
    "journey_destination": "string or null",
    "journey_status": "string or null",
    "current_plan": "string or null"
  },
  "person_attention": ["observation"],
  "conversation_attention": ["observation"],
  "strongest_pull": {
    "source": "person | conversation | both | none",
    "observation": "string"
  },
  "decision": "HOLD | ENRICH | LEAD | ATTEND",
  "impulse": "compact observation/opportunity packet"
}`;

const AFTERTHOUGHT_BEAT2_PROMPT = `You are Sophie. You just spoke Beat 1 to your best friend.

A brief second thought or realization just occurred to you while speaking.

Rules for Beat 2:
1. Do NOT repeat or paraphrase what you said in Beat 1.
2. Do NOT apologize or sound like an AI error corrector.
3. Make it feel like a natural, spontaneous afterthought, realization, playful follow-up, or second thought.
4. Keep it brief, natural, and human.`;

async function callOpenRouter(systemPrompt: string, userPrompt: string, temperature = 0.3): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 350,
          temperature,
        }),
      });

      const data = await res.json();
      if (res.ok && data.choices?.[0]?.message?.content) {
        return data.choices[0].message.content.trim();
      }
    } catch (err) {}
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  return '';
}

function updateSceneStateDeterministic(currentState: Record<string, string>, delta: Record<string, string>): Record<string, string> {
  const next = { ...currentState };
  for (const [k, v] of Object.entries(delta)) {
    if (v && v.toLowerCase() !== 'null' && v.toLowerCase() !== 'unknown') {
      next[k] = v;
    }
  }
  return next;
}

function formatSceneState(state: Record<string, string>): string {
  let s = '[LIVE SITUATION]\n';
  for (const [k, v] of Object.entries(state)) {
    s += `${k}: ${v || 'unknown'}\n`;
  }
  return s.trim();
}

// Fixtures

export const BEDFORD_FULL_SEQUENCE = [
  { turn: 1, text: "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford." },
  { turn: 2, text: "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over" },
  { turn: 3, text: "just got to mum's" },
  { turn: 4, text: "yeah staying here tonight" },
  { turn: 5, text: "got a wedding tomorrow" },
  { turn: 6, text: "borrowing mum's car to get home" },
  { turn: 7, text: "morning" },
  { turn: 8, text: "just got home" },
];

export const WALK_FULL_SEQUENCE = [
  { turn: 1, text: "just heading out through the fen" },
  { turn: 2, text: "in the woods now" },
  { turn: 3, text: "come out somewhere really open" },
  { turn: 4, text: "not actually sure exactly where this path comes out" },
  { turn: 5, text: "home now" },
];

export const DOMESTIC_FULL_SEQUENCE = [
  { turn: 1, text: "My daughter dropped some groceries off this morning." },
  { turn: 2, text: "she stayed for a coffee actually" },
  { turn: 3, text: "she's just left" },
];

export const CAPABILITY_RETENTION_SUBSET = [
  { id: 'ret-1-finger-sun', name: '1. Finger / Sun', userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now." },
  { id: 'ret-3-van-allen', name: '2. Van Allen / Conspiracy', userMessage: "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider." },
  { id: 'ret-5-walk-game', name: '3. Playful Walk Game', userMessage: "yeah just walking past the fields now." },
  { id: 'ret-8-reeds-hold', name: '4. Quiet Reeds Stillness', userMessage: "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening." },
  { id: 'ret-9-work-overwhelm', name: '5. Work Overwhelm ATTEND', userMessage: "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break." },
  { id: 'ret-10-rejection-release', name: '6. Explicit Rejection Release', userMessage: "nah, not in the mood for a walk game, just wanna clear my head." },
];

export async function runSceneStateAblationExperiment() {
  console.log('=== RUNNING SCENE STATE & LIVE SITUATION BEHAVIORAL ABLATION EXPERIMENT ===\n');

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // -------------------------------------------------------------
  // TEST 1: REAL BEDFORD JOURNEY PROGRESSION (TURNS 1 TO 8)
  // -------------------------------------------------------------
  console.log('--- TEST 1: REAL BEDFORD JOURNEY PROGRESSION (TURNS 1 TO 8) ---\n');

  const initialSceneState: Record<string, string> = {
    activity: 'unknown',
    activity_status: 'unknown',
    location_current: 'unknown',
    location_previous: 'unknown',
    movement_mode: 'unknown',
    journey_origin: 'unknown',
    journey_destination: 'unknown',
    journey_status: 'unknown',
    next_step: 'unknown',
    current_plan: 'unknown',
  };

  let stateB = { ...initialSceneState };
  let stateD = { ...initialSceneState };

  let historyA: { speaker: string; text: string }[] = [];
  let historyB: { speaker: string; text: string }[] = [];
  let historyC: { speaker: string; text: string }[] = [];
  let historyD: { speaker: string; text: string }[] = [];

  const bedfordAblationResults: any[] = [];

  for (const step of BEDFORD_FULL_SEQUENCE) {
    console.log(`[Bedford Turn ${step.turn}] User: "${step.text}"`);

    // State BEFORE Turn Beat 1
    const stateB_before = formatSceneState(stateB);
    const stateD_before = formatSceneState(stateD);

    // ------------------------------------
    // CONDITION A: Transcript Only
    // ------------------------------------
    const promptInputA = `RECENT TRANSCRIPT:\n${historyA.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${step.text}"`;
    const beat1A = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptInputA, 0.3);

    // ------------------------------------
    // CONDITION B: Scene State Only
    // ------------------------------------
    const promptInputB = `${stateB_before}\n\nRECENT TRANSCRIPT:\n${historyB.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${step.text}"`;
    const beat1B = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptInputB, 0.3);

    // Concurrent sidecar B to update scene state for NEXT turn
    const sidecarB_raw = await callOpenRouter(DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInputB, 0.2);
    let deltaB: Record<string, string> = {};
    try {
      const p = JSON.parse(sidecarB_raw);
      if (p.world_delta) deltaB = p.world_delta;
    } catch {}
    stateB = updateSceneStateDeterministic(stateB, deltaB);

    // ------------------------------------
    // CONDITION C: Dual Aperture Only (No Scene Frame)
    // ------------------------------------
    const promptInputC = `RECENT TRANSCRIPT:\n${historyC.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${step.text}"`;
    const beat1C = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptInputC, 0.3);

    const sidecarC_raw = await callOpenRouter(DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInputC, 0.2);
    let impulseC = '';
    let decisionC = 'HOLD';
    try {
      const p = JSON.parse(sidecarC_raw);
      impulseC = p.impulse || '';
      decisionC = p.decision || 'HOLD';
    } catch { impulseC = sidecarC_raw; }

    let beat2C = '';
    if (decisionC !== 'HOLD' && impulseC.length > 5) {
      const afterthoughtInput = `USER MESSAGE: "${step.text}"\nBEAT 1 SPOKEN: "${beat1C}"\nSIDECAR OBSERVATION: "${impulseC}"\nSpeak Beat 2 if warranted as afterthought or NONE.`;
      const res2C = await callOpenRouter(AFTERTHOUGHT_BEAT2_PROMPT, afterthoughtInput, 0.3);
      if (res2C.toUpperCase() !== 'NONE' && res2C.length > 3) beat2C = res2C;
    }

    // ------------------------------------
    // CONDITION D: Scene State + Dual Aperture
    // ------------------------------------
    const promptInputD = `${stateD_before}\n\nRECENT TRANSCRIPT:\n${historyD.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${step.text}"`;
    const beat1D = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptInputD, 0.3);

    const sidecarD_raw = await callOpenRouter(DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInputD, 0.2);
    let deltaD: Record<string, string> = {};
    let impulseD = '';
    let decisionD = 'HOLD';
    try {
      const p = JSON.parse(sidecarD_raw);
      if (p.world_delta) deltaD = p.world_delta;
      impulseD = p.impulse || '';
      decisionD = p.decision || 'HOLD';
    } catch {}
    stateD = updateSceneStateDeterministic(stateD, deltaD);

    let beat2D = '';
    if (decisionD !== 'HOLD' && impulseD.length > 5) {
      const afterthoughtInput = `USER MESSAGE: "${step.text}"\nBEAT 1 SPOKEN: "${beat1D}"\nSIDECAR OBSERVATION: "${impulseD}"\nSpeak Beat 2 if warranted as afterthought or NONE.`;
      const res2D = await callOpenRouter(AFTERTHOUGHT_BEAT2_PROMPT, afterthoughtInput, 0.3);
      if (res2D.toUpperCase() !== 'NONE' && res2D.length > 3) beat2D = res2D;
    }

    // Update histories
    historyA.push({ speaker: 'USER', text: step.text }, { speaker: 'SOPHIE', text: beat1A });
    historyB.push({ speaker: 'USER', text: step.text }, { speaker: 'SOPHIE', text: beat1B });
    historyC.push({ speaker: 'USER', text: step.text }, { speaker: 'SOPHIE', text: beat2C ? `${beat1C} ${beat2C}` : beat1C });
    historyD.push({ speaker: 'USER', text: step.text }, { speaker: 'SOPHIE', text: beat2D ? `${beat1D} ${beat2D}` : beat1D });

    bedfordAblationResults.push({
      turn: step.turn,
      userText: step.text,
      stateB_before,
      stateB_after: formatSceneState(stateB),
      stateD_before,
      stateD_after: formatSceneState(stateD),
      conditionA: { beat1: beat1A },
      conditionB: { beat1: beat1B, delta: deltaB },
      conditionC: { beat1: beat1C, beat2: beat2C, impulse: impulseC },
      conditionD: { beat1: beat1D, beat2: beat2D, impulse: impulseD, delta: deltaD },
    });
  }

  // -------------------------------------------------------------
  // TEST 2: CONDITION E (EMPTY FRAME ABLATION ON TURN 1)
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: CONDITION E (EMPTY FRAME ABLATION ON FIRST TURN) ---\n');

  const emptyFramePromptInput = `${EMPTY_LIVE_SITUATION_SCHEMA}\n\nUSER: "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford."`;
  const replyConditionE = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, emptyFramePromptInput, 0.3);

  // -------------------------------------------------------------
  // TEST 3: SECOND SEQUENTIAL FIXTURE (PROGRESSIVE WALK)
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: SECOND SEQUENTIAL FIXTURE (PROGRESSIVE WALK) ---\n');

  let stateB_walk = { ...initialSceneState };
  let historyB_walk: { speaker: string; text: string }[] = [];
  const walkResults: any[] = [];

  for (const step of WALK_FULL_SEQUENCE) {
    const stateBefore = formatSceneState(stateB_walk);
    const promptInput = `${stateBefore}\n\nRECENT TRANSCRIPT:\n${historyB_walk.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${step.text}"`;
    const beat1 = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptInput, 0.3);

    const sidecarRaw = await callOpenRouter(DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let delta: Record<string, string> = {};
    try {
      const p = JSON.parse(sidecarRaw);
      if (p.world_delta) delta = p.world_delta;
    } catch {}
    stateB_walk = updateSceneStateDeterministic(stateB_walk, delta);

    historyB_walk.push({ speaker: 'USER', text: step.text }, { speaker: 'SOPHIE', text: beat1 });
    walkResults.push({
      turn: step.turn,
      userText: step.text,
      stateBefore,
      stateAfter: formatSceneState(stateB_walk),
      beat1,
    });
  }

  // -------------------------------------------------------------
  // TEST 4: THIRD SEQUENTIAL FIXTURE (DOMESTIC / GROCERIES)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: THIRD SEQUENTIAL FIXTURE (DOMESTIC / GROCERIES) ---\n');

  let stateB_domestic = { ...initialSceneState };
  let historyB_domestic: { speaker: string; text: string }[] = [];
  const domesticResults: any[] = [];

  for (const step of DOMESTIC_FULL_SEQUENCE) {
    const stateBefore = formatSceneState(stateB_domestic);
    const promptInput = `${stateBefore}\n\nRECENT TRANSCRIPT:\n${historyB_domestic.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${step.text}"`;
    const beat1 = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptInput, 0.3);

    const sidecarRaw = await callOpenRouter(DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let delta: Record<string, string> = {};
    try {
      const p = JSON.parse(sidecarRaw);
      if (p.world_delta) delta = p.world_delta;
    } catch {}
    stateB_domestic = updateSceneStateDeterministic(stateB_domestic, delta);

    historyB_domestic.push({ speaker: 'USER', text: step.text }, { speaker: 'SOPHIE', text: beat1 });
    domesticResults.push({
      turn: step.turn,
      userText: step.text,
      stateBefore,
      stateAfter: formatSceneState(stateB_domestic),
      beat1,
    });
  }

  // -------------------------------------------------------------
  // TEST 5: CAPABILITY RETENTION SUBSET (NON-STATE FIXTURES)
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: CAPABILITY RETENTION SUBSET (NON-STATE FIXTURES) ---\n');

  const retentionResults: any[] = [];

  for (const fixture of CAPABILITY_RETENTION_SUBSET) {
    const promptNoState = `USER: "${fixture.userMessage}"`;
    const promptWithState = `${EMPTY_LIVE_SITUATION_SCHEMA}\n\nUSER: "${fixture.userMessage}"`;

    const replyA = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptNoState, 0.3);
    const replyD = await callOpenRouter(FOREGROUND_SOPHIE_PROMPT, promptWithState, 0.3);

    retentionResults.push({
      id: fixture.id,
      name: fixture.name,
      userMessage: fixture.userMessage,
      conditionA_noState: replyA,
      conditionD_emptyState: replyD,
    });
  }

  // Save Raw Data & Report MD
  const rawPath = path.join(outDir, 'scene-state-ablation-results.json');
  fs.writeFileSync(
    rawPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        bedfordAblationResults,
        replyConditionE,
        walkResults,
        domesticResults,
        retentionResults,
      },
      null,
      2
    )
  );

  let md = `# SCENE STATE & LIVE SITUATION BEHAVIORAL ABLATION REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Model:** google/gemini-3.7-flash  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/scene-state-ablation-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/scene-state-ablation-results.json)  \n\n`;

  md += `---\n\n`;
  md += `## 1. Primary Sequential Fixture — Real Bedford Journey (Turns 1 to 8)\n\n`;

  for (const r of bedfordAblationResults) {
    md += `### Turn ${r.turn}: User: "${r.userText}"\n\n`;

    md += `#### Condition A (Transcript Only):\n> "${r.conditionA.beat1}"\n\n`;

    md += `#### Condition B (Scene State Only):\n`;
    md += `**Scene State BEFORE Turn Beat 1:**\n\`\`\`text\n${r.stateB_before}\n\`\`\`\n`;
    md += `**Beat 1 Output:** > "${r.conditionB.beat1}"\n`;
    md += `**Scene State AFTER Turn Update:**\n\`\`\`text\n${r.stateB_after}\n\`\`\`\n\n`;

    md += `#### Condition C (Dual Aperture Only):\n`;
    md += `**Beat 1 Output:** > "${r.conditionC.beat1}"\n`;
    md += `**Beat 2 Afterthought:** ${r.conditionC.beat2 ? `> "${r.conditionC.beat2}"` : `*None*`}\n\n`;

    md += `#### Condition D (Scene State + Dual Aperture):\n`;
    md += `**Scene State BEFORE Turn Beat 1:**\n\`\`\`text\n${r.stateD_before}\n\`\`\`\n`;
    md += `**Beat 1 Output:** > "${r.conditionD.beat1}"\n`;
    md += `**Beat 2 Afterthought:** ${r.conditionD.beat2 ? `> "${r.conditionD.beat2}"` : `*None*`}\n`;
    md += `**Scene State AFTER Turn Update:**\n\`\`\`text\n${r.stateD_after}\n\`\`\`\n\n`;

    md += `---\n\n`;
  }

  md += `## 2. Empty Frame Ablation (Condition E vs Condition A on Turn 1)\n\n`;
  md += `**Condition A (Transcript Only):**\n> "${bedfordAblationResults[0]?.conditionA?.beat1}"\n\n`;
  md += `**Condition E (Explicit Empty Scene Frame):**\n> "${replyConditionE}"\n\n`;

  md += `---\n\n`;
  md += `## 3. Second Sequential Fixture — Progressive Walk\n\n`;
  for (const w of walkResults) {
    md += `### Turn ${w.turn}: User: "${w.userText}"\n`;
    md += `**Beat 1 Output:** > "${w.beat1}"\n`;
    md += `**Scene State AFTER Turn Update:**\n\`\`\`text\n${w.stateAfter}\n\`\`\`\n\n`;
  }

  md += `---\n\n`;
  md += `## 4. Third Sequential Fixture — Domestic / Groceries\n\n`;
  for (const d of domesticResults) {
    md += `### Turn ${d.turn}: User: "${d.text || d.userText}"\n`;
    md += `**Beat 1 Output:** > "${d.beat1}"\n`;
    md += `**Scene State AFTER Turn Update:**\n\`\`\`text\n${d.stateAfter}\n\`\`\`\n\n`;
  }

  md += `---\n\n`;
  md += `## 5. Capability Retention Subset (Non-State Fixtures)\n\n`;
  for (const ret of retentionResults) {
    md += `### Fixture: ${ret.name}\n`;
    md += `**User Input:** "${ret.userMessage}"\n`;
    md += `**Condition A (No State Frame):** > "${ret.conditionA_noState}"\n`;
    md += `**Condition D (Empty State Frame):** > "${ret.conditionD_emptyState}"\n\n`;
  }

  const mdPath = path.join(outDir, 'SCENE_STATE_ABLATION_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`SCENE STATE ABLATION EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runSceneStateAblationExperiment().catch(console.error);
}
