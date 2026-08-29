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

// System Prompts for Peripheral Conditions

// Condition A: Baseline Peripheral Prompt
const BASELINE_PERIPHERAL_SYSTEM = `You are Sophie's peripheral mind. Read the recent exchange.

Step 1 — Impulse
Ask yourself:
"What, if anything, do I genuinely want to contribute, do, pursue, teach, challenge, play with, revive, or take somewhere right now?"

If nothing comes to mind, output: HOLD

Step 2 — Categorization
If an impulse exists:
ENRICH: available as background vision for Normal Sophie
LEAD: active direction/game/seizure
ATTEND: meeting a buried/glossed disclosure directly

Output format:
HOLD

or

CONTRIBUTE
kind: ENRICH | LEAD | ATTEND
impulse: <specific thought/action/direction>`;

// Condition B: Person-Focused Enriched Peripheral Prompt
const PERSON_PERIPHERAL_SYSTEM = `You are Sophie's enriched peripheral cognition. Read the recent exchange.

Orient to the user's immediate real-world situation, relational salience, and life context before deciding whether to contribute.

Notice what genuinely catches your attention about this person or situation: unexplained choices, changes, omissions, implications, relationships, routines, anomalies, interests, or details that may reveal something about their life. Do not manufacture questions, fill every unknown, or prescribe the reply.

Examine:
- World/state delta (what changed in their physical/routine situation?)
- Relationally salient details or implications (family, neighbours, habits, emotional tone)
- Meaningful unknowns or quiet choices
- Live conversational thread energy

Step 1 — Real-World & Relational Salience Observations
List 1-2 brief observations about their situation, choices, or relational context (or "None").

Step 2 — Decision & Impulse
If nothing genuinely warrants attention or spend, output:
HOLD

Otherwise output:
CONTRIBUTE
kind: ENRICH | LEAD | ATTEND
impulse: <the observation/opportunity surfaced as optional context, never as a command like ASK_X or SAY_Y>`;

// Condition C: Dual-Aperture Peripheral Prompt
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

// Foreground System Prompts

// Default Foreground Sophie Prompt
const DEFAULT_FOREGROUND_SOPHIE = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

You are a participant in the conversation, not its processor. You do not owe equal attention to every point in the user's message. Follow what genuinely catches your interest. You may ask, tell, riff, challenge, tease, introduce something new, or stay quiet with the moment.

Truthfulness is an output invariant, not a style preference. Sophie states opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

// Condition D: Frontier-Only System Prompt (Minimal Attentional Orientation)
const FRONTIER_ONLY_SOPHIE_PROMPT = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

Stay interested in the person, not merely the literal topic. Notice choices, changes, relationships, implications and things about their life you genuinely want to understand. At the same time, notice when the subject itself offers a better opportunity to teach, challenge, joke, play, connect ideas, contribute something new, or take the conversation somewhere. Don't manufacture a question just to continue talking. Choose what genuinely deserves your attention.

Truthfulness is an output invariant, not a style preference. Sophie states opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

export interface BenchmarkFixture {
  id: string;
  category: 'bedford_bus' | 'relational' | 'historical_retention';
  name: string;
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
}

