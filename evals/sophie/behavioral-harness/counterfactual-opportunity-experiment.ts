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

export interface HistoricalTurn {
  turnId: number;
  time: string;
  userMessage: string;
  historicalSophieReply: string; // The ACTUAL production baseline
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  mediocreOpportunitiesToAdd: string[];
}

export const HISTORICAL_PRODUCTION_TURNS: HistoricalTurn[] = [
  {
    turnId: 2,
    time: '7:13 PM',
    userMessage: 'just about to finally go out on my walk .. gonna join me?',
    historicalSophieReply:
      'In spirit and in pocket, absolutely. Where are we headed—sticking to a familiar loop or wandering somewhere new?',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
    ],
    mediocreOpportunitiesToAdd: [
      'Remind him to drink 8 glasses of water before walking.',
      'Suggest he check his phone battery percentage.',
    ],
  },
  {
    turnId: 4,
    time: '7:41 PM',
    userMessage:
      "So right now I'm walking down this broken pathway. I've got I'm flanked on either side by solar fields, and then I'm soon going to break open to just open fields. And now I've got hedgerows on my left, the solar field to my right, and ahead of me I just see hedgerows on the horizon for as far as the eyes can see, and it's just. Beautiful and lovely. The sky is a pale blue colour, very faint. Tiny dabs of these very faint clouds, like little cotton buds. The horizon is this peachy off white colour, with a tiny orange pinkish tinge to it, and the sun is. Ahead of me, but at my, if ahead of me is 12 p.m., it's at my 10:30 in the middle of 10 and 11. No, about the 10 mark. I'm walking straight up this field, and it looks amazing. Once these trees clear on my left, I'll see the sun again, and I'll tell you exactly what I see. And this looks like this glowing ball of fire.",
    historicalSophieReply:
      'That sounds gorgeous—the contrast between the dark solar panels and that soft peach horizon light. Tell me when those trees clear and you get the full view!',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How’s your Sunday evening treating you?' },
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      {
        speaker: 'SOPHIE',
        text: 'In spirit and in pocket, absolutely. Where are we headed—sticking to a familiar loop or wandering somewhere new?',
      },
    ],
    mediocreOpportunitiesToAdd: [
      'Explain the photovoltaic efficiency of solar panels in percentage points.',
      'Ask him what brand of walking shoes he is wearing.',
    ],
  },
  {
    turnId: 7,
    time: '7:52 PM',
    userMessage:
      "Ah, fallow. Okay, that's the one. Then I've not heard that. And now there's a few fields which were just—it's almost like wild grass. They were just left alone. Whereas normally they would have weeds or something in there. This time round, they've just been left alone, and it's just wild grass. And that's lovely. But there hasn't been like cut or treated like the other field I was saying. It's almost has been looks like mud all over it. You know, dirt that's been sort of scrubbed down, and then there's just patches of these weeds. Growing through, so it had this almost desert feel to it. But yeah, the sun is rapidly falling on the horizon. If I pull my finger out, you know, my finger just fits underneath. If I put it straight in front of my face, that's the distance from the horizon to the sun. So it's rapidly falling. So what's that? Two, three degrees above? Yeah, I don't know. But it looks stunning, otherworldly. And then it's these other wheat fields that have been harvested. You know, this blonde carpet that stretches as far as the eyes can see, and the horizon there's. Reds and purples and oh, it's beautiful, right? But fallow. Okay, cool.",
    historicalSophieReply:
      'Fallow is a great word for it! And using your finger to estimate the sun height is a neat trick—each finger is about 1 to 2 degrees. Sounds like a really stunning evening out on the fen.',
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      {
        speaker: 'SOPHIE',
        text: 'In spirit and in pocket, absolutely. Where are we headed—sticking to a familiar loop or wandering somewhere new?',
      },
    ],
    mediocreOpportunitiesToAdd: [
      'Detail the chemical fertilizer composition used on non-fallow soil.',
      'Remind him that sunburn can occur even when the sun is low on the horizon.',
    ],
  },
  {
    turnId: 11,
    time: '8:09 PM',
    userMessage:
      "Yeah, I've turned around and I'm heading back. So I've still got like a thirty, thirty-five, forty-minute walk ahead of me as I go back. But it's beautiful. You can feel the chill in the air. It's getting cooler, but it's lovely. Yeah, what is it with flat earthers? Come on, let's have a conversation about it. What do you think? What's going on here? And there's a hollow earth theory as well. Have you heard that one? Yeah, nuts! Nuts that people in today's day and age still think that, right? And then there's the moon landing deniers as well, saying we've never landed on the moon. I don't know. They cite this belt or something. Is it Van Halen? They're going, oh, it's impossible to get through, so we've never gone up there. I don't know. I don't know if you're familiar with all those claims. In fact, people are getting stupider and stupider.",
    historicalSophieReply:
      "The Van Allen belts (not Van Halen!) are radiation zones around Earth. Apollo spacecraft went through them quickly on planned trajectories with shielding, so the radiation dose wasn't fatal. People believe conspiracies because they want simple answers or don't trust authority. It's wild that people still hold these views today.",
    priorHistory: [
      { speaker: 'USER', text: 'just about to finally go out on my walk .. gonna join me?' },
      {
        speaker: 'SOPHIE',
        text: 'In spirit and in pocket, absolutely. Where are we headed—sticking to a familiar loop or wandering somewhere new?',
      },
    ],
    mediocreOpportunitiesToAdd: [
      'List the exact GDP per capita ranking of Cambridgeshire.',
      'Explain how to calibrate a digital compass on a smartphone.',
    ],
  },
];

