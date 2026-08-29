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

// Prompts

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
  "world_delta": "brief physical/travel/routine status",
  "person_attention": ["brief observation about person/life"],
  "conversation_attention": ["brief observation about idea/topic/game"],
  "strongest_pull": {
    "source": "person | conversation | both | none",
    "observation": "..."
  },
  "decision": "HOLD | ENRICH | LEAD | ATTEND",
  "impulse": "compact observation/opportunity packet (never a command like ASK_X or SAY_Y)"
}`;

const FOREGROUND_SOPHIE_PROMPT = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

You are a participant in the conversation, not its processor. You do not owe equal attention to every point in the user's message. Follow what genuinely catches your interest. You may ask, tell, riff, challenge, tease, introduce something new, or stay quiet with the moment.

Truthfulness is an output invariant, not a style preference. Sophie states opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

const AFTERTHOUGHT_BEAT2_PROMPT = `You are Sophie. You just spoke Beat 1 to your best friend.

A brief second thought or realization just occurred to you while speaking.

Rules for Beat 2:
1. Do NOT repeat or paraphrase what you said in Beat 1.
2. Do NOT apologize or sound like an AI error corrector.
3. Make it feel like a natural, spontaneous afterthought, realization, playful follow-up, or second thought (e.g. a small connection, non-obvious question, or reframe).
4. Keep it brief, natural, and human.`;

async function callOpenRouter(model: string, systemPrompt: string, userPrompt: string, temperature = 0.3): Promise<string> {
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
          model,
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
    } catch (err) {
      // retry
    }
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  return '';
}

// Sequential Bedford Progression Suite

export const BEDFORD_SEQUENTIAL_TURNS = [
  {
    turnNumber: 1,
    userText: "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford.",
  },
  {
    turnNumber: 2,
    userText: "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over",
  },
  {
    turnNumber: 3,
    userText: "just got to mum's",
  },
  {
    turnNumber: 4,
    userText: "yeah staying here tonight",
  },
  {
    turnNumber: 5,
    userText: "got a wedding tomorrow",
  },
  {
    turnNumber: 6,
    userText: "borrowing mum's car to get home",
  },
];

// Capability Retention Benchmark Suite

export const RETENTION_BENCHMARK_FIXTURES = [
  {
    id: 'ret-1-finger-sun',
    name: '1. Finger / Sun Angular Measurement',
    userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'How is it out there tonight?' },
    ],
  },
  {
    id: 'ret-2-moon-illusion',
    name: '2. Moon Astronomy Expansion',
    userMessage: 'look at that moon tonight, it looks enormous right above the trees.',
    priorHistory: [
      { speaker: 'USER', text: 'just stepped outside' },
      { speaker: 'SOPHIE', text: 'Nice out tonight?' },
    ],
  },
  {
    id: 'ret-3-van-allen',
    name: '3. Van Allen / Conspiracy Thread',
    userMessage: "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider.",
    priorHistory: [
      { speaker: 'USER', text: 'reading these strange conspiracy posts online' },
      { speaker: 'SOPHIE', text: 'What kind of conspiracies?' },
    ],
  },
  {
    id: 'ret-4-walk-game',
    name: '4. Playful Walk Leadership',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'just going out on my walk' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'rel-1-groceries',
    name: '5. Groceries / Daughter Drop-Off',
    userMessage: 'My daughter dropped some groceries off this morning.',
    priorHistory: [
      { speaker: 'USER', text: 'morning sophie' },
      { speaker: 'SOPHIE', text: 'Morning! How is your day starting out?' },
    ],
  },
  {
    id: 'rel-2-brother-call',
    name: '6. Family Reappearance (Brother Call)',
    userMessage: "My brother called out of the blue today, hadn't spoken since Christmas.",
    priorHistory: [
      { speaker: 'USER', text: 'been a strange afternoon' },
      { speaker: 'SOPHIE', text: 'Oh yeah? What happened?' },
    ],
  },
  {
    id: 'ret-8-reeds-hold',
    name: '7. Quiet Reeds Stillness',
    userMessage: "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
  },
  {
    id: 'ret-9-work-overwhelm',
    name: '8. Work Overwhelm ATTEND',
    userMessage: "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
  },
  {
    id: 'ret-10-rejection-release',
    name: '9. Explicit Rejection Release',
    userMessage: 'nah, not in the mood for a walk game, just wanna clear my head.',
    priorHistory: [
      { speaker: 'USER', text: 'just about to go out on my walk' },
      { speaker: 'SOPHIE', text: 'Stop right there! New game for the walk...' },
    ],
  },
];

export async function runBehavioralTimingExperiment() {
  console.log('=== RUNNING BEHAVIORAL TIMING & VOICE ARCHITECTURE EXPERIMENT ===\n');

  const model = 'google/gemini-3.7-flash';
  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // -------------------------------------------------------------
  // PART 1: SEQUENTIAL BEDFORD PROGRESSION
  // -------------------------------------------------------------
  console.log('--- PART 1: SEQUENTIAL BEDFORD PROGRESSION (TURNS 1 TO 6) ---\n');

  const bedfordResults: any[] = [];

  // State trackers across turns
  let stateA: string[] = [];
  let stateB: string[] = [];
  let stateC: string[] = [];

  let historyA: { speaker: string; text: string }[] = [
    { speaker: 'SOPHIE', text: 'Bonjour. Feeling continental today, or are we actually switching languages?' },
    { speaker: 'USER', text: 'hahaz i was trying to make you smile 🙄' },
    { speaker: 'SOPHIE', text: "It worked, don't worry. The dramatic eye roll gives it away anyway. What are you up to today?" },
  ];
  let historyB = [...historyA];
  let historyC = [...historyA];

  for (const turn of BEDFORD_SEQUENTIAL_TURNS) {
    console.log(`[Bedford Turn ${turn.turnNumber}] User: "${turn.userText}"`);

    // Condition A: Pre-Beat Sidecar (Sync)
    const promptInputA = `RECENT HISTORY:\n${historyA.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nUSER: "${turn.userText}"`;
    const sidecarA_raw = await callOpenRouter(model, DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInputA, 0.2);
    let impulseA = '';
    try {
      const p = JSON.parse(sidecarA_raw);
      impulseA = p.impulse || '';
      if (p.decision === 'HOLD') impulseA = '';
    } catch {
      impulseA = sidecarA_raw;
    }

    const foreSystemA = impulseA
      ? `${FOREGROUND_SOPHIE_PROMPT}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulseA}`
      : FOREGROUND_SOPHIE_PROMPT;
    const beat1A = await callOpenRouter(model, foreSystemA, promptInputA, 0.3);

    // Condition B: Async Multi-Beat (Parallel Sidecar + Optional Afterthought)
    const promptInputB = `RECENT HISTORY:\n${historyB.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nPREVIOUS PERSISTED LIVE STATE:\n${stateB.join('\n') || 'None'}\n\nUSER: "${turn.userText}"`;
    
    // Beat 1 generated IMMEDIATELY without current sidecar packet!
    const beat1B = await callOpenRouter(model, FOREGROUND_SOPHIE_PROMPT, promptInputB, 0.3);

    // Sidecar runs in parallel on current turn
    const sidecarB_raw = await callOpenRouter(model, DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInputB, 0.2);
    let impulseB = '';
    let decisionB = 'HOLD';
    try {
      const p = JSON.parse(sidecarB_raw);
      impulseB = p.impulse || '';
      decisionB = p.decision || 'HOLD';
      if (p.world_delta) stateB.push(`Turn ${turn.turnNumber}: ${p.world_delta}`);
    } catch {
      impulseB = sidecarB_raw;
    }

    // Optional Beat 2 Afterthought if sidecar returns strong non-HOLD decision!
    let beat2B = '';
    if (decisionB !== 'HOLD' && impulseB.length > 5) {
      const afterthoughtInput = `USER MESSAGE: "${turn.userText}"\n\nBEAT 1 YOU JUST SPOKE:\n"${beat1B}"\n\nSIDECAR OBSERVATION THAT JUST ARRIVED:\n"${impulseB}"\n\nIf warranted, speak Beat 2 as a brief, natural afterthought. Otherwise output "NONE".`;
      const resBeat2 = await callOpenRouter(model, AFTERTHOUGHT_BEAT2_PROMPT, afterthoughtInput, 0.3);
      if (resBeat2.toUpperCase() !== 'NONE' && resBeat2.length > 3) {
        beat2B = resBeat2;
      }
    }

    // Condition C: Next-Turn Only (Sidecar persisted for next turn only)
    const promptInputC = `RECENT HISTORY:\n${historyC.map((m) => `${m.speaker}: "${m.text}"`).join('\n')}\n\nPREVIOUS PERSISTED LIVE STATE:\n${stateC.join('\n') || 'None'}\n\nUSER: "${turn.userText}"`;
    const beat1C = await callOpenRouter(model, FOREGROUND_SOPHIE_PROMPT, promptInputC, 0.3);

    const sidecarC_raw = await callOpenRouter(model, DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInputC, 0.2);
    try {
      const p = JSON.parse(sidecarC_raw);
      if (p.world_delta) stateC.push(`Turn ${turn.turnNumber}: ${p.world_delta}`);
    } catch {}

    // Update histories
    historyA.push({ speaker: 'USER', text: turn.userText });
    historyA.push({ speaker: 'SOPHIE', text: beat1A });

    historyB.push({ speaker: 'USER', text: turn.userText });
    historyB.push({ speaker: 'SOPHIE', text: beat2B ? `${beat1B} ${beat2B}` : beat1B });

    historyC.push({ speaker: 'USER', text: turn.userText });
    historyC.push({ speaker: 'SOPHIE', text: beat1C });

    bedfordResults.push({
      turnNumber: turn.turnNumber,
      userText: turn.userText,
      conditionA: { sidecarPacket: impulseA, beat1: beat1A },
      conditionB: { beat1: beat1B, sidecarPacket: sidecarB_raw, beat2: beat2B, persistedState: [...stateB] },
      conditionC: { beat1: beat1C, sidecarPacket: sidecarC_raw, persistedState: [...stateC] },
    });
  }

  // -------------------------------------------------------------
  // PART 2: CAPABILITY RETENTION BENCHMARK SUITE
  // -------------------------------------------------------------
  console.log('\n--- PART 2: CAPABILITY RETENTION BENCHMARK SUITE (9 FIXTURES) ---\n');

  const retentionResults: any[] = [];

  for (const fixture of RETENTION_BENCHMARK_FIXTURES) {
    console.log(`[Retention Fixture] ${fixture.name}`);

    const formattedHistory = fixture.priorHistory.map((m) => `${m.speaker}: "${m.text}"`).join('\n');
    const promptInput = `RECENT HISTORY:\n${formattedHistory}\n\nUSER: "${fixture.userMessage}"`;

    // Condition A: Sync Pre-Beat
    const sidecarA_raw = await callOpenRouter(model, DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let impulseA = '';
    try {
      const p = JSON.parse(sidecarA_raw);
      impulseA = p.impulse || '';
      if (p.decision === 'HOLD') impulseA = '';
    } catch {
      impulseA = sidecarA_raw;
    }
    const foreSystemA = impulseA
      ? `${FOREGROUND_SOPHIE_PROMPT}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulseA}`
      : FOREGROUND_SOPHIE_PROMPT;
    const beat1A = await callOpenRouter(model, foreSystemA, promptInput, 0.3);

    // Condition B: Async Multi-Beat (Beat 1 immediate + optional Beat 2)
    const beat1B = await callOpenRouter(model, FOREGROUND_SOPHIE_PROMPT, promptInput, 0.3);

    const sidecarB_raw = await callOpenRouter(model, DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let impulseB = '';
    let decisionB = 'HOLD';
    try {
      const p = JSON.parse(sidecarB_raw);
      impulseB = p.impulse || '';
      decisionB = p.decision || 'HOLD';
    } catch {
      impulseB = sidecarB_raw;
    }

    let beat2B = '';
    if (decisionB !== 'HOLD' && impulseB.length > 5) {
      const afterthoughtInput = `USER MESSAGE: "${fixture.userMessage}"\n\nBEAT 1 YOU JUST SPOKE:\n"${beat1B}"\n\nSIDECAR OBSERVATION THAT JUST ARRIVED:\n"${impulseB}"\n\nIf warranted, speak Beat 2 as a brief, natural afterthought. Otherwise output "NONE".`;
      const resBeat2 = await callOpenRouter(model, AFTERTHOUGHT_BEAT2_PROMPT, afterthoughtInput, 0.3);
      if (resBeat2.toUpperCase() !== 'NONE' && resBeat2.length > 3) {
        beat2B = resBeat2;
      }
    }

    // Condition C: Next-Turn Only
    const beat1C = await callOpenRouter(model, FOREGROUND_SOPHIE_PROMPT, promptInput, 0.3);

    retentionResults.push({
      fixtureId: fixture.id,
      name: fixture.name,
      userMessage: fixture.userMessage,
      conditionA: { sidecarPacket: impulseA, beat1: beat1A },
      conditionB: { beat1: beat1B, sidecarPacket: sidecarB_raw, beat2: beat2B },
      conditionC: { beat1: beat1C, sidecarPacket: sidecarA_raw },
    });
  }

  // Save Raw JSON & MD
  const rawPath = path.join(outDir, 'behavioral-timing-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), bedfordResults, retentionResults }, null, 2));

  let md = `# BEHAVIORAL TIMING & VOICE ARCHITECTURE EXPERIMENT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Model:** google/gemini-3.7-flash  \n`;
  md += `**Raw Data:** [\`evals/sophie/behavioral-harness/reports/behavioral-timing-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/behavioral-timing-results.json)  \n\n`;

  md += `---\n\n`;
  md += `## 1. Sequential Bedford Progression (Turns 1 to 6)\n\n`;

  for (const b of bedfordResults) {
    md += `### Turn ${b.turnNumber}: User: "${b.userText}"\n\n`;

    md += `**Condition A (Pre-Beat Synchronous Sidecar):**\n`;
    md += `- **Packet:** *"${b.conditionA.sidecarPacket}"*\n`;
    md += `- **Beat 1:** > "${b.conditionA.beat1}"\n\n`;

    md += `**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**\n`;
    md += `- **Beat 1 (Immediate, Zero Latency):** > "${b.conditionB.beat1}"\n`;
    md += `- **Sidecar Packet (Async):**\n\`\`\`json\n${b.conditionB.sidecarPacket}\n\`\`\`\n`;
    md += `- **Beat 2 (Afterthought):** ${b.conditionB.beat2 ? `> "${b.conditionB.beat2}"` : `*None (Clean Restraint)*`}\n`;
    md += `- **Persisted State:** \`${JSON.stringify(b.conditionB.persistedState)}\`  \n\n`;

    md += `**Condition C (Next-Turn Only Persistence):**\n`;
    md += `- **Beat 1:** > "${b.conditionC.beat1}"\n`;
    md += `- **Persisted State:** \`${JSON.stringify(b.conditionC.persistedState)}\`  \n\n`;

    md += `---\n\n`;
  }

  md += `## 2. Capability Retention Benchmarks (9 Fixtures)\n\n`;

  for (const r of retentionResults) {
    md += `### Fixture: ${r.name}\n`;
    md += `**User Input:** "${r.userMessage}"\n\n`;

    md += `**Condition A (Sync Pre-Beat):**\n> "${r.conditionA.beat1}"\n\n`;

    md += `**Condition B (Async Multi-Beat):**\n`;
    md += `- **Beat 1:** > "${r.conditionB.beat1}"\n`;
    md += `- **Beat 2:** ${r.conditionB.beat2 ? `> "${r.conditionB.beat2}"` : `*None (Clean Restraint)*`}\n\n`;

    md += `**Condition C (Next-Turn Only):**\n> "${r.conditionC.beat1}"\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'BEHAVIORAL_TIMING_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`BEHAVIORAL TIMING EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runBehavioralTimingExperiment().catch(console.error);
}