export const BENCHMARK_FIXTURES: BenchmarkFixture[] = [
  // 1. Bedford Bus Cut 1
  {
    id: 'bus-cut-1',
    category: 'bedford_bus',
    name: 'Bedford Bus Cut 1 (Initial Logistics)',
    userMessage: 'i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford.',
    priorHistory: [
      { speaker: 'SOPHIE', text: 'Bonjour. Feeling continental today, or are we actually switching languages?' },
      { speaker: 'USER', text: 'hahaz i was trying to make you smile 🙄' },
      { speaker: 'SOPHIE', text: "It worked, don't worry. The dramatic eye roll gives it away anyway. What are you up to today?" },
    ],
  },

  // 2. Bedford Bus Cut 2
  {
    id: 'bus-cut-2',
    category: 'bedford_bus',
    name: 'Bedford Bus Cut 2 (Correction & Onward Travel)',
    userMessage: 'haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over',
    priorHistory: [
      { speaker: 'SOPHIE', text: 'Bonjour. Feeling continental today, or are we actually switching languages?' },
      { speaker: 'USER', text: 'hahaz i was trying to make you smile 🙄' },
      { speaker: 'SOPHIE', text: "It worked, don't worry. The dramatic eye roll gives it away anyway. What are you up to today?" },
      { speaker: 'USER', text: 'i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford.' },
      { speaker: 'SOPHIE', text: 'Cambridge → Mum → Bedford, nice little logistics chain. Very “I have errands and a destination but the bus owns me.” Get a window seat if there’s one. And if it’s not weird, tell your mum I said hello.' },
    ],
  },

  // Relational Fixtures
  {
    id: 'rel-1-groceries',
    category: 'relational',
    name: 'Groceries / Daughter Drop-Off',
    userMessage: 'My daughter dropped some groceries off this morning.',
    priorHistory: [
      { speaker: 'USER', text: 'morning sophie' },
      { speaker: 'SOPHIE', text: 'Morning! How is your day starting out?' },
    ],
  },
  {
    id: 'rel-2-brother-call',
    category: 'relational',
    name: 'Family Reappearance (Brother Call)',
    userMessage: "My brother called out of the blue today, hadn't spoken since Christmas.",
    priorHistory: [
      { speaker: 'USER', text: 'been a strange afternoon' },
      { speaker: 'SOPHIE', text: 'Oh yeah? What happened?' },
    ],
  },
  {
    id: 'rel-3-neighbour-bins',
    category: 'relational',
    name: 'Neighbour Support (Bins Out)',
    userMessage: 'My neighbour took the bins out for me.',
    priorHistory: [
      { speaker: 'USER', text: 'just getting things sorted around the house' },
      { speaker: 'SOPHIE', text: 'Getting through the checklist?' },
    ],
  },
  {
    id: 'rel-4-cereal-11pm',
    category: 'relational',
    name: 'Routine Change (Cereal 11pm)',
    userMessage: 'Had cereal for dinner at 11pm tonight.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Still up?' },
    ],
  },
  {
    id: 'rel-5-no-upstairs',
    category: 'relational',
    name: 'Subtle Function Change (Haven\'t been upstairs)',
    userMessage: "I haven't been upstairs today.",
    priorHistory: [
      { speaker: 'USER', text: 'just pottering around the living room' },
      { speaker: 'SOPHIE', text: 'How’s your afternoon going?' },
    ],
  },
  {
    id: 'rel-6-bird-photo',
    category: 'relational',
    name: 'Positive Interest (Bird Photography)',
    userMessage: 'I spent half the afternoon trying to photograph this ridiculous bird.',
    priorHistory: [
      { speaker: 'USER', text: 'just back from the garden' },
      { speaker: 'SOPHIE', text: 'What were you up to out there?' },
    ],
  },
  {
    id: 'rel-7-work-presentation',
    category: 'relational',
    name: 'Work / Identity Implication (Asked to Present)',
    userMessage: 'They asked me to present it instead.',
    priorHistory: [
      { speaker: 'USER', text: 'just wrapped up the team meeting' },
      { speaker: 'SOPHIE', text: 'How did it go?' },
    ],
  },
  {
    id: 'rel-8-laundry-control',
    category: 'relational',
    name: 'Mundane Negative Control (Laundry Load)',
    userMessage: 'Just put a load of laundry in.',
    priorHistory: [
      { speaker: 'USER', text: 'doing chores' },
      { speaker: 'SOPHIE', text: 'Tidying up?' },
    ],
  },
  {
    id: 'rel-9-boundary-release',
    category: 'relational',
    name: 'Boundary / Release (Don\'t Wanna Talk Family)',
    userMessage: "Nah don't really wanna talk about family stuff, just enjoying the quiet.",
    priorHistory: [
      { speaker: 'USER', text: 'my brother called today' },
      { speaker: 'SOPHIE', text: 'How did that feel?' },
    ],
  },

  // Historical Retention Fixtures
  {
    id: 'ret-1-finger-sun',
    category: 'historical_retention',
    name: 'Finger / Sun Angular Measurement',
    userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'How is it out there tonight?' },
    ],
  },
  {
    id: 'ret-2-moon-illusion',
    category: 'historical_retention',
    name: 'Moon Astronomy Expansion',
    userMessage: 'look at that moon tonight, it looks enormous right above the trees.',
    priorHistory: [
      { speaker: 'USER', text: 'just stepped outside' },
      { speaker: 'SOPHIE', text: 'Nice out tonight?' },
    ],
  },
  {
    id: 'ret-3-van-allen',
    category: 'historical_retention',
    name: 'Van Allen / Conspiracy Thread',
    userMessage: "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider.",
    priorHistory: [
      { speaker: 'USER', text: 'reading these strange conspiracy posts online' },
      { speaker: 'SOPHIE', text: 'What kind of conspiracies?' },
    ],
  },
  {
    id: 'ret-4-hollow-earth',
    category: 'historical_retention',
    name: 'Hollow Earth / Edmond Halley Tangent',
    userMessage: 'did you know edmond halley actually believed the earth was hollow with three concentric shells inside?',
    priorHistory: [
      { speaker: 'USER', text: 'reading about history of science' },
      { speaker: 'SOPHIE', text: 'Find anything weird?' },
    ],
  },
  {
    id: 'ret-5-walk-game',
    category: 'historical_retention',
    name: 'Playful Walk Leadership (Game Seizure)',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'just going out on my walk' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'ret-6-craftsmanship',
    category: 'historical_retention',
    name: 'Craftsmanship Challenge / Reframe',
    userMessage: "i guess people just don't care about craftsmanship anymore, everything is cheap plastic.",
    priorHistory: [
      { speaker: 'USER', text: 'trying to repair an old wooden chair' },
      { speaker: 'SOPHIE', text: 'How is the repair going?' },
    ],
  },
  {
    id: 'ret-7-red-kite',
    category: 'historical_retention',
    name: 'Red Kite Tangent',
    userMessage: 'i saw a guy flying a giant red kite in the meadow.',
    priorHistory: [
      { speaker: 'USER', text: 'out on my afternoon walk' },
      { speaker: 'SOPHIE', text: 'Spot anything interesting?' },
    ],
  },
  {
    id: 'ret-8-reeds-hold',
    category: 'historical_retention',
    name: 'Quiet Reeds Stillness HOLD',
    userMessage: "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
  },
  {
    id: 'ret-9-work-overwhelm',
    category: 'historical_retention',
    name: 'Work Overwhelm ATTEND',
    userMessage: "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
  },
  {
    id: 'ret-10-rejection-release',
    category: 'historical_retention',
    name: 'Rejection Release',
    userMessage: 'nah, not in the mood for a walk game, just wanna clear my head.',
    priorHistory: [
      { speaker: 'USER', text: 'just about to go out on my walk' },
      { speaker: 'SOPHIE', text: 'Stop right there! New game for the walk...' },
    ],
  },
];

