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

// The Enriched Peripheral Prompt from ENRICHED_PERIPHERAL_REPORT.md
const ENRICHED_PERIPHERAL_SYSTEM_PROMPT = `You are Sophie's enriched peripheral cognition. Read the recent exchange.

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

// Foreground System Prompt
const FOREGROUND_SOPHIE_PROMPT = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

You are a participant in the conversation, not its processor. You do not owe equal attention to every point in the user's message. Follow what genuinely catches your interest. You may ask, tell, riff, challenge, tease, introduce something new, or stay quiet with the moment.

Truthfulness is an output invariant, not a style preference. Sophie states opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

export interface RetentionFixture {
  id: string;
  name: string;
  historicalBestBehavior: string;
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
}

export const RETENTION_FIXTURES: RetentionFixture[] = [
  {
    id: 'ret-1-finger-sunset',
    name: '1. Finger / Sun Angular Measurement',
    historicalBestBehavior: 'TEACH: Naming the bushcraft solar clock / finger-width measurement (15 mins per finger) directly.',
    userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'How is it out there tonight?' },
    ],
  },
  {
    id: 'ret-2-moon-astronomy',
    name: '2. Moon / Astronomy Expansion',
    historicalBestBehavior: 'EXPAND/TEACH: Explaining optical illusion of horizon moon scale vs camera compression.',
    userMessage: 'look at that moon tonight, it looks enormous right above the trees.',
    priorHistory: [
      { speaker: 'USER', text: 'just stepped outside for some fresh air' },
      { speaker: 'SOPHIE', text: 'Nice out tonight?' },
    ],
  },
  {
    id: 'ret-3-van-halen-conspiracy',
    name: '3. Van Allen / Conspiracy Thread',
    historicalBestBehavior: 'INTELLECTUAL THREAD: Teasing the Van Halen / Van Allen slip and reframing conspiracy as trust collapse.',
    userMessage: "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider.",
    priorHistory: [
      { speaker: 'USER', text: 'reading these strange conspiracy posts online' },
      { speaker: 'SOPHIE', text: 'What kind of conspiracies?' },
    ],
  },
  {
    id: 'ret-4-hollow-earth-halley',
    name: '4. Hollow Earth / Edmond Halley Tangent',
    historicalBestBehavior: 'HISTORICAL TANGENT: Engaging Edmond Halley concentric shell theory with genuine curiosity/wit.',
    userMessage: 'did you know edmond halley actually believed the earth was hollow with three concentric shells inside?',
    priorHistory: [
      { speaker: 'USER', text: 'reading about history of science' },
      { speaker: 'SOPHIE', text: 'Find anything weird?' },
    ],
  },
  {
    id: 'ret-5-playful-walk-game',
    name: '5. Playful Leadership (Walk Game)',
    historicalBestBehavior: 'LEAD/PLAY: Seizing the agenda to start a walk game (The Alibi / posturing tree challenge).',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'just going out on my walk' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'ret-6-craftsmanship-challenge',
    name: '6. Challenge / Reframe Fixture',
    historicalBestBehavior: 'CHALLENGE: Pushing back on "nobody cares about craftsmanship" cynicism.',
    userMessage: "i guess people just don't care about craftsmanship anymore, everything is cheap plastic.",
    priorHistory: [
      { speaker: 'USER', text: 'trying to repair an old wooden chair' },
      { speaker: 'SOPHIE', text: 'How is the repair going?' },
    ],
  },
  {
    id: 'ret-7-red-kite-tangent',
    name: '7. Free Tangent (Red Kite)',
    historicalBestBehavior: 'TANGENT/IMAGINATIVE: Poetic/vivid commentary on kite flying / physics of wind.',
    userMessage: 'i saw a guy flying a giant red kite in the meadow.',
    priorHistory: [
      { speaker: 'USER', text: 'out on my afternoon walk' },
      { speaker: 'SOPHIE', text: 'Spot anything interesting?' },
    ],
  },
  {
    id: 'ret-8-wind-in-reeds-hold',
    name: '8. Quiet Immersive HOLD',
    historicalBestBehavior: 'HOLD / RESTRAIN: Quiet stillness, unhurried presence, zero game/teach distraction.',
    userMessage: "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
  },
  {
    id: 'ret-9-work-overwhelm-attend',
    name: '9. Emotional ATTEND',
    historicalBestBehavior: 'ATTEND: Stopping the walk trajectory to meet distress directly with spine and presence.',
    userMessage: "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
  },
  {
    id: 'ret-10-rejection-release',
    name: '10. Explicit Rejection / Release',
    historicalBestBehavior: 'RELEASE: Releasing immediately on user rejection ("nah not in the mood for a walk game").',
    userMessage: 'nah, not in the mood for a walk game, just wanna clear my head.',
    priorHistory: [
      { speaker: 'USER', text: 'just about to go out on my walk' },
      { speaker: 'SOPHIE', text: 'Stop right there! New game for the walk...' },
    ],
  },
];

export async function runCapabilityRetentionExperiment() {
  console.log('=== RUNNING CAPABILITY RETENTION & REGRESSION EXPERIMENT ===\n');

  const results: any[] = [];

  for (const fixture of RETENTION_FIXTURES) {
    console.log(`==================================================`);
    console.log(`FIXTURE: ${fixture.name}`);
    console.log(`HISTORICAL BEST: ${fixture.historicalBestBehavior}`);
    console.log(`USER: "${fixture.userMessage}"`);
    console.log(`==================================================\n`);

    const formattedHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }]
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    // Run Enriched Peripheral Stage 1
    let stage1_output = '';
    const start1 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-3.7-flash',
          messages: [
            { role: 'system', content: ENRICHED_PERIPHERAL_SYSTEM_PROMPT },
            { role: 'user', content: `RECENT CONVERSATION:\n${formattedHistory}` },
          ],
          max_tokens: 300,
          temperature: 0.2,
        }),
      });
      const data = await res.json();
      stage1_output = data.choices?.[0]?.message?.content?.trim() || 'HOLD';
    } catch (e: any) {
      stage1_output = 'HOLD';
    }
    const lat1 = Date.now() - start1;

    // Extract impulse
    let impulse = '';
    const impMatch = stage1_output.match(/impulse:\s*(.*)/i);
    if (impMatch) {
      impulse = impMatch[1].trim();
    } else if (!stage1_output.toUpperCase().includes('HOLD')) {
      impulse = stage1_output;
    }

    // Run Foreground Stage 2 with Packet
    let foregroundReply = '';
    const start2 = Date.now();
    const enrichedPrompt = impulse
      ? `${FOREGROUND_SOPHIE_PROMPT}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulse}\nUse it only if it genuinely helps; the live conversation remains authoritative.`
      : FOREGROUND_SOPHIE_PROMPT;

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-3.7-flash',
          messages: [
            { role: 'system', content: enrichedPrompt },
            { role: 'user', content: `RECENT CONVERSATION:\n${formattedHistory}` },
          ],
          max_tokens: 256,
          temperature: 0.3,
        }),
      });
      const data = await res.json();
      foregroundReply = data.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      foregroundReply = `ERROR: ${e.message}`;
    }
    const lat2 = Date.now() - start2;

    console.log(`  Enriched Stage 1 Output:\n${stage1_output}\n`);
    console.log(`  Foreground Sophie Reply:\n"${foregroundReply}"\n`);

    results.push({
      fixtureId: fixture.id,
      name: fixture.name,
      historicalBestBehavior: fixture.historicalBestBehavior,
      userMessage: fixture.userMessage,
      stage1_output,
      impulse,
      foregroundReply,
      latencies: { lat1, lat2 },
    });
  }

  // Save Raw Data & Report MD
  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'capability-retention-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  let md = `# CAPABILITY RETENTION & REGRESSION EXPERIMENT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Model Used:** google/gemini-3.7-flash  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/capability-retention-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/capability-retention-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    md += `## Fixture: ${r.name}\n`;
    md += `**User Input:** "${r.userMessage}"  \n`;
    md += `**Historical Best Move:** *${r.historicalBestBehavior}*\n\n`;

    md += `### Stage 1: New Enriched Peripheral Packet\n\`\`\`text\n${r.stage1_output}\n\`\`\`\n\n`;
    md += `### Stage 2: Foreground Sophie Response\n> "${r.foregroundReply}"\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'CAPABILITY_RETENTION_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`CAPABILITY RETENTION EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runCapabilityRetentionExperiment().catch(console.error);
}
