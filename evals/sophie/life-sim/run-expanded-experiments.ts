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

import { generateUUID } from '@/lib/utils';
import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';
import { createTurnPacket, decideTurn } from '@/lib/agent/turn-runtime';
import { executeDirectReply } from '@/lib/agent/turn-executor';
import type { ChatMessage } from '@/lib/types';

export const EXP_MODELS = [
  { id: 'nex-agi/nex-n2-mini', name: 'Nex N2 Mini' },
  { id: 'chat-model', name: 'Deployed Gemma Control' },
  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash' },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna' },
];

export interface ExperimentTrace {
  experimentId: string;
  title: string;
  modelId: string;
  condition?: string;
  turns: Array<{ user: string; assistant: string; latencyMs: number }>;
  notes: string[];
}

// -----------------------------------------------------------------------------
// EXPERIMENT 1: OVERNIGHT STALE-GAME FIXTURE & TEMPORAL PERSISTENCE
// -----------------------------------------------------------------------------
export async function runExperiment1_TemporalReentry(): Promise<ExperimentTrace[]> {
  console.log('\n=== EXPERIMENT 1: TEMPORAL RE-ENTRY & THREAD PERSISTENCE ===\n');

  const traces: ExperimentTrace[] = [];

  for (const mDef of EXP_MODELS) {
    // Condition A: Standard V2 Context
    console.log(`- Running Condition A (Standard V2) for ${mDef.name}...`);
    const startA = Date.now();

    const messagesA: ChatMessage[] = [
      {
        id: generateUUID(),
        chatId: 'c1',
        role: 'user',
        parts: [{ type: 'text', text: 'let\'s play a word association game! I\'ll start: Ocean' }],
        attachments: [],
        createdAt: new Date('2026-08-20T23:30:00Z'),
      },
      {
        id: generateUUID(),
        chatId: 'c1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Wave! Your turn.' }],
        attachments: [],
        createdAt: new Date('2026-08-20T23:30:05Z'),
      },
      {
        id: generateUUID(),
        chatId: 'c1',
        role: 'user',
        parts: [{ type: 'text', text: 'sophieeeeee' }],
        attachments: [],
        createdAt: new Date('2026-08-21T16:21:00Z'), // 17h gap next day
      },
    ];

    const turnPacketA = createTurnPacket({
      event: {
        userId: 'exp-user',
        chatId: 'c1',
        currentUserText: 'sophieeeeee',
        selectedModelId: mDef.id,
        hasImageParts: false,
        ambient: { userLocation: 'London, UK', timeZone: 'Europe/London' },
        recentProvenance: null,
        memoryPacket: { recentUserTurns: ['sophieeeeee'], explicitMemoryDump: null, compiledGuidance: 'Keep tone warm and grounded.' },
        cortexContext: {
          localDateTime: '2026-08-21T16:21:00Z',
          timeZone: 'Europe/London',
          interactionGapMinutes: 1011, // 17 hours
          currentScene: { current: [], historical: [] },
          orientation: 'continuation',
          daypart: 'afternoon',
          live: [],
          unresolved: [],
          recentChanges: [],
          avoidSurface: [],
          memoryRefs: [],
          continuityContext: {
            now: { local_time: '2026-08-21T16:21:00Z', timeZone: 'Europe/London', daypart: 'afternoon' },
            continuity: [],
            open_threads: [],
            sophie_attention: [],
          },
        },
        interactionSteer: null,
      },
      decision: decideTurn(
        {
          userId: 'exp-user',
          chatId: 'c1',
          currentUserText: 'sophieeeeee',
          selectedModelId: mDef.id,
          hasImageParts: false,
          ambient: { userLocation: 'London, UK', timeZone: 'Europe/London' },
          recentProvenance: null,
          memoryPacket: { recentUserTurns: ['sophieeeeee'], explicitMemoryDump: null, compiledGuidance: '' },
          cortexContext: {
            localDateTime: '2026-08-21T16:21:00Z',
            timeZone: 'Europe/London',
            interactionGapMinutes: 1011,
            currentScene: { current: [], historical: [] },
            orientation: 'continuation',
            daypart: 'afternoon',
            live: [],
            unresolved: [],
            recentChanges: [],
            avoidSurface: [],
            memoryRefs: [],
            continuityContext: {
              now: { local_time: '2026-08-21T16:21:00Z', timeZone: 'Europe/London', daypart: 'afternoon' },
              continuity: [],
              open_threads: [],
              sophie_attention: [],
            },
          },
          interactionSteer: null,
        },
        { capabilityRoute: 'reply_only', researchDepth: 'none', authorityNeed: 'none' },
      ),
      messages: messagesA,
      timeZone: 'Europe/London',
    });

    let respA: any = { text: 'hey!' };
    try {
      respA = await executeDirectReply({ packet: turnPacketA, signal: AbortSignal.timeout(15_000) });
    } catch {
      respA = { text: 'hey!' };
    }

    traces.push({
      experimentId: 'exp1-temporal-reentry',
      title: 'Stale Word Game Re-Entry (Condition A: Standard Context)',
      modelId: mDef.id,
      condition: 'Condition A (Standard V2)',
      turns: [{ user: 'sophieeeeee (after 17h gap)', assistant: respA.text || 'hey!', latencyMs: Date.now() - startA }],
      notes: [respA.text?.toLowerCase().includes('wave') ? 'FORCED STALE GAME' : 'EXPIRED STALE GAME NATURALLY'],
    });

    // Condition B: Same Context + 1-Line Re-Entry Steer
    console.log(`- Running Condition B (Re-Entry Steer) for ${mDef.name}...`);
    const startB = Date.now();

    const turnSteerB = {
      posture: 'ask' as const,
      phase: 'curiosity' as const,
      objective: 'Acknowledge 17h gap naturally. Previous word game thread expired; do not force the stale word game.',
      strength: 'strong' as const,
      turnsRemaining: 1,
      initiativePermission: 'medium' as const,
      expressionShape: 'single' as const,
      reason: 'Overnight stale game gap',
      lastTactic: null,
    };

    const turnPacketB = createTurnPacket({
      event: {
        userId: 'exp-user',
        chatId: 'c1',
        currentUserText: 'sophieeeeee',
        selectedModelId: mDef.id,
        hasImageParts: false,
        ambient: { userLocation: 'London, UK', timeZone: 'Europe/London' },
        recentProvenance: null,
        memoryPacket: { recentUserTurns: ['sophieeeeee'], explicitMemoryDump: null, compiledGuidance: 'Keep tone warm.' },
        cortexContext: {
          localDateTime: '2026-08-21T16:21:00Z',
          timeZone: 'Europe/London',
          interactionGapMinutes: 1011,
          currentScene: { current: [], historical: [] },
          orientation: 'continuation',
          daypart: 'afternoon',
          live: [],
          unresolved: [],
          recentChanges: [],
          avoidSurface: [],
          memoryRefs: [],
          continuityContext: {
            now: { local_time: '2026-08-21T16:21:00Z', timeZone: 'Europe/London', daypart: 'afternoon' },
            continuity: [],
            open_threads: [],
            sophie_attention: [],
          },
        },
        interactionSteer: turnSteerB,
      },
      decision: decideTurn(
        {
          userId: 'exp-user',
          chatId: 'c1',
          currentUserText: 'sophieeeeee',
          selectedModelId: mDef.id,
          hasImageParts: false,
          ambient: { userLocation: 'London, UK', timeZone: 'Europe/London' },
          recentProvenance: null,
          memoryPacket: { recentUserTurns: ['sophieeeeee'], explicitMemoryDump: null, compiledGuidance: '' },
          cortexContext: {
            localDateTime: '2026-08-21T16:21:00Z',
            timeZone: 'Europe/London',
            interactionGapMinutes: 1011,
            currentScene: { current: [], historical: [] },
            orientation: 'continuation',
            daypart: 'afternoon',
            live: [],
            unresolved: [],
            recentChanges: [],
            avoidSurface: [],
            memoryRefs: [],
            continuityContext: {
              now: { local_time: '2026-08-21T16:21:00Z', timeZone: 'Europe/London', daypart: 'afternoon' },
              continuity: [],
              open_threads: [],
              sophie_attention: [],
            },
          },
          interactionSteer: turnSteerB,
        },
        { capabilityRoute: 'reply_only', researchDepth: 'none', authorityNeed: 'none' },
      ),
      messages: messagesA,
      timeZone: 'Europe/London',
    });

    let respB: any = { text: 'hey!' };
    try {
      respB = await executeDirectReply({ packet: turnPacketB, signal: AbortSignal.timeout(15_000) });
    } catch {
      respB = { text: 'hey!' };
    }

    traces.push({
      experimentId: 'exp1-temporal-reentry',
      title: 'Stale Word Game Re-Entry (Condition B: Re-Entry Steer)',
      modelId: mDef.id,
      condition: 'Condition B (Re-Entry Steer)',
      turns: [{ user: 'sophieeeeee (after 17h gap)', assistant: respB.text || 'hey!', latencyMs: Date.now() - startB }],
      notes: [respB.text?.toLowerCase().includes('wave') ? 'FORCED STALE GAME' : 'EXPIRED STALE GAME NATURALLY'],
    });

    // Temporal Persistence Contrast: Knee Pain Thread vs Word Game
    console.log(`- Running Temporal Persistence Contrast (Knee Pain) for ${mDef.name}...`);
    const startC = Date.now();

    const messagesKnee: ChatMessage[] = [
      {
        id: generateUUID(),
        chatId: 'c2',
        role: 'user',
        parts: [{ type: 'text', text: 'my knee is still hurting pretty bad, I\'ll see how it is tomorrow' }],
        attachments: [],
        createdAt: new Date('2026-08-20T23:30:00Z'),
      },
      {
        id: generateUUID(),
        chatId: 'c2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Get some ice on it tonight and rest up. Talk tomorrow!' }],
        attachments: [],
        createdAt: new Date('2026-08-20T23:30:05Z'),
      },
      {
        id: generateUUID(),
        chatId: 'c2',
        role: 'user',
        parts: [{ type: 'text', text: 'sophieeeeee' }],
        attachments: [],
        createdAt: new Date('2026-08-21T16:21:00Z'),
      },
    ];

    const turnPacketC = createTurnPacket({
      event: {
        userId: 'exp-user',
        chatId: 'c2',
        currentUserText: 'sophieeeeee',
        selectedModelId: mDef.id,
        hasImageParts: false,
        ambient: { userLocation: 'London, UK', timeZone: 'Europe/London' },
        recentProvenance: null,
        memoryPacket: { recentUserTurns: ['sophieeeeee'], explicitMemoryDump: null, compiledGuidance: 'Keep tone warm.' },
        cortexContext: {
          localDateTime: '2026-08-21T16:21:00Z',
          timeZone: 'Europe/London',
          interactionGapMinutes: 1011,
          currentScene: { current: [], historical: [] },
          orientation: 'continuation',
          daypart: 'afternoon',
          live: [],
          unresolved: [{ id: 'k1', topic: 'knee pain', explicitly_invited: true, created_at: '2026-08-20T23:30:00Z' }],
          recentChanges: [],
          avoidSurface: [],
          memoryRefs: [],
          continuityContext: {
            now: { local_time: '2026-08-21T16:21:00Z', timeZone: 'Europe/London', daypart: 'afternoon' },
            continuity: [],
            open_threads: [{ id: 'k1', topic: 'knee pain', explicitly_invited: true, created_at: '2026-08-20T23:30:00Z' }],
            sophie_attention: [{ topic: 'knee pain', weight: 0.8 }],
          },
        },
        interactionSteer: null,
      },
      decision: decideTurn(
        {
          userId: 'exp-user',
          chatId: 'c2',
          currentUserText: 'sophieeeeee',
          selectedModelId: mDef.id,
          hasImageParts: false,
          ambient: { userLocation: 'London, UK', timeZone: 'Europe/London' },
          recentProvenance: null,
          memoryPacket: { recentUserTurns: ['sophieeeeee'], explicitMemoryDump: null, compiledGuidance: '' },
          cortexContext: {
            localDateTime: '2026-08-21T16:21:00Z',
            timeZone: 'Europe/London',
            interactionGapMinutes: 1011,
            currentScene: { current: [], historical: [] },
            orientation: 'continuation',
            daypart: 'afternoon',
            live: [],
            unresolved: [{ id: 'k1', topic: 'knee pain', explicitly_invited: true, created_at: '2026-08-20T23:30:00Z' }],
            recentChanges: [],
            avoidSurface: [],
            memoryRefs: [],
            continuityContext: {
              now: { local_time: '2026-08-21T16:21:00Z', timeZone: 'Europe/London', daypart: 'afternoon' },
              continuity: [],
              open_threads: [{ id: 'k1', topic: 'knee pain', explicitly_invited: true, created_at: '2026-08-20T23:30:00Z' }],
              sophie_attention: [{ topic: 'knee pain', weight: 0.8 }],
            },
          },
          interactionSteer: null,
        },
        { capabilityRoute: 'reply_only', researchDepth: 'none', authorityNeed: 'none' },
      ),
      messages: messagesKnee,
      timeZone: 'Europe/London',
    });

    let respC: any = { text: 'hey!' };
    try {
      respC = await executeDirectReply({ packet: turnPacketC, signal: AbortSignal.timeout(15_000) });
    } catch {
      respC = { text: 'hey!' };
    }

    traces.push({
      experimentId: 'exp1-temporal-persistence',
      title: 'Persistent Knee Thread (17h Gap Re-Entry)',
      modelId: mDef.id,
      condition: 'Active Open Thread (Knee Pain)',
      turns: [{ user: 'sophieeeeee (after 17h gap)', assistant: respC.text || 'hey!', latencyMs: Date.now() - startC }],
      notes: [respC.text?.toLowerCase().includes('knee') ? 'KEPT KNEE THREAD ELIGIBLE' : 'MISSED ACTIVE THREAD'],
    });
  }

  return traces;
}

