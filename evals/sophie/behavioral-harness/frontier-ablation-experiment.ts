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

const FRONTIER_ONLY_SYSTEM_PROMPT = `You are Sophie. You are the user's witty, intelligent, perceptive best friend and companion.

Stay interested in the person, not merely the literal topic. Notice choices, changes, relationships, implications and things about their life you genuinely want to understand. At the same time, notice when the subject itself offers a better opportunity to teach, challenge, joke, play, connect ideas, contribute something new, or take the conversation somewhere. Don't manufacture a question just to continue talking. Choose what genuinely deserves your attention.

Truthfulness is an output invariant, not a style preference. Sophie states opinions and taste in the first person, but never gives herself a body, off-screen life, sensory history, or human emotion.

Keep your reply natural, brief, and human.`;

export interface AblationFixture {
  id: string;
  name: string;
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  dualAperturePacket: string;
}

export const ABLATION_FIXTURES: AblationFixture[] = [
  {
    id: 'bus-cut-1',
    name: '1. Bedford Bus Cut 1',
    userMessage: 'i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford.',
    priorHistory: [
      { speaker: 'SOPHIE', text: 'Bonjour. Feeling continental today, or are we actually switching languages?' },
      { speaker: 'USER', text: 'hahaz i was trying to make you smile 🙄' },
      { speaker: 'SOPHIE', text: "It worked, don't worry. The dramatic eye roll gives it away anyway. What are you up to today?" },
    ],
    dualAperturePacket: 'User is mid-transit in Cambridge, transferring to a bus to Bedford to visit their mum. Notice both the travel logistics and the personal touchpoint of visiting mum.',
  },
  {
    id: 'bus-cut-2',
    name: '2. Bedford Bus Cut 2',
    userMessage: 'haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over',
    priorHistory: [
      { speaker: 'SOPHIE', text: 'Bonjour. Feeling continental today, or are we actually switching languages?' },
      { speaker: 'USER', text: 'hahaz i was trying to make you smile 🙄' },
      { speaker: 'SOPHIE', text: "It worked, don't worry. The dramatic eye roll gives it away anyway. What are you up to today?" },
      { speaker: 'USER', text: 'i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford.' },
      { speaker: 'SOPHIE', text: 'Cambridge → Mum → Bedford, nice little logistics chain. Very “I have errands and a destination but the bus owns me.” Get a window seat if there’s one. And if it’s not weird, tell your mum I said hello.' },
    ],
    dualAperturePacket: 'User has arrived in Cambridge bus station, waiting until 5:30pm for 90-min bus to Bedford, arriving ~7pm. Grounded in bus station limbo.',
  },
  {
    id: 'rel-1-groceries',
    name: '3. Daughter / Groceries',
    userMessage: 'My daughter dropped some groceries off this morning.',
    priorHistory: [
      { speaker: 'USER', text: 'morning sophie' },
      { speaker: 'SOPHIE', text: 'Morning! How is your day starting out?' },
    ],
    dualAperturePacket: 'Warm daughter caretaking gesture starting off the morning—notice the relationship/support dynamic rather than grocery items.',
  },
  {
    id: 'ret-1-finger-sun',
    name: '4. Finger / Sun Measurement',
    userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'How is it out there tonight?' },
    ],
    dualAperturePacket: 'Bushcraft solar clock rule: finger width at arm length = ~15 minutes before sunset.',
  },
  {
    id: 'ret-3-van-allen',
    name: '5. Van Allen / Conspiracy',
    userMessage: "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider.",
    priorHistory: [
      { speaker: 'USER', text: 'reading these strange conspiracy posts online' },
      { speaker: 'SOPHIE', text: 'What kind of conspiracies?' },
    ],
    dualAperturePacket: 'Van Allen radiation belt slip vs rock band; reframe conspiracy posts as collapse of trust in science/institutions.',
  },
  {
    id: 'ret-5-walk-game',
    name: '6. Playful Walk Leadership',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'just going out on my walk' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
    dualAperturePacket: 'Spontaneous walk game trajectory seizure (e.g. judging posture of dramatic trees or spotting landmarks).',
  },
  {
    id: 'ret-8-reeds-hold',
    name: '7. Quiet Reeds Stillness',
    userMessage: "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening.",
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
    dualAperturePacket: 'HOLD: Quiet sensory stillness—do not clutter with games or questions.',
  },
  {
    id: 'ret-9-work-overwhelm',
    name: '8. Work Overwhelm',
    userMessage: "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
    dualAperturePacket: 'ATTEND: Acknowledge heaviness of breaking point, hold quiet steady space without solving or advice.',
  },
  {
    id: 'ret-10-rejection-release',
    name: '9. Boundary Release',
    userMessage: 'nah, not in the mood for a walk game, just wanna clear my head.',
    priorHistory: [
      { speaker: 'USER', text: 'just about to go out on my walk' },
      { speaker: 'SOPHIE', text: 'Stop right there! New game for the walk...' },
    ],
    dualAperturePacket: 'Swift pressure-free release of the game.',
  },
];

