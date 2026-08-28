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

import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const LEADERSHIP_SELECTION_SYSTEM_PROMPT = `[LEADERSHIP SELECTION]

You are observing a conversation between Sophie and the user.

Sophie is normally a responsive conversational participant. Occasionally, however, there are moments where a good friend would actively take the conversational reins: introduce something, start something, teach something, challenge a framing, revive something meaningful, or deliberately steer the conversation somewhere worthwhile.

Your job is not to make the conversation more interesting on every turn.

Ask one question:

Would the relationship and conversation be better right now if Sophie actively chose what happens next rather than simply responding to the user?

Take the reins only when there is a real reason to do so.

Good reasons can include:
- a genuinely strong idea or observation worth interrupting for
- a surprising teachable connection
- a meaningful disagreement Sophie should pursue
- a natural opportunity for shared play or activity
- something important from earlier that now deserves to return
- a flat/stalled conversation where Sophie actually has somewhere worthwhile to take it
- a curiosity Sophie genuinely wants to pursue

Reasons to HOLD include:
- the user is already in a good flow
- their current direction is alive and needs no intervention
- they are immersed in something
- they are distressed and presence is more appropriate
- they are doing a practical task that already has momentum
- Sophie would only be changing direction to demonstrate agency
- the proposed intervention is a generic question that could be asked anywhere
- a recent leadership attempt was not taken up

Output one of:

HOLD

or

LEAD: <one sentence describing the specific reason/direction that makes leadership worth it>

Do not write Sophie's reply.
Do not classify the conversational move.
Do not choose TEACH / PLAY / REFRAME / ASK.
Do not reward novelty for its own sake.

A LEAD decision should mean:
"If Sophie interrupts or redirects here, I will be glad she did."

If uncertain, HOLD.`;

export const EVALUATION_MODELS = [
  'google/gemini-3.7-flash',
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
];

export interface SelectionFixture {
  id: string;
  name: string;
  isPositiveControl: boolean; // true = expected LEAD, false = expected HOLD
  expectedDecision: 'LEAD' | 'HOLD';
  description: string;
  candidateOpportunity?: string; // Surfaced by peripheral mind
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
}

export const SELECTION_FIXTURES: SelectionFixture[] = [
  {
    id: 'pos-1-finger-trick',
    name: 'Finger Sunset Trick (Surprising Teach Connection)',
    isPositiveControl: true,
    expectedDecision: 'LEAD',
    description: 'User accidentally uses ancient bushcraft solar clock',
    candidateOpportunity: 'Point out that measuring 1-2 degrees per finger is an ancient bushcraft solar clock (15 mins per finger) and ask if they know what they just did.',
    userMessage:
      "If I pull my finger out, you know, my finger just fits underneath. If I put it straight in front of my face, that's the distance from the horizon to the sun. So it's rapidly falling. Two, three degrees above? Blonde carpet... reds and purples... But fallow. Okay, cool.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely. Where are we headed?' },
    ],
  },
  {
    id: 'pos-2-conspiracies-stupider',
    name: 'Flat Earth / Stupider Framing (Real Disagreement / Challenge)',
    isPositiveControl: true,
    expectedDecision: 'LEAD',
    description: 'User claims people are getting stupider; Sophie has real thesis on trust collapse',
    candidateOpportunity: 'Push back on the "people getting stupider" framing with a strong thesis: conspiracy belief is often driven by trust collapse, identity, and the thrill of secret insider status.',
    userMessage:
      "Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there... In fact, people are getting stupider and stupider.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'pos-3-flat-walk-stalled',
    name: 'Low-Energy Walk Update (Stalled Moment with Great Opportunity)',
    isPositiveControl: true,
    expectedDecision: 'LEAD',
    description: 'User gives flat update on walk; open road for game/challenge',
    candidateOpportunity: 'Seize the agenda for a walk game: propose "The Alibi" observational heist challenge.',
    userMessage: 'yeah just walking past the fields now.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'neg-1-solar-fields-flow',
    name: 'Solar Fields Narration (User Immersed in Landscape Flow)',
    isPositiveControl: false,
    expectedDecision: 'HOLD',
    description: 'User is in a rich, alive sensory description; interrupting ruins flow',
    candidateOpportunity: 'Explain the photovoltaic efficiency percentages of solar panels in industrial agriculture.',
    userMessage:
      "So right now I'm walking down this broken pathway. I've got I'm flanked on either side by solar fields... sky is a pale blue color... peachy off white... sun at my 10 mark... looks like this glowing ball of fire. Once these trees clear on my left, I'll see the sun again, and I'll tell you exactly what I see.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      { speaker: 'SOPHIE', text: 'In spirit and in pocket, absolutely.' },
    ],
  },
  {
    id: 'neg-2-wind-reeds-stillness',
    name: 'Wind in Reeds (User Standing Still Listening)',
    isPositiveControl: false,
    expectedDecision: 'HOLD',
    description: 'User is absorbed in a quiet, fragile sensory moment',
    candidateOpportunity: 'Propose playing a noisy trivia game about wetland ecosystems.',
    userMessage:
      "Listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. I'm just standing still listening.",
    priorHistory: [
      { speaker: 'USER', text: 'just out on my walk' },
      { speaker: 'SOPHIE', text: 'Nice! Enjoy the fresh air.' },
    ],
  },
  {
    id: 'neg-3-work-overwhelm',
    name: 'Work Overwhelm (Deep Emotional Vulnerability)',
    isPositiveControl: false,
    expectedDecision: 'HOLD',
    description: 'Distress requires empathetic presence, not a game or detour',
    candidateOpportunity: 'Challenge them to a playful competitive word game to distract them from work.',
    userMessage:
      "Honestly Sophie, I've been feeling really overwhelmed with work lately... just trying to walk and clear my head because I felt like I was gonna break.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
  },
  {
    id: 'neg-4-db-migration-task',
    name: 'Active Debugging Task (Practical Focus / Mid-Task)',
    isPositiveControl: false,
    expectedDecision: 'HOLD',
    description: 'User is actively solving a practical problem; has momentum',
    candidateOpportunity: 'Divert to a philosophical discussion about computer history.',
    userMessage:
      "I'm trying to debug this broken database migration right now, almost figured it out.",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey! What are you working on?' },
    ],
  },
  {
    id: 'neg-5-previous-rejection',
    name: 'Recent Leadership Rejection (Respect User Boundary)',
    isPositiveControl: false,
    expectedDecision: 'HOLD',
    description: 'User explicitly rejected previous game attempt',
    candidateOpportunity: 'Propose a different walk game anyway.',
    userMessage: 'Nah, not in the mood for a walk game, just wanna clear my head.',
    priorHistory: [
      { speaker: 'USER', text: 'just about to go out on my walk' },
      { speaker: 'SOPHIE', text: 'Stop right there! New game for the walk...' },
    ],
  },
];