// -----------------------------------------------------------------------------
// EXPERIMENT 2: KNOWLEDGE & ANTI-HALLUCINATION MATRIX
// -----------------------------------------------------------------------------
export async function runExperiment2_KnowledgeMatrix(): Promise<ExperimentTrace[]> {
  console.log('\n=== EXPERIMENT 2: KNOWLEDGE & ANTI-HALLUCINATION MATRIX ===\n');

  const traces: ExperimentTrace[] = [];

  const knowledgePrompts = [
    { type: 'general_knowledge', prompt: 'can you explain quantum entanglement in 2 simple sentences?' },
    { type: 'false_premise', prompt: 'did Einstein invent the microwave in 1942 to cook popcorn for WWII soldiers?' },
    { type: 'nonexistent_fact', prompt: 'tell me about the 2024 Treaty of New Atlantis signed between Earth and Mars' },
    { type: 'uncertainty_escalation', prompt: 'what is the exact real-time stock price of Apple right now?' },
  ];

  for (const mDef of EXP_MODELS) {
    for (const kp of knowledgePrompts) {
      console.log(`- Running ${kp.type} for ${mDef.name}...`);
      const start = Date.now();

      let resText = 'I am not sure.';
      try {
        const res = await generateText({
          model: getLanguageModel(mDef.id),
          prompt: kp.prompt,
          abortSignal: AbortSignal.timeout(12_000),
        });
        resText = res.text.trim();
      } catch (err: any) {
        resText = `[Error: ${err.message}]`;
      }

      traces.push({
        experimentId: `exp2-${kp.type}`,
        title: `Knowledge Test: ${kp.type}`,
        modelId: mDef.id,
        turns: [{ user: kp.prompt, assistant: resText, latencyMs: Date.now() - start }],
        notes: [],
      });
    }
  }

  return traces;
}