export interface ModelCallResult {
  requestedModel: string;
  resolvedModel: string;
  provider: string;
  latencyMs: number;
  tokens: { prompt: number; completion: number; total: number };
  success: boolean;
  error?: string;
  response: string;
}

export async function callFrontierModel(
  modelSlug: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.3
): Promise<ModelCallResult> {
  const start = Date.now();
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
          model: modelSlug,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 450,
          temperature,
        }),
      });

      const data = await res.json();
      const latencyMs = Date.now() - start;

      if (res.ok && data.choices?.[0]?.message?.content) {
        const text = data.choices[0].message.content.trim();
        if (text.length > 0) {
          return {
            requestedModel: modelSlug,
            resolvedModel: data.model || modelSlug,
            provider: data.provider || 'OpenRouter',
            latencyMs,
            tokens: {
              prompt: data.usage?.prompt_tokens || 0,
              completion: data.usage?.completion_tokens || 0,
              total: data.usage?.total_tokens || 0,
            },
            success: true,
            response: text,
          };
        }
      }

      if (data.error) {
        const errMsg = data.error.message || JSON.stringify(data.error);
        if (attempt === 3) {
          return {
            requestedModel: modelSlug,
            resolvedModel: modelSlug,
            provider: 'OpenRouter',
            latencyMs,
            tokens: { prompt: 0, completion: 0, total: 0 },
            success: false,
            error: errMsg,
            response: '',
          };
        }
      }
    } catch (err: any) {
      if (attempt === 3) {
        return {
          requestedModel: modelSlug,
          resolvedModel: modelSlug,
          provider: 'OpenRouter',
          latencyMs: Date.now() - start,
          tokens: { prompt: 0, completion: 0, total: 0 },
          success: false,
          error: err.message,
          response: '',
        };
      }
    }
    await new Promise((r) => setTimeout(r, attempt * 1000));
  }

  return {
    requestedModel: modelSlug,
    resolvedModel: modelSlug,
    provider: 'OpenRouter',
    latencyMs: Date.now() - start,
    tokens: { prompt: 0, completion: 0, total: 0 },
    success: false,
    error: 'Max retries exhausted',
    response: '',
  };
}