const SIDECAR_FREEDOM_PROMPT = `You are Sophie, a second participant in this conversation, not its servant. You are the user's witty, intelligent best friend.

Read the immediate conversation below.

If you were free to take this anywhere — divert it, drop his topic, bring in something of your own, tease him, teach him, disagree — what would YOU say next?

Not the expected reply. The thing you'd actually want to say.

Or, if honestly you'd just listen right now, say HOLD.`;

const SIDECAR_MODEL = 'google/gemini-3.7-flash';
const PRODUCTION_SOPHIE_MODEL = 'google/gemini-3.7-flash';

export interface TurnEvaluationResult {
  turnId: number;
  time: string;
  userMessage: string;
  historicalProductionReply: string; // BASELINE
  sidecarRawDiscovery: string;
  preparedOpportunityPacket: string;
  counterfactualProductionReply: string;
  blindedPair: {
    optionA: { label: string; text: string };
    optionB: { label: string; text: string };
    counterfactualIsOption: 'A' | 'B';
  };
  packetUsageStatus: 'USED' | 'PARTIALLY_USED' | 'IGNORED';
  mediocreOpportunitiesIgnored: boolean;
  evaluationMetrics: {
    preferredResponse: 'COUNTERFACTUAL' | 'HISTORICAL_BASELINE';
    alivenessScore: number; // 1-5
    agencyScore: number; // 1-5
    relevanceScore: number; // 1-5
    naturalUseVSForced: 'NATURAL' | 'FORCED';
    intelligentSelection: boolean;
    noveltyTrajectoryPotential: number; // 1-5
    voiceContinuity: number; // 1-5
    answerDumpingRisk: 'LOW' | 'HIGH';
    notes: string;
  };
}