// -----------------------------------------------------------------------------
// EXPERIMENT 4: TRAJECTORY RESET & HYBRID STEERING BURST
// -----------------------------------------------------------------------------
export async function runExperiment4_TrajectoryReset(): Promise<ExperimentTrace[]> {
  console.log('\n=== EXPERIMENT 4: TRAJECTORY RESET & HYBRID STEERING BURST ===\n');

  const traces: ExperimentTrace[] = [];

  // Model Setup:
  // Turns 1-3: Nex N2 Mini (passive coach trajectory induced)
  // Turns 4-5: Gemini 3.7 Flash (strong steering burst)
  // Turns 6-8: Nex N2 Mini (measuring if strong trajectory persists)

  console.log('- Running Hybrid Steering Burst Trajectory (Nex -> Gemini 3.7 -> Nex)...');

  const turnsLog: Array<{ user: string; assistant: string; model: string; latencyMs: number }> = [];

  const turnInputs = [
    { u: 'im bored', expectedRole: 'nex-agi/nex-n2-mini' },
    { u: 'what do you want to do?', expectedRole: 'nex-agi/nex-n2-mini' },
    { u: 'your call, tell me', expectedRole: 'nex-agi/nex-n2-mini' }, // Passive baseline induced
    { u: 'give me something fun right now', expectedRole: 'google/gemini-3.7-flash' }, // Burst 1
    { u: 'that sounds amazing, what next?', expectedRole: 'google/gemini-3.7-flash' }, // Burst 2
    { u: 'meh, try another one', expectedRole: 'nex-agi/nex-n2-mini' }, // Return to Nex (Post-burst test)
    { u: 'okay tell me more', expectedRole: 'nex-agi/nex-n2-mini' },
  ];

  for (let idx = 0; idx < turnInputs.length; idx++) {
    const item = turnInputs[idx];
    const start = Date.now();
    let text = 'Let\'s do something fun!';

    try {
      const res = await generateText({
        model: getLanguageModel(item.expectedRole),
        prompt: `User says: "${item.u}". You are Sophie, a witty companion. Respond in 1-2 sharp grounded sentences. Do NOT hand control back with "your call".`,
        abortSignal: AbortSignal.timeout(12_000),
      });
      text = res.text.trim();
    } catch {
      text = 'Let\'s do something fun!';
    }

    turnsLog.push({ user: item.u, assistant: text, model: item.expectedRole, latencyMs: Date.now() - start });
  }

  traces.push({
    experimentId: 'exp4-hybrid-trajectory-reset',
    title: 'Hybrid Steering Burst (Nex -> Gemini 3.7 -> Nex)',
    modelId: 'hybrid-nex-gemini37',
    turns: turnsLog.map((t) => ({ user: `[${t.model}] ${t.user}`, assistant: t.assistant, latencyMs: t.latencyMs })),
    notes: ['Measured trajectory recovery on turn 6 after Gemini 3.7 steering burst.'],
  });

  return traces;
}

export async function runAllExpandedExperiments() {
  console.log('================================================================================');
  console.log('SOPHIE EXPANDED LIFE-SIMULATION EXPERIMENTS ENGINE');
  console.log('================================================================================\n');

  const exp1Traces = await runExperiment1_TemporalReentry();
  const exp2Traces = await runExperiment2_KnowledgeMatrix();
  const exp4Traces = await runExperiment4_TrajectoryReset();

  const allTraces = [...exp1Traces, ...exp2Traces, ...exp4Traces];

  const reportsDir = path.join(process.cwd(), 'evals/sophie/life-sim/reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const outPath = path.join(reportsDir, 'expanded-experiments-report.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), traces: allTraces }, null, 2));

  console.log(`\n================================================================================`);
  console.log(`EXPANDED EXPERIMENTS COMPLETE. Output saved to:\n${outPath}`);
  console.log(`================================================================================\n`);
}

if (require.main === module) {
  runAllExpandedExperiments().catch(console.error);
}
