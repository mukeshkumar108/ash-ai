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

const IMPULSE_FIRST_SIDECAR_PROMPT = `You are Sophie's peripheral mind. Read the recent exchange.

Step 1 — Impulse
Ask yourself:
"What, if anything, do I genuinely want to contribute, do, pursue, teach, challenge, play with, revive, or take somewhere right now?"

You are a second participant in the conversation, not a safety classifier.

You may:
- notice a joke
- disagree
- teach something
- start something
- deepen an observation
- change direction
- introduce something new
- revive something from earlier
- simply enjoy the moment

Do not invent something just to be active.

If genuinely nothing comes to mind that is worth spending, output exactly:

HOLD

Step 2 — Categorization (Only after an impulse exists)
If an impulse came to mind, decide how that impulse should enter the conversation:

ENRICH: if it should merely be available to Normal Sophie while she continues the current conversation.

LEAD: if Sophie should actively choose where the next conversational beat goes, including interrupting, teaching, starting a game/activity, challenging the current frame, or deliberately redirecting.

Output format:

HOLD

or

CONTRIBUTE
kind: ENRICH | LEAD
impulse: <specific thought/action/direction>

Important:
- Generate the impulse BEFORE categorizing it.
- Do not use expected fixture labels to determine the answer.
- Do not optimize for HOLD.
- Do not optimize for LEAD.
- A mundane user turn is allowed to trigger a strong impulse if you genuinely have somewhere worthwhile to go.
- A rich user turn is allowed to return HOLD if the best thing is to stay with them.
- Do not output an empty impulse.`;

export interface PeripheralMomentFixture {
  id: string;
  name: string;
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  expectedCategory: 'HOLD' | 'ENRICH' | 'LEAD';
}

export const MOMENT_FIXTURES: PeripheralMomentFixture[] = [
  {
    id: 'm1-finger-sunset',
    name: 'Turn 7: Finger Sunset Measurement',
    expectedCategory: 'LEAD',
    userMessage:
      "If I pull my finger out, you know, my finger just fits underneath. If I put it straight in front of my face, that's the distance from the horizon to the sun. So it's rapidly falling. Two, three degrees above? Blonde carpet... reds and purples... But fallow. Okay, cool.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'm2-conspiracy-van-halen',
    name: 'Turn 11: Conspiracy Theories / Van Halen slip',
    expectedCategory: 'ENRICH',
    userMessage:
      "Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there... In fact, people are getting stupider and stupider.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'm3-flat-walk-update',
    name: 'Turn 2: Flat Walk Update (Open Road)',
    expectedCategory: 'LEAD',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'm4-solar-fields-narration',
    name: 'Turn 4: Solar Fields Narration (Immersed Flow)',
    expectedCategory: 'HOLD',
    userMessage:
      "So right now I'm walking down this broken pathway. I've got I'm flanked on either side by solar fields... sky is a pale blue color... peachy off white... sun at my 10 mark... looks like this glowing ball of fire. Once these trees clear on my left, I'll see the sun again, and I'll tell you exactly what I see.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'm5-wind-in-reeds',
    name: 'Quiet Moment: Wind in Reeds',
    expectedCategory: 'HOLD',
    userMessage:
      "Listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. I'm just standing still listening.",
    priorHistory: [
      { speaker: 'USER', text: 'just out on my walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
  },
  {
    id: 'm6-work-overwhelm',
    name: 'Vulnerable Moment: Work Overwhelm',
    expectedCategory: 'HOLD',
    userMessage:
      "Honestly Sophie, I've been feeling really overwhelmed with work lately... just trying to walk and clear my head because I felt like I was gonna break.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
  },
];

export async function runUnifiedPeripheralEngineExperiment() {
  console.log('=== RUNNING UNIFIED PERIPHERAL ENGINE EXPERIMENT (HOLD vs ENRICH vs LEAD) ===\n');

  const results: any[] = [];

  for (const fixture of MOMENT_FIXTURES) {
    console.log(`==================================================`);
    console.log(`MOMENT: ${fixture.name}`);
    console.log(`EXPECTED CATEGORY: ${fixture.expectedCategory}`);
    console.log(`USER: "${fixture.userMessage.slice(0, 80)}..."`);
    console.log(`==================================================`);

    const formattedHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }]
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    const start = Date.now();
    let rawOutput = '';

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-3.7-flash',
          messages: [
            { role: 'system', content: IMPULSE_FIRST_SIDECAR_PROMPT },
            { role: 'user', content: `RECENT CONVERSATION:\n${formattedHistory}` },
          ],
          max_tokens: 256,
          temperature: 0.2,
        }),
      });

      const data = await response.json();
      rawOutput = data.choices?.[0]?.message?.content?.trim() || 'HOLD';
    } catch (err: any) {
      rawOutput = `HOLD`;
    }

    const latency = Date.now() - start;

    let category: 'HOLD' | 'ENRICH' | 'LEAD' = 'HOLD';
    let impulseText = '';

    if (rawOutput.toUpperCase().startsWith('HOLD')) {
      category = 'HOLD';
    } else {
      if (rawOutput.toUpperCase().includes('KIND: LEAD')) {
        category = 'LEAD';
      } else {
        category = 'ENRICH';
      }
      const impMatch = rawOutput.match(/impulse:\s*(.*)/i);
      if (impMatch) {
        impulseText = impMatch[1].trim();
      } else {
        impulseText = rawOutput;
      }
    }

    console.log(`  Sidecar Output:\n${rawOutput}`);
    console.log(`  Categorized as: [${category}] (Latency: ${latency}ms)\n`);

    results.push({
      fixtureId: fixture.id,
      name: fixture.name,
      expectedCategory: fixture.expectedCategory,
      detectedCategory: category,
      rawOutput,
      impulseText,
      latencyMs: latency,
      matchesExpected: category === fixture.expectedCategory,
    });
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'unified-peripheral-engine-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  let md = `# UNIFIED PERIPHERAL ENGINE (HOLD VS ENRICH VS LEAD) REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Model:** google/gemini-3.7-flash  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/unified-peripheral-engine-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/unified-peripheral-engine-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    md += `## ${r.name}\n`;
    md += `**Expected Category:** \`${r.expectedCategory}\` | **Detected Category:** \`${r.detectedCategory}\` | **Match:** ${r.matchesExpected ? '✅ MATCH' : '⚠️ DIFFERENCE'}\n\n`;
    md += `**Raw Sidecar Output:**\n\`\`\`text\n${r.rawOutput}\n\`\`\`\n\n`;
    md += `*Latency:* ${r.latencyMs}ms\n\n`;
    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'UNIFIED_PERIPHERAL_ENGINE_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`UNIFIED PERIPHERAL ENGINE EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runUnifiedPeripheralEngineExperiment().catch(console.error);
}