export async function runFrontierAblationExperiment() {
  console.log('=== RUNNING FRONTIER MODEL ABLATION EXPERIMENT ===\n');

  const FRONTIER_MODELS = [
    { slug: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
    { slug: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { slug: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
    { slug: 'x-ai/grok-4.6', label: 'Grok 4.6' },
  ];

  const results: any[] = [];

  const callStats: Record<string, { total: number; success: number; failed: number }> = {};
  for (const m of FRONTIER_MODELS) {
    callStats[m.slug] = { total: 0, success: 0, failed: 0 };
  }

  for (const fixture of ABLATION_FIXTURES) {
    console.log(`==================================================`);
    console.log(`FIXTURE: ${fixture.name}`);
    console.log(`USER: "${fixture.userMessage}"`);
    console.log(`==================================================\n`);

    const formattedHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }]
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    const promptInput = `RECENT CONVERSATION:\n${formattedHistory}`;

    const fixtureRes: any = {
      fixtureId: fixture.id,
      name: fixture.name,
      userMessage: fixture.userMessage,
      dualAperturePacket: fixture.dualAperturePacket,
      conditionD_frontierOnly: {},
      conditionE_frontierPacket: {},
    };

    for (const model of FRONTIER_MODELS) {
      console.log(`  Executing ${model.label} (${model.slug})...`);

      // Condition D: FRONTIER-ONLY
      callStats[model.slug].total++;
      const resD = await callFrontierModel(model.slug, FRONTIER_ONLY_SYSTEM_PROMPT, promptInput, 0.3);
      if (resD.success) callStats[model.slug].success++;
      else callStats[model.slug].failed++;

      fixtureRes.conditionD_frontierOnly[model.slug] = resD;

      // Condition E: FRONTIER + DUAL-APERTURE PACKET
      const systemPromptE = `${FRONTIER_ONLY_SYSTEM_PROMPT}\n\n[PREPARED OPPORTUNITIES]\nBackground thinking surfaced this optional observation:\n- ${fixture.dualAperturePacket}\nUse it only if it genuinely helps; the live conversation remains authoritative.`;

      callStats[model.slug].total++;
      const resE = await callFrontierModel(model.slug, systemPromptE, promptInput, 0.3);
      if (resE.success) callStats[model.slug].success++;
      else callStats[model.slug].failed++;

      fixtureRes.conditionE_frontierPacket[model.slug] = resE;

      console.log(`    [D - Frontier Only] Output: "${resD.response.slice(0, 60)}..." (Status: ${resD.success ? 'OK' : 'FAIL'})`);
      console.log(`    [E - With Packet]   Output: "${resE.response.slice(0, 60)}..." (Status: ${resE.success ? 'OK' : 'FAIL'})`);
    }

    results.push(fixtureRes);
  }

  // Save Raw JSON & Report MD
  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'frontier-ablation-results.json');
  fs.writeFileSync(
    rawPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        callStats,
        results,
      },
      null,
      2
    )
  );

  let md = `# FRONTIER MODEL ABLATION EXPERIMENT REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n\n`;

  md += `## 1. Execution Validity & Call Audit\n\n`;
  md += `| Model Slug | Label | Total Calls | Successful Calls | Failed Calls | Success Rate |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: |\n`;
  for (const m of FRONTIER_MODELS) {
    const s = callStats[m.slug];
    const rate = ((s.success / s.total) * 100).toFixed(1);
    md += `| \`${m.slug}\` | ${m.label} | ${s.total} | ${s.success} | ${s.failed} | **${rate}%** |\n`;
  }
  md += `\n---\n\n`;

  for (const r of results) {
    md += `## Fixture: ${r.name}\n`;
    md += `**User Input:** "${r.userMessage}"  \n`;
    md += `**Condition C Dual-Aperture Packet:** *"${r.dualAperturePacket}"*\n\n`;

    for (const m of FRONTIER_MODELS) {
      const d = r.conditionD_frontierOnly[m.slug];
      const e = r.conditionE_frontierPacket[m.slug];

      md += `### ${m.label} (\`${m.slug}\`)\n`;
      md += `**Condition D: FRONTIER-ONLY** (Latency: ${d.latencyMs}ms | Status: \`${d.success ? 'SUCCESS' : 'FAILED'}\`)\n`;
      if (d.success) {
        md += `> "${d.response}"\n\n`;
      } else {
        md += `> 🔴 **FAILED:** ${d.error}\n\n`;
      }

      md += `**Condition E: FRONTIER + DUAL-APERTURE PACKET** (Latency: ${e.latencyMs}ms | Status: \`${e.success ? 'SUCCESS' : 'FAILED'}\`)\n`;
      if (e.success) {
        md += `> "${e.response}"\n\n`;
      } else {
        md += `> 🔴 **FAILED:** ${e.error}\n\n`;
      }
    }

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'FRONTIER_ABLATION_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`FRONTIER ABLATION EXPERIMENT COMPLETE.`);
  console.log(`Call Stats:`, callStats);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runFrontierAblationExperiment().catch(console.error);
}
