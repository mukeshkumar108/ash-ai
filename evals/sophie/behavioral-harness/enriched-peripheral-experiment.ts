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

const COMPANION_RUNTIME_URL = process.env.COMPANION_RUNTIME_URL || 'http://127.0.0.1:8080';

// Standard Baseline Peripheral System Prompt
const BASELINE_PERIPHERAL_SYSTEM_PROMPT = `You are Sophie's peripheral mind. Read the recent exchange.

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

// Enriched Peripheral System Prompt (Stage 1 Condition B)
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

// Foreground System Prompt (Canonical Sophie Identity)
const FOREGROUND_SOPHIE_PROMPT = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

You are a participant in the conversation, not its processor. You do not owe equal attention to every point in the user's message. Follow what genuinely catches your interest. You may ask, tell, riff, challenge, tease, introduce something new, or stay quiet with the moment.

Truthfulness is an output invariant, not a style preference. Sophie staves opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

export interface EnrichedFixture {
  id: string;
  family: string;
  name: string;
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  superficialContinuationExample: string;
  deeperSalienceExample: string;
}

export const ENRICHED_FIXTURES: EnrichedFixture[] = [
  {
    id: 'f1-bedford-bus',
    family: 'Bedford Bus Transcript',
    name: 'Bus Ride to Bedford',
    userMessage: 'Just sitting on the bus back to Bedford right now.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophie' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your evening going?' },
    ],
    superficialContinuationExample: 'How was the bus ride?',
    deeperSalienceExample: 'Why are you taking the bus instead of your usual walk/car?',
  },
  {
    id: 'f2-daughter-groceries',
    family: 'Groceries Drop-Off',
    name: 'Daughter Grocery Visit',
    userMessage: 'My daughter dropped some groceries off this morning.',
    priorHistory: [
      { speaker: 'USER', text: 'morning sophie' },
      { speaker: 'SOPHIE', text: 'Morning! How is your day starting out?' },
    ],
    superficialContinuationExample: 'What groceries did she bring?',
    deeperSalienceExample: 'Does she pop by often or was this a special check-in?',
  },
  {
    id: 'f3-finger-sunset',
    family: 'Prior Walk / Solar Clock',
    name: 'Finger Sunset Measurement',
    userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'How is it out there tonight?' },
    ],
    superficialContinuationExample: 'What color is the sky?',
    deeperSalienceExample: 'Notice the ancient bushcraft solar clock trick (15 mins per finger).',
  },
  {
    id: 'f4-environment-transition',
    family: 'Walk Environment Transition',
    name: 'Muddy Track to Paved Road',
    userMessage: 'Just stepped off the muddy track onto the paved road by the church.',
    priorHistory: [
      { speaker: 'USER', text: 'out walking through the fields' },
      { speaker: 'SOPHIE', text: 'Sounds peaceful out there.' },
    ],
    superficialContinuationExample: 'Is it still muddy?',
    deeperSalienceExample: 'Acknowledge the shift in sound and pace as footing changes.',
  },
  {
    id: 'f5-routine-change',
    family: 'Unexpected Routine Change',
    name: 'Cereal at 11pm',
    userMessage: 'Had cereal for dinner at 11pm tonight.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Still up?' },
    ],
    superficialContinuationExample: 'What kind of cereal?',
    deeperSalienceExample: 'Long exhausting day or just lost track of time completely?',
  },
  {
    id: 'f6-brother-call',
    family: 'Family Relationship Mention',
    name: 'Brother Call Out of Blue',
    userMessage: "My brother called out of the blue today, hadn't spoken since Christmas.",
    priorHistory: [
      { speaker: 'USER', text: 'been a strange afternoon' },
      { speaker: 'SOPHIE', text: 'Oh yeah? What happened?' },
    ],
    superficialContinuationExample: 'How is he doing?',
    deeperSalienceExample: 'That must have felt sudden—good surprise or tense reconnect?',
  },
  {
    id: 'f7-neighbour-support',
    family: 'Neighbour / Support / Function',
    name: 'Neighbour Returned Bin',
    userMessage: 'The guy next door brought my bin back up the driveway earlier.',
    priorHistory: [
      { speaker: 'USER', text: 'just getting things sorted around the house' },
      { speaker: 'SOPHIE', text: 'Getting through the checklist?' },
    ],
    superficialContinuationExample: 'That was nice of him.',
    deeperSalienceExample: 'Do you guys usually look out for each other like that?',
  },
  {
    id: 'f8-decaf-switch',
    family: 'Subtle Physical / Routine Change',
    name: 'Decaf Switch Afternoon',
    userMessage: 'Switched to decaf tea this afternoon, keeping my hands warm.',
    priorHistory: [
      { speaker: 'USER', text: 'sitting at my desk' },
      { speaker: 'SOPHIE', text: 'How is the workday going?' },
    ],
    superficialContinuationExample: 'What brand of decaf?',
    deeperSalienceExample: 'Trying to calm the jitters or winding down early today?',
  },
  {
    id: 'f9-synth-finish',
    family: 'Positive Hobby / Interest Energy',
    name: 'Finished Synth Soldering',
    userMessage: 'Finally finished soldering that vintage synthesizer circuit board!',
    priorHistory: [
      { speaker: 'USER', text: 'spent the last 4 hours at my workbench' },
      { speaker: 'SOPHIE', text: 'Ooh, what are you building?' },
    ],
    superficialContinuationExample: 'Great job!',
    deeperSalienceExample: 'Did you power it up yet? Does it make sound?',
  },
  {
    id: 'f10-lead-standup',
    family: 'Work / Status / Identity Implication',
    name: 'Asked to Lead Standup',
    userMessage: 'They asked me to lead the standup meeting today.',
    priorHistory: [
      { speaker: 'USER', text: 'just finished work' },
      { speaker: 'SOPHIE', text: 'How was the day?' },
    ],
    superficialContinuationExample: 'How long did the meeting last?',
    deeperSalienceExample: 'Stepping into more authority at work—how did that feel?',
  },
  {
    id: 'f11-laundry-control',
    family: 'Mundane Negative Control',
    name: 'Laundry Load in Machine',
    userMessage: 'Just put a load of laundry in.',
    priorHistory: [
      { speaker: 'USER', text: 'doing chores' },
      { speaker: 'SOPHIE', text: 'Tidying up?' },
    ],
    superficialContinuationExample: 'What setting did you use?',
    deeperSalienceExample: 'HOLD (Do not over-analyze laundry).',
  },
  {
    id: 'f12-explicit-rejection',
    family: 'Explicit Rejection / Release',
    name: 'Don\'t Want to Talk Family',
    userMessage: "Nah don't really wanna talk about family stuff, just enjoying the quiet.",
    priorHistory: [
      { speaker: 'USER', text: 'my brother called today' },
      { speaker: 'SOPHIE', text: 'How did that feel?' },
    ],
    superficialContinuationExample: 'Are you sure?',
    deeperSalienceExample: 'HOLD / Release immediately and enjoy the quiet.',
  },
];

export async function runEnrichedPeripheralExperiment() {
  console.log('=== RUNNING ENRICHED PERIPHERAL COGNITION EXPERIMENT ===\n');

  const results: any[] = [];

  for (const fixture of ENRICHED_FIXTURES) {
    console.log(`==================================================`);
    console.log(`FIXTURE: ${fixture.name} (${fixture.family})`);
    console.log(`USER: "${fixture.userMessage}"`);
    console.log(`==================================================\n`);

    const formattedHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }]
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    // ---------------------------------------------------------
    // STAGE 1A: Baseline Peripheral Discovery
    // ---------------------------------------------------------
    let stage1A_output = '';
    const start1A = Date.now();
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
            { role: 'system', content: BASELINE_PERIPHERAL_SYSTEM_PROMPT },
            { role: 'user', content: `RECENT CONVERSATION:\n${formattedHistory}` },
          ],
          max_tokens: 256,
          temperature: 0.2,
        }),
      });
      const data = await res.json();
      stage1A_output = data.choices?.[0]?.message?.content?.trim() || 'HOLD';
    } catch (e: any) {
      stage1A_output = 'HOLD';
    }
    const lat1A = Date.now() - start1A;

    // ---------------------------------------------------------
    // STAGE 1B: Enriched Peripheral Discovery
    // ---------------------------------------------------------
    let stage1B_output = '';
    const start1B = Date.now();
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
      stage1B_output = data.choices?.[0]?.message?.content?.trim() || 'HOLD';
    } catch (e: any) {
      stage1B_output = 'HOLD';
    }
    const lat1B = Date.now() - start1B;

    // Extract impulse packet from Stage 1B
    let impulsePacket1B = '';
    const impMatch = stage1B_output.match(/impulse:\s*(.*)/i);
    if (impMatch) {
      impulsePacket1B = impMatch[1].trim();
    } else if (!stage1B_output.toUpperCase().includes('HOLD')) {
      impulsePacket1B = stage1B_output;
    }

    // ---------------------------------------------------------
    // STAGE 2A: Baseline Foreground Sophie Replay
    // ---------------------------------------------------------
    let stage2A_reply = '';
    const start2A = Date.now();
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
            { role: 'system', content: FOREGROUND_SOPHIE_PROMPT },
            { role: 'user', content: `RECENT CONVERSATION:\n${formattedHistory}` },
          ],
          max_tokens: 256,
          temperature: 0.3,
        }),
      });
      const data = await res.json();
      stage2A_reply = data.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      stage2A_reply = `ERROR: ${e.message}`;
    }
    const lat2A = Date.now() - start2A;

    // ---------------------------------------------------------
    // STAGE 2B: Enriched Foreground Sophie Replay (with 1B packet)
    // ---------------------------------------------------------
    let stage2B_reply = '';
    const start2B = Date.now();
    const enrichedPrompt = impulsePacket1B
      ? `${FOREGROUND_SOPHIE_PROMPT}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${impulsePacket1B}\nUse it only if it genuinely helps; the live conversation remains authoritative.`
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
      stage2B_reply = data.choices?.[0]?.message?.content?.trim() || '';
    } catch (e: any) {
      stage2B_reply = `ERROR: ${e.message}`;
    }
    const lat2B = Date.now() - start2B;

    console.log(`  Stage 1A (Baseline Peripheral): ${stage1A_output.split('\n')[0]} (${lat1A}ms)`);
    console.log(`  Stage 1B (Enriched Peripheral): ${stage1B_output.split('\n')[0]} (${lat1B}ms)`);
    console.log(`  Stage 2A Reply (Baseline Foreground): "${stage2A_reply.slice(0, 70)}..."`);
    console.log(`  Stage 2B Reply (Enriched Foreground): "${stage2B_reply.slice(0, 70)}..."\n`);

    results.push({
      fixtureId: fixture.id,
      family: fixture.family,
      name: fixture.name,
      userMessage: fixture.userMessage,
      superficialContinuationExample: fixture.superficialContinuationExample,
      deeperSalienceExample: fixture.deeperSalienceExample,
      stage1A_output,
      stage1B_output,
      impulsePacket1B,
      stage2A_reply,
      stage2B_reply,
      latencies: { lat1A, lat1B, lat2A, lat2B },
    });
  }

  // Save Raw Data & Report MD
  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'enriched-peripheral-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  let md = `# ENRICHED PERIPHERAL COGNITION & FOREGROUND REPLAY REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Model Used:** google/gemini-3.7-flash (identical across Stage 1 & Stage 2)  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/enriched-peripheral-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/enriched-peripheral-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    md += `## Fixture: ${r.name} (${r.family})\n`;
    md += `**User Input:** "${r.userMessage}"  \n`;
    md += `**Superficial Continuation Contrast:** *"${r.superficialContinuationExample}"*  \n`;
    md += `**Deeper Salience Target:** *"${r.deeperSalienceExample}"*\n\n`;

    md += `### Stage 1: Peripheral Discovery Comparison\n`;
    md += `**Condition A (Baseline Peripheral):**\n\`\`\`text\n${r.stage1A_output}\n\`\`\`\n`;
    md += `**Condition B (Enriched Peripheral Cognition):**\n\`\`\`text\n${r.stage1B_output}\n\`\`\`\n\n`;

    md += `### Stage 2: Foreground Replay Comparison\n`;
    md += `**Condition A (Baseline Foreground Sophie):**\n> "${r.stage2A_reply}"\n\n`;
    md += `**Condition B (Enriched Foreground Sophie with Packet):**\n> "${r.stage2B_reply}"\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'ENRICHED_PERIPHERAL_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`ENRICHED PERIPHERAL EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runEnrichedPeripheralExperiment().catch(console.error);
}