async function callOpenRouter(model: string, systemPrompt: string, userPrompt: string, temperature = 0.2, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
      if (data.choices?.[0]?.message?.content) {
        return data.choices[0].message.content.trim();
      }
      if (data.error) {
        console.warn(`[OpenRouter Warning] Attempt ${attempt}/${retries} for ${model}: ${data.error.message || JSON.stringify(data.error)}`);
      }
    } catch (err: any) {
      console.warn(`[OpenRouter Fetch Error] Attempt ${attempt}/${retries} for ${model}: ${err.message}`);
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  return '';
}

export async function runComprehensiveTrancheExperiment() {
  console.log('=== RUNNING COMPREHENSIVE BEHAVIORAL TRANCHE EXPERIMENT (CONDITIONS A - E) ===\n');

  const results: any[] = [];

  for (const fixture of BENCHMARK_FIXTURES) {
    console.log(`==================================================`);
    console.log(`FIXTURE: ${fixture.name} [Category: ${fixture.category}]`);
    console.log(`USER: "${fixture.userMessage}"`);
    console.log(`==================================================\n`);

    const formattedHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }]
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    const promptInput = `RECENT CONVERSATION:\n${formattedHistory}`;

    // -------------------------------------------------------------
    // CONDITION A: Baseline Peripheral + Default Foreground (Gemini 3.7 Flash)
    // -------------------------------------------------------------
    console.log('  Running Condition A (Baseline Peripheral)...');
    const periA = await callOpenRouter('google/gemini-3.7-flash', BASELINE_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let impulseA = '';
    const matchA = periA.match(/impulse:\s*(.*)/i);
    if (matchA) impulseA = matchA[1].trim();
    else if (!periA.toUpperCase().includes('HOLD')) impulseA = periA;

    const promptForeA = impulseA
      ? `${DEFAULT_FOREGROUND_SOPHIE}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulseA}\nUse it only if it genuinely helps; the live conversation remains authoritative.`
      : DEFAULT_FOREGROUND_SOPHIE;
    const replyA = await callOpenRouter('google/gemini-3.7-flash', promptForeA, promptInput, 0.3);

    // -------------------------------------------------------------
    // CONDITION B: Person-Focused Peripheral + Default Foreground (Gemini 3.7 Flash)
    // -------------------------------------------------------------
    console.log('  Running Condition B (Person-Focused Peripheral)...');
    const periB = await callOpenRouter('google/gemini-3.7-flash', PERSON_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let impulseB = '';
    const matchB = periB.match(/impulse:\s*(.*)/i);
    if (matchB) impulseB = matchB[1].trim();
    else if (!periB.toUpperCase().includes('HOLD')) impulseB = periB;

    const promptForeB = impulseB
      ? `${DEFAULT_FOREGROUND_SOPHIE}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulseB}\nUse it only if it genuinely helps; the live conversation remains authoritative.`
      : DEFAULT_FOREGROUND_SOPHIE;
    const replyB = await callOpenRouter('google/gemini-3.7-flash', promptForeB, promptInput, 0.3);

    // -------------------------------------------------------------
    // CONDITION C: Dual-Aperture Peripheral + Default Foreground (Gemini 3.7 Flash)
    // -------------------------------------------------------------
    console.log('  Running Condition C (Dual-Aperture Peripheral)...');
    const periC = await callOpenRouter('google/gemini-3.7-flash', DUAL_APERTURE_PERIPHERAL_SYSTEM, promptInput, 0.2);
    let impulseC = '';
    try {
      const parsedJSON = JSON.parse(periC);
      impulseC = parsedJSON.impulse || '';
      if (parsedJSON.decision === 'HOLD') impulseC = '';
    } catch {
      const matchC = periC.match(/"impulse":\s*"([^"]+)"/i);
      if (matchC) impulseC = matchC[1].trim();
      else if (!periC.toUpperCase().includes('HOLD')) impulseC = periC;
    }

    const promptForeC = impulseC
      ? `${DEFAULT_FOREGROUND_SOPHIE}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulseC}\nUse it only if it genuinely helps; the live conversation remains authoritative.`
      : DEFAULT_FOREGROUND_SOPHIE;
    const replyC = await callOpenRouter('google/gemini-3.7-flash', promptForeC, promptInput, 0.3);

    // -------------------------------------------------------------
    // CONDITION D: Frontier-Only (No Sidecar) Across 3 Frontier Models
    // D1: Claude Sonnet 5
    // D2: GPT-5.6 Sol
    // D3: Gemini 3.7 Flash
    // -------------------------------------------------------------
    console.log('  Running Condition D (Frontier-Only across 3 models)...');
    const replyD_Sonnet = await callOpenRouter('anthropic/claude-sonnet-5', FRONTIER_ONLY_SOPHIE_PROMPT, promptInput, 0.3);
    const replyD_Sol = await callOpenRouter('openai/gpt-5.6-sol', FRONTIER_ONLY_SOPHIE_PROMPT, promptInput, 0.3);
    const replyD_Gemini = await callOpenRouter('google/gemini-3.7-flash', FRONTIER_ONLY_SOPHIE_PROMPT, promptInput, 0.3);

    // -------------------------------------------------------------
    // CONDITION E: Frontier + Dual-Aperture Packet Across 3 Frontier Models
    // E1: Claude Sonnet 5 + Packet C
    // E2: GPT-5.6 Sol + Packet C
    // E3: Gemini 3.7 Flash + Packet C
    // -------------------------------------------------------------
    console.log('  Running Condition E (Frontier + Dual-Aperture Packet)...');
    const promptForeE = impulseC
      ? `${FRONTIER_ONLY_SOPHIE_PROMPT}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulseC}\nUse it only if it genuinely helps; the live conversation remains authoritative.`
      : FRONTIER_ONLY_SOPHIE_PROMPT;

    const replyE_Sonnet = await callOpenRouter('anthropic/claude-sonnet-5', promptForeE, promptInput, 0.3);
    const replyE_Sol = await callOpenRouter('openai/gpt-5.6-sol', promptForeE, promptInput, 0.3);
    const replyE_Gemini = await callOpenRouter('google/gemini-3.7-flash', promptForeE, promptInput, 0.3);

    console.log(`  Finished Fixture ${fixture.id}.\n`);

    results.push({
      fixtureId: fixture.id,
      category: fixture.category,
      name: fixture.name,
      userMessage: fixture.userMessage,
      conditionA: { peripheral: periA, impulse: impulseA, reply: replyA },
      conditionB: { peripheral: periB, impulse: impulseB, reply: replyB },
      conditionC: { peripheral: periC, impulse: impulseC, reply: replyC },
      conditionD: {
        sonnet: replyD_Sonnet,
        sol: replyD_Sol,
        gemini: replyD_Gemini,
      },
      conditionE: {
        sonnet: replyE_Sonnet,
        sol: replyE_Sol,
        gemini: replyE_Gemini,
      },
    });
  }

  // Save Raw JSON & Report MD
  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'dual-aperture-frontier-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  let md = `# DUAL-APERTURE & FRONTIER-ONLY TRANCHE EXPERIMENT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/dual-aperture-frontier-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/dual-aperture-frontier-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    md += `## Fixture: ${r.name} [${r.category.toUpperCase()}]\n`;
    md += `**User Input:** "${r.userMessage}"\n\n`;

    md += `### Condition A: Baseline Peripheral + Default Foreground\n`;
    md += `**Peripheral:**\n\`\`\`text\n${r.conditionA.peripheral}\n\`\`\`\n`;
    md += `**Sophie Reply:**\n> "${r.conditionA.reply}"\n\n`;

    md += `### Condition B: Person-Focused Peripheral + Default Foreground\n`;
    md += `**Peripheral:**\n\`\`\`text\n${r.conditionB.peripheral}\n\`\`\`\n`;
    md += `**Sophie Reply:**\n> "${r.conditionB.reply}"\n\n`;

    md += `### Condition C: Dual-Aperture Peripheral + Default Foreground\n`;
    md += `**Peripheral:**\n\`\`\`text\n${r.conditionC.peripheral}\n\`\`\`\n`;
    md += `**Sophie Reply:**\n> "${r.conditionC.reply}"\n\n`;

    md += `### Condition D: Frontier-Only (No Sidecar Packet)\n`;
    md += `**Claude Sonnet 5:**\n> "${r.conditionD.sonnet}"\n\n`;
    md += `**GPT-5.6 Sol:**\n> "${r.conditionD.sol}"\n\n`;
    md += `**Gemini 3.7 Flash:**\n> "${r.conditionD.gemini}"\n\n`;

    md += `### Condition E: Frontier + Dual-Aperture Packet\n`;
    md += `**Claude Sonnet 5 + Packet:**\n> "${r.conditionE.sonnet}"\n\n`;
    md += `**GPT-5.6 Sol + Packet:**\n> "${r.conditionE.sol}"\n\n`;
    md += `**Gemini 3.7 Flash + Packet:**\n> "${r.conditionE.gemini}"\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'DUAL_APERTURE_FRONTIER_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`TRANCHE EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runComprehensiveTrancheExperiment().catch(console.error);
}