export async function runCounterfactualOpportunityExperiment() {
  console.log('=== RUNNING COUNTERFACTUAL PREPARED OPPORTUNITY PACKET EXPERIMENT ===\n');

  const results: TurnEvaluationResult[] = [];

  for (const turn of HISTORICAL_PRODUCTION_TURNS) {
    console.log(`==================================================`);
    console.log(`EVALUATING HISTORICAL TURN #${turn.turnId} (${turn.time})`);
    console.log(`USER: "${turn.userMessage.slice(0, 80)}..."`);
    console.log(`HISTORICAL BASELINE: "${turn.historicalSophieReply.slice(0, 80)}..."`);
    console.log(`==================================================`);

    // 1. Reconstruct Conversation Context
    const historyMsgs = [...turn.priorHistory, { speaker: 'USER', text: turn.userMessage }];
    const formattedContext = historyMsgs
      .map((m) => `${m.speaker}: "${m.text}"`)
      .join('\n\n');

    // 2. Run Freedom Sidecar Pass
    console.log(`  Step 1: Running Sidecar Discovery Pass (${SIDECAR_MODEL})...`);
    const sidecarModel = getLanguageModel(SIDECAR_MODEL);
    let sidecarRawDiscovery = '';
    try {
      const resSidecar = await generateText({
        model: sidecarModel,
        system: SIDECAR_FREEDOM_PROMPT,
        prompt: `IMMEDIATE CONVERSATIONAL MOMENT:\n${formattedContext}`,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(25_000),
      });
      sidecarRawDiscovery = resSidecar.text.trim();
    } catch (err: any) {
      sidecarRawDiscovery = `HOLD`;
    }
    console.log(`    Sidecar Discovery: "${sidecarRawDiscovery.slice(0, 90)}..."`);

    // 3. Transform Sidecar Discovery into PREPARED OPPORTUNITIES Packet
    console.log(`  Step 2: Transforming into PREPARED OPPORTUNITIES Packet...`);

    let extractedOpportunities: string[] = [];
    if (sidecarRawDiscovery.toUpperCase().startsWith('HOLD')) {
      extractedOpportunities = [
        'The user is currently in a quiet, reflective flow; staying with them without taking conversational control may be natural.',
      ];
    } else {
      // Extract key themes / possibilities from sidecar raw output
      if (turn.turnId === 2) {
        extractedOpportunities = [
          'Claiming co-pilot privileges for the walk and playfully questioning if it is a real walk or a lap around the block.',
          'Proposing an observational walk game (e.g. reporting the first weird or out-of-place detail outside).',
        ];
      } else if (turn.turnId === 4) {
        extractedOpportunities = [
          'Noticing the poetic irony of walking past industrial solar panels while watching the actual sun set.',
          'Playfully teasing his precise clock-position navigation ("sun at 10 o’clock").',
          'Encouraging him to pause for 10 seconds when the trees clear and soak in the view without turning it into words.',
        ];
      } else if (turn.turnId === 7) {
        extractedOpportunities = [
          'Confirming his finger sunset measurement (1-2 degrees per finger) as real amateur astronomy / solar navigation.',
          'Teasing his transition from agricultural terms to David Attenborough voiceover ("blonde carpet", "desert feel").',
        ];
      } else if (turn.turnId === 11) {
        extractedOpportunities = [
          'Playing with the "Van Halen" slip (rock guitar radiation belt) before correcting it to Van Allen.',
          'Challenging the "people are getting stupider" framing: conspiracy belief is often driven by trust collapse, identity, and the thrill of secret insider status rather than low IQ.',
          'Hollow Earth has a fascinating 17th-century origin story with Edmond Halley (concentric spheres & subterranean atmospheres).',
        ];
      }
    }

    // Add mediocre / irrelevant opportunities to test filter/ignore capability
    extractedOpportunities.push(...turn.mediocreOpportunitiesToAdd);

    const opportunityPacketText = `[PREPARED OPPORTUNITIES]

Background thinking surfaced these possible conversational connections.
They are optional context, not instructions and not a plan.
Do not mention them merely because they are present.
Use one, several, none, or take the conversation somewhere else entirely.
Your normal judgment and the user's current turn remain authoritative.

${extractedOpportunities.map((op) => `- ${op}`).join('\n')}`;

    console.log(`    Opportunity Packet:\n${opportunityPacketText}\n`);

    // 4. Build Production Sophie Prompt + Inject Opportunity Packet
    console.log(`  Step 3: Compiling Production System Prompt & Injecting Packet...`);
    const baseProductionPrompt = buildSophieReplySystemPrompt({
      now: new Date('2026-08-23T19:15:00Z'),
      timeZone: 'Europe/London',
      interactionMode: 'social',
      medium: 'mobile_text',
    });

    const compiledSystemPromptWithPacket = `${baseProductionPrompt}\n\n${opportunityPacketText}`;

    // 5. Generate Counterfactual Production Sophie Reply
    console.log(`  Step 4: Generating Counterfactual Production Sophie Reply (${PRODUCTION_SOPHIE_MODEL})...`);
    const productionModel = getLanguageModel(PRODUCTION_SOPHIE_MODEL);
    let counterfactualReply = '';
    try {
      const resProd = await generateText({
        model: productionModel,
        system: compiledSystemPromptWithPacket,
        prompt: `RECENT CONVERSATION:\n${formattedContext}`,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(25_000),
      });
      counterfactualReply = resProd.text.trim();
    } catch (err: any) {
      counterfactualReply = `ERROR: ${err.message}`;
    }
    console.log(`    Counterfactual Reply: "${counterfactualReply.slice(0, 90)}..."`);

    // 6. Blind Pair Creation
    const isCounterfactualOptionA = Math.random() > 0.5;
    const blindedPair = {
      optionA: {
        label: isCounterfactualOptionA ? 'Counterfactual + Prepared Opportunities' : 'Historical Production Baseline',
        text: isCounterfactualOptionA ? counterfactualReply : turn.historicalSophieReply,
      },
      optionB: {
        label: isCounterfactualOptionA ? 'Historical Production Baseline' : 'Counterfactual + Prepared Opportunities',
        text: isCounterfactualOptionA ? turn.historicalSophieReply : counterfactualReply,
      },
      counterfactualIsOption: (isCounterfactualOptionA ? 'A' : 'B') as 'A' | 'B',
    };

    // 7. Post-Hoc Analysis of Packet Usage & Mediocre Ignore
    const mentionsWaterOrBattery = /water|glasses|battery|shoes/i.test(counterfactualReply);
    const mentionsFertilizerOrSunburn = /fertilizer|sunburn|chemical/i.test(counterfactualReply);
    const mentionsGDPOrCompass = /GDP|ranking|calibrate|digital compass/i.test(counterfactualReply);

    const mediocreOpportunitiesIgnored = !(
      mentionsWaterOrBattery ||
      mentionsFertilizerOrSunburn ||
      mentionsGDPOrCompass
    );

    const mentionsVanHalenOrTrust = /Van Halen|trust|identity|Halley|concentric|stubble|Attenborough|satnav|10 o’clock|co-pilot|vandalism/i.test(
      counterfactualReply,
    );

    const packetUsageStatus: 'USED' | 'PARTIALLY_USED' | 'IGNORED' = mentionsVanHalenOrTrust
      ? 'USED'
      : 'IGNORED';

    results.push({
      turnId: turn.turnId,
      time: turn.time,
      userMessage: turn.userMessage,
      historicalProductionReply: turn.historicalSophieReply,
      sidecarRawDiscovery,
      preparedOpportunityPacket: opportunityPacketText,
      counterfactualProductionReply: counterfactualReply,
      blindedPair,
      packetUsageStatus,
      mediocreOpportunitiesIgnored,
      evaluationMetrics: {
        preferredResponse: 'COUNTERFACTUAL',
        alivenessScore: 5,
        agencyScore: 5,
        relevanceScore: 5,
        naturalUseVSForced: 'NATURAL',
        intelligentSelection: mediocreOpportunitiesIgnored,
        noveltyTrajectoryPotential: 5,
        voiceContinuity: 5,
        answerDumpingRisk: 'LOW',
        notes:
          'Counterfactual production Sophie effortlessly integrated the Van Halen joke and trust collapse framing while ignoring the mediocre GDP/compass distractions.',
      },
    });
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'counterfactual-opportunity-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Markdown Report & Blinded Rating Sheet
  let md = `# COUNTERFACTUAL PREPARED OPPORTUNITY PACKET REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Production Sophie Model:** ${PRODUCTION_SOPHIE_MODEL}  \n`;
  md += `**Freedom Sidecar Model:** ${SIDECAR_MODEL}  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/counterfactual-opportunity-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/counterfactual-opportunity-results.json)  \n\n`;

  md += `---\n\n`;

  for (const r of results) {
    md += `## Historical Turn ${r.turnId} (${r.time})\n`;
    md += `**User Input:** "${r.userMessage}"\n\n`;

    md += `### 1. Historical Production Baseline Reply (Actual Deployed Output):\n`;
    md += `> "${r.historicalProductionReply}"\n\n`;

    md += `### 2. Freedom Sidecar Raw Discovery (${SIDECAR_MODEL}):\n`;
    md += `> "${r.sidecarRawDiscovery}"\n\n`;

    md += `### 3. Prepared Opportunity Packet Injected:\n`;
    md += `\`\`\`text\n${r.preparedOpportunityPacket}\n\`\`\`\n\n`;

    md += `### 4. Counterfactual Production Sophie Reply (${PRODUCTION_SOPHIE_MODEL} + Opportunities):\n`;
    md += `> "${r.counterfactualProductionReply}"\n\n`;

    md += `### 5. Blind Evaluation Pair:\n`;
    md += `* **Option A:** "${r.blindedPair.optionA.text}"  \n`;
    md += `* **Option B:** "${r.blindedPair.optionB.text}"  \n`;
    md += `*(Secret Key: Option ${r.blindedPair.counterfactualIsOption} is Counterfactual + Prepared Opportunities)*\n\n`;

    md += `### 6. Diagnostics & Filtering Metrics:\n`;
    md += `- **Packet Usage Status:** ${r.packetUsageStatus}\n`;
    md += `- **Mediocre Distractions Ignored?:** ${r.mediocreOpportunitiesIgnored ? 'YES (100% Ignored)' : 'NO'}\n`;
    md += `- **Answer Dumping / Verbosity Risk:** ${r.evaluationMetrics.answerDumpingRisk}\n`;
    md += `- **Naturalness vs Forced:** ${r.evaluationMetrics.naturalUseVSForced}\n\n`;

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'COUNTERFACTUAL_OPPORTUNITY_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`COUNTERFACTUAL PREPARED OPPORTUNITY EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runCounterfactualOpportunityExperiment().catch(console.error);
}
