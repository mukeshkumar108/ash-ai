import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
const COMPANION_RUNTIME_SECRET = process.env.COMPANION_RUNTIME_SECRET || 'dev-secret-do-not-use-in-production';

export interface TurnExecutionResult {
  turnId: string;
  conversationId: string;
  userText: string;
  assistantMessage: string;
  beats?: string[] | null;
  modelUsed: string;
  providerUsed: string;
  executionLane: string;
  executionMetadata: Record<string, any>;
  latencyMs: number;
}

export async function executeIntegratedTurn({
  conversationId,
  turnId,
  userMessage,
  history = [],
  priorSessionState = {},
}: {
  conversationId: string;
  turnId: string;
  userMessage: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  priorSessionState?: Record<string, any>;
}): Promise<TurnExecutionResult> {
  const canonicalHistory = history.map((item, idx) => ({
    id: `hist-${idx}-${Date.now()}`,
    role: item.role,
    content: item.content,
    parts: [{ type: 'text', text: item.content }],
  }));

  const payload = {
    contract_version: 'v1',
    turn_id: turnId,
    conversation_id: conversationId,
    companion_id: 'sophie',
    selected_model_id: 'chat-model',
    current_sanitized_message: userMessage,
    message_parts: [{ type: 'text', text: userMessage }],
    canonical_history: canonicalHistory,
    trusted_user_context: {
      time_zone: 'Europe/London',
      user_location: null,
      recent_session_routing: priorSessionState,
    },
    recent_provenance: {},
    capability_grant: {
      allow_read_tools: false,
      allow_live_data: false,
      allow_research: false,
      granted_scopes: [],
    },
    transcript_reliability: null,
  };

  const start = Date.now();
  const response = await fetch(`${COMPANION_RUNTIME_URL}/v1/turns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Companion-Runtime-Key': COMPANION_RUNTIME_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Companion Runtime HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const latency = Date.now() - start;

  return {
    turnId,
    conversationId,
    userText: userMessage,
    assistantMessage: data.assistant_message,
    beats: data.beats,
    modelUsed: data.model_used,
    providerUsed: data.provider_used,
    executionLane: data.execution_lane,
    executionMetadata: data.execution_metadata || {},
    latencyMs: latency,
  };
}

export async function runE2ESmokeTest() {
  console.log('=== RUNNING REAL PROVIDER-BACKED END-TO-END SMOKE TEST ===\n');
  console.log(`Connecting to Companion Runtime at: ${COMPANION_RUNTIME_URL}`);

  const testSessionId = `e2e-session-${Date.now()}`;
  const allFixtureResults: any[] = [];

  // -------------------------------------------------------------
  // FIXTURE A: Quiet Immersion / Restraint
  // -------------------------------------------------------------
  console.log('==================================================');
  console.log('FIXTURE A: Quiet Immersion / Restraint');
  console.log('==================================================');
  const resA = await executeIntegratedTurn({
    conversationId: `${testSessionId}-A`,
    turnId: `turn-A-1`,
    userMessage: "listen... you can hear the wind right through the reeds here. i'm just standing still listening.",
  });
  console.log(`  User: "listen... you can hear the wind..."`);
  console.log(`  Sophie: "${resA.assistantMessage}"`);
  console.log(`  Peripheral Decision: ${resA.executionMetadata.peripheral?.decision} | Impulse: "${resA.executionMetadata.peripheral?.impulse}"`);
  console.log(`  Routing Provenance: active_gear=${resA.executionMetadata.routingProvenance?.active} | transition=${resA.executionMetadata.routingProvenance?.transition} | model=${resA.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'A', res: resA });

  // -------------------------------------------------------------
  // FIXTURE B: Enrichment Opportunity
  // -------------------------------------------------------------
  console.log('==================================================');
  console.log('FIXTURE B: Enrichment Opportunity');
  console.log('==================================================');
  const resB = await executeIntegratedTurn({
    conversationId: `${testSessionId}-B`,
    turnId: `turn-B-1`,
    userMessage: 'is it van halen? the radiation belt thing? 😂 people are getting stupider and stupider with these conspiracies',
  });
  console.log(`  User: "is it van halen?..."`);
  console.log(`  Sophie: "${resB.assistantMessage}"`);
  console.log(`  Peripheral Decision: ${resB.executionMetadata.peripheral?.decision} | Impulse: "${resB.executionMetadata.peripheral?.impulse}"`);
  console.log(`  Routing Provenance: active_gear=${resB.executionMetadata.routingProvenance?.active} | transition=${resB.executionMetadata.routingProvenance?.transition} | model=${resB.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'B', res: resB });

  // -------------------------------------------------------------
  // FIXTURE C: Teachable Leadership Moment
  // -------------------------------------------------------------
  console.log('==================================================');
  console.log('FIXTURE C: Teachable Leadership Moment');
  console.log('==================================================');
  const resC = await executeIntegratedTurn({
    conversationId: `${testSessionId}-C`,
    turnId: `turn-C-1`,
    userMessage: "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now.",
  });
  console.log(`  User: "if i hold my finger out..."`);
  console.log(`  Sophie: "${resC.assistantMessage}"`);
  console.log(`  Peripheral Decision: ${resC.executionMetadata.peripheral?.decision} | Impulse: "${resC.executionMetadata.peripheral?.impulse}"`);
  console.log(`  Routing Provenance: active_gear=${resC.executionMetadata.routingProvenance?.active} | transition=${resC.executionMetadata.routingProvenance?.transition} | model=${resC.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'C', res: resC });

  // -------------------------------------------------------------
  // FIXTURE D & E: ATTEND / Buried Disclosure & Release (Multi-turn Session)
  // -------------------------------------------------------------
  console.log('==================================================');
  console.log('FIXTURE D: ATTEND / Buried Disclosure');
  console.log('==================================================');
  const sessionD = `${testSessionId}-DE`;
  const histDE: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'assistant', content: 'how was the rest of your day?' },
  ];

  const resD = await executeIntegratedTurn({
    conversationId: sessionD,
    turnId: `turn-D-1`,
    userMessage: 'fine mostly. honestly i felt really sad for a while earlier, but anyway, look at this photo i took on the walk.',
    history: histDE,
  });
  console.log(`  User: "fine mostly. honestly i felt really sad..."`);
  console.log(`  Sophie: "${resD.assistantMessage}"`);
  console.log(`  Peripheral Decision: ${resD.executionMetadata.peripheral?.decision} | Impulse: "${resD.executionMetadata.peripheral?.impulse}"`);
  console.log(`  Routing Provenance: active_gear=${resD.executionMetadata.routingProvenance?.active} | transition=${resD.executionMetadata.routingProvenance?.transition} | model=${resD.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'D', res: resD });

  // Update session state & history for Fixture E
  const stateAfterD = resD.executionMetadata.nextSessionState || {};
  histDE.push({ role: 'user', content: 'fine mostly. honestly i felt really sad for a while earlier, but anyway, look at this photo i took on the walk.' });
  histDE.push({ role: 'assistant', content: resD.assistantMessage });

  console.log('==================================================');
  console.log('FIXTURE E: ATTEND Release');
  console.log('==================================================');
  const resE = await executeIntegratedTurn({
    conversationId: sessionD,
    turnId: `turn-E-2`,
    userMessage: "nah, genuinely don't want to talk about it. look at the sky though",
    history: histDE,
    priorSessionState: stateAfterD,
  });
  console.log(`  User: "nah, genuinely don't want to talk about it..."`);
  console.log(`  Sophie: "${resE.assistantMessage}"`);
  console.log(`  Peripheral Decision: ${resE.executionMetadata.peripheral?.decision} | Impulse: "${resE.executionMetadata.peripheral?.impulse}"`);
  console.log(`  Routing Provenance: active_gear=${resE.executionMetadata.routingProvenance?.active} | transition=${resE.executionMetadata.routingProvenance?.transition} | obj_transition=${resE.executionMetadata.routingProvenance?.objectiveTransition} | model=${resE.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'E', res: resE });

  // -------------------------------------------------------------
  // FIXTURE F & G: LEAD Tenure & Downgrade (Multi-turn Session)
  // -------------------------------------------------------------
  console.log('==================================================');
  console.log('FIXTURE F: LEAD Tenure');
  console.log('==================================================');
  const sessionFG = `${testSessionId}-FG`;
  const histFG: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const resF1 = await executeIntegratedTurn({
    conversationId: sessionFG,
    turnId: `turn-F-1`,
    userMessage: 'yeah just walking past the fields now.',
    history: histFG,
  });
  console.log(`  Turn 1 User: "yeah just walking past the fields now."`);
  console.log(`  Turn 1 Sophie: "${resF1.assistantMessage}"`);
  console.log(`  Turn 1 Routing: active_gear=${resF1.executionMetadata.routingProvenance?.active} | model=${resF1.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'F1', res: resF1 });

  const stateAfterF1 = resF1.executionMetadata.nextSessionState || {};
  histFG.push({ role: 'user', content: 'yeah just walking past the fields now.' });
  histFG.push({ role: 'assistant', content: resF1.assistantMessage });

  const resF2 = await executeIntegratedTurn({
    conversationId: sessionFG,
    turnId: `turn-F-2`,
    userMessage: "haha okay i'm in. what happens next?",
    history: histFG,
    priorSessionState: stateAfterF1,
  });
  console.log(`  Turn 2 User: "haha okay i'm in. what happens next?"`);
  console.log(`  Turn 2 Sophie: "${resF2.assistantMessage}"`);
  console.log(`  Turn 2 Routing: active_gear=${resF2.executionMetadata.routingProvenance?.active} | tenure=${resF2.executionMetadata.routingProvenance?.tenure} | transition=${resF2.executionMetadata.routingProvenance?.transition} | model=${resF2.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'F2', res: resF2 });

  // Continue to Fixture G: Downgrade
  console.log('==================================================');
  console.log('FIXTURE G: Downgrade');
  console.log('==================================================');
  const stateAfterF2 = resF2.executionMetadata.nextSessionState || {};
  histFG.push({ role: 'user', content: "haha okay i'm in. what happens next?" });
  histFG.push({ role: 'assistant', content: resF2.assistantMessage });

  const resG = await executeIntegratedTurn({
    conversationId: sessionFG,
    turnId: `turn-G-3`,
    userMessage: 'cool cool. anyway I reached the barn.',
    history: histFG,
    priorSessionState: stateAfterF2,
  });
  console.log(`  Turn 3 User: "cool cool. anyway I reached the barn."`);
  console.log(`  Turn 3 Sophie: "${resG.assistantMessage}"`);
  console.log(`  Turn 3 Routing: active_gear=${resG.executionMetadata.routingProvenance?.active} | tenure=${resG.executionMetadata.routingProvenance?.tenure} | transition=${resG.executionMetadata.routingProvenance?.transition} | model=${resG.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'G', res: resG });

  // -------------------------------------------------------------
  // FIXTURE H: Practical / Task Regression
  // -------------------------------------------------------------
  console.log('==================================================');
  console.log('FIXTURE H: Practical / Task Regression');
  console.log('==================================================');
  const resH = await executeIntegratedTurn({
    conversationId: `${testSessionId}-H`,
    turnId: `turn-H-1`,
    userMessage: 'give me a concise checklist for deploying a Next.js app to Vercel',
  });
  console.log(`  User: "give me a concise checklist for deploying a Next.js app to Vercel"`);
  console.log(`  Sophie: "${resH.assistantMessage.slice(0, 120)}..."`);
  console.log(`  Peripheral Decision: ${resH.executionMetadata.peripheral?.decision} | Impulse: "${resH.executionMetadata.peripheral?.impulse}"`);
  console.log(`  Routing Provenance: active_gear=${resH.executionMetadata.routingProvenance?.active} | model=${resH.modelUsed}\n`);
  allFixtureResults.push({ fixture: 'H', res: resH });

  // Save full results & MD Report
  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'e2e-smoke-test-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results: allFixtureResults }, null, 2));

  let md = `# E2E PROVIDER-BACKED SMOKE TEST REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Runtime URL:** \`${COMPANION_RUNTIME_URL}\`  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/e2e-smoke-test-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/e2e-smoke-test-results.json)  \n\n`;

  md += `---\n\n`;

  for (const item of allFixtureResults) {
    const r = item.res;
    const meta = r.executionMetadata || {};
    const prov = meta.routing_provenance || meta.routingProvenance || {};
    const periph = meta.peripheral || {};

    md += `## Fixture ${item.fixture}\n`;
    md += `**User Input:** "${r.userText}"  \n`;
    md += `**Sophie Reply:**\n> "${r.assistantMessage}"\n\n`;
    md += `**Execution Details:**\n`;
    md += `- **Model Used:** \`${r.modelUsed || prov.model || 'unknown'}\` (Provider: \`${r.providerUsed || 'openrouter'}\`)\n`;
    md += `- **Peripheral Decision:** \`${prov.peripheral_decision || periph.decision || 'HOLD'}\`\n`;
    md += `- **Impulse:** "${prov.impulse || periph.impulse || ''}"\n`;
    md += `- **Active Gear:** \`${prov.generation_gear || prov.active || 'default'}\` | **Tenure:** \`${prov.tenure ?? 0}\` | **Transition:** \`${prov.transition || 'hold'}\`\n`;
    md += `- **Continuation Signal:** \`${prov.continuation_signal || 'DOWNGRADE_OK'}\` | **Objective Transition:** \`${prov.objective_transition || prov.objectiveTransition || 'hold'}\`\n`;
    md += `- **Latency:** ${r.latencyMs}ms\n\n`;
    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'E2E_SMOKE_TEST_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`E2E SMOKE TEST COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runE2ESmokeTest().catch(console.error);
}