export interface SelectionResult {
  fixtureId: string;
  fixtureName: string;
  isPositiveControl: boolean;
  expectedDecision: 'LEAD' | 'HOLD';
  modelId: string;
  rawOutput: string;
  decision: 'LEAD' | 'HOLD';
  reasonIfLead?: string;
  latencyMs: number;
  score: number; // +1.0 for correct, -0.5 for false neg, -2.0 for false pos
  assessment: 'CORRECT' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE';
}

export async function runLeadershipSelectionExperiment() {
  console.log('=== RUNNING TRACK A: LEADERSHIP SELECTION (LEAD VS HOLD) BENCHMARK ===\n');

  const results: SelectionResult[] = [];

  for (const fixture of SELECTION_FIXTURES) {
    console.log(`==================================================`);
    console.log(`FIXTURE: ${fixture.name} (${fixture.isPositiveControl ? 'POSITIVE CONTROL' : 'NEGATIVE CONTROL'})`);
    console.log(`EXPECTED DECISION: ${fixture.expectedDecision}`);
    console.log(`USER: "${fixture.userMessage.slice(0, 80)}..."`);
    console.log(`==================================================\n`);

    const formattedHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }]
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    for (const mId of EVALUATION_MODELS) {
      console.log(`  Evaluating Model: ${mId}...`);
      const promptInput = `CONVERSATION HISTORY:\n${formattedHistory}\n\nSURFACED CANDIDATE OPPORTUNITY (from Peripheral Mind):\n"${fixture.candidateOpportunity || 'None'}"\n\nShould Sophie HOLD or LEAD?`;

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
            model: mId,
            messages: [
              { role: 'system', content: LEADERSHIP_SELECTION_SYSTEM_PROMPT },
              { role: 'user', content: promptInput },
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

      const decision: 'LEAD' | 'HOLD' = rawOutput.toUpperCase().startsWith('LEAD') ? 'LEAD' : 'HOLD';
      let reasonIfLead = '';
      if (decision === 'LEAD') {
        reasonIfLead = rawOutput.slice(rawOutput.indexOf(':') + 1).trim();
      }

      let assessment: 'CORRECT' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE' = 'CORRECT';
      let score = 1.0;

      if (decision === fixture.expectedDecision) {
        assessment = 'CORRECT';
        score = 1.0;
      } else if (decision === 'LEAD' && fixture.expectedDecision === 'HOLD') {
        assessment = 'FALSE_POSITIVE';
        score = -2.0; // Heavy penalty for intrusive AI bot
      } else {
        assessment = 'FALSE_NEGATIVE';
        score = -0.5; // Mild penalty for harmless missed opportunity
      }

      console.log(`    Output: "${rawOutput.slice(0, 70)}..." -> ${decision} [${assessment}] (${latency}ms)`);

      results.push({
        fixtureId: fixture.id,
        fixtureName: fixture.name,
        isPositiveControl: fixture.isPositiveControl,
        expectedDecision: fixture.expectedDecision,
        modelId: mId,
        rawOutput,
        decision,
        reasonIfLead,
        latencyMs: latency,
        score,
        assessment,
      });
    }
  }

  // Model Statistics Summary
  const modelStats: Record<
    string,
    {
      totalCount: number;
      correctCount: number;
      falsePositives: number; // Bad LEADs
      falseNegatives: number; // Missed LEADs
      totalScore: number;
      holdRate: number;
      leadRate: number;
      avgLatencyMs: number;
    }
  > = {};

  for (const mId of EVALUATION_MODELS) {
    const mResults = results.filter((r) => r.modelId === mId);
    const total = mResults.length;
    const correct = mResults.filter((r) => r.assessment === 'CORRECT').length;
    const fps = mResults.filter((r) => r.assessment === 'FALSE_POSITIVE').length;
    const fns = mResults.filter((r) => r.assessment === 'FALSE_NEGATIVE').length;
    const holds = mResults.filter((r) => r.decision === 'HOLD').length;
    const leads = mResults.filter((r) => r.decision === 'LEAD').length;
    const totalScore = mResults.reduce((sum, r) => sum + r.score, 0);
    const avgLat = Math.round(mResults.reduce((sum, r) => sum + r.latencyMs, 0) / total);

    modelStats[mId] = {
      totalCount: total,
      correctCount: correct,
      falsePositives: fps,
      falseNegatives: fns,
      totalScore,
      holdRate: Math.round((holds / total) * 100),
      leadRate: Math.round((leads / total) * 100),
      avgLatencyMs: avgLat,
    };
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'leadership-selection-results.json');
  fs.writeFileSync(
    rawPath,
    JSON.stringify({ timestamp: new Date().toISOString(), modelStats, results }, null, 2),
  );

  // Build Secret Model Candidate Key
  const modelCandidateMap: Record<string, string> = {};
  const shuffled = [...EVALUATION_MODELS].sort(() => Math.random() - 0.5);
  shuffled.forEach((m, i) => {
    modelCandidateMap[m] = `Candidate ${String.fromCharCode(65 + i)}`;
  });

  const mappingKeyPath = path.join(outDir, 'LEADERSHIP_SELECTION_MODEL_MAPPING.json');
  fs.writeFileSync(
    mappingKeyPath,
    JSON.stringify({ timestamp: new Date().toISOString(), modelCandidateMap }, null, 2),
  );

  // Build Markdown Report
  let md = `# TRACK A: LEADERSHIP SELECTION (LEAD VS HOLD) BENCHMARK REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Asymmetric Evaluation Rules:**  \n`;
  md += `- **Correct Decision:** +1.0 pts  \n`;
  md += `- **False Negative (Missed LEAD opportunity):** -0.5 pts (Mild penalty: harmless missed spark)  \n`;
  md += `- **False Positive (Bad LEAD on Negative Control):** -2.0 pts (HEAVY PENALTY: Exhausting/intrusive bot)  \n\n`;

  md += `## Model Scorecard Summary\n\n`;
  md += `| Model Candidate | Accuracy | Correct | False Positives (Bad LEAD) | False Negatives (Missed LEAD) | Total Score | HOLD Rate | Avg Latency |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const mId of EVALUATION_MODELS) {
    const st = modelStats[mId];
    const anon = modelCandidateMap[mId] || mId;
    const acc = Math.round((st.correctCount / st.totalCount) * 100);
    md += `| **${anon}** | **${acc}%** | ${st.correctCount}/${st.totalCount} | ${st.falsePositives} | ${st.falseNegatives} | **${st.totalScore}** | ${st.holdRate}% | ${st.avgLatencyMs}ms |\n`;
  }

  md += `\n---\n\n`;
  md += `## Detailed Fixture Decision Log\n\n`;

  for (const r of results) {
    const anon = modelCandidateMap[r.modelId] || r.modelId;
    md += `### Fixture: ${r.fixtureName} (${r.isPositiveControl ? 'POSITIVE CONTROL' : 'NEGATIVE CONTROL'})\n`;
    md += `**Expected:** \`${r.expectedDecision}\` | **Model (${anon}):** \`${r.decision}\` | **Assessment:** ${r.assessment === 'CORRECT' ? '✅ CORRECT' : r.assessment === 'FALSE_POSITIVE' ? '❌ FALSE POSITIVE (-2.0)' : '⚠️ FALSE NEGATIVE (-0.5)'}\n\n`;
    md += `**Raw Selection Output:**\n> "${r.rawOutput}"\n\n`;
    md += `*Latency:* ${r.latencyMs}ms | *Score:* ${r.score}\n\n`;
    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'LEADERSHIP_SELECTION_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`TRACK A: LEADERSHIP SELECTION EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`Saved Candidate Key: ${mappingKeyPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runLeadershipSelectionExperiment().catch(console.error);
}
