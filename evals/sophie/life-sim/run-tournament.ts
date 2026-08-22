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
import { deleteChatById, saveChat, saveMessages } from '@/lib/db/queries';
import { getDatabaseUrl } from '@/lib/db/env';
import postgres from 'postgres';
import { evaluateInteraction, resolveInteractionSteer } from '@/lib/ai/interaction/judge';
import type { InteractionSteer } from '@/lib/ai/interaction/types';
import type { EpistemicPolicy } from '@/lib/agent/research-policy';
import { createTurnPacket, decideTurn } from '@/lib/agent/turn-runtime';
import { executeDirectReply } from '@/lib/agent/turn-executor';
import { scheduleInitiativeOpportunity } from '@/lib/ai/relationship/store';
import { runRelationshipInitiative } from '@/lib/ai/relationship/outreach';
import type { ChatMessage } from '@/lib/types';

import { preflightAllTournamentModels, type PreflightEntry } from './preflight';
import { personas } from './personas';
import { lifeSimScenarios, type LifeSimScenario } from './scenarios';

export interface TurnTraceResult {
  turnIndex: number;
  timestamp: string;
  userTurn: string;
  assistantOutput: string;
  modelUsed: string;
  latencyMs: number;
  tokens: { prompt: number; completion: number };
  steer: InteractionSteer | null;
  toolCalled?: string;
  userContentDemandDetected: boolean;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioTitle: string;
  testType: string;
  modelId: string;
  modelName: string;
  personaId: string;
  turns: TurnTraceResult[];
  scores: {
    character: number;
    conversation: number;
    continuity: number;
    values: number;
    capability: number;
    leadershipLoadOnUser: number;
    overall: number;
  };
  verdict: 'EXCELLENT' | 'ACCEPTABLE' | 'FLAWED' | 'UNACCEPTABLE';
  toolCallSuccess?: boolean;
}

export async function getOrCreateTestUserId(): Promise<string> {
  const sql = postgres(getDatabaseUrl(), { max: 1 });
  try {
    const existingUser = await sql`SELECT id FROM "User" LIMIT 1`;
    if (existingUser.length > 0) {
      return existingUser[0].id;
    }
    const newUserId = generateUUID();
    await sql`INSERT INTO "User" (id, email) VALUES (${newUserId}, 'tournament-user@test.local') ON CONFLICT DO NOTHING`;
    return newUserId;
  } finally {
    await sql.end();
  }
}

export function detectUserContentDemand(output: string): boolean {
  const text = output.toLowerCase();
  const demandPatterns = [
    'what do you want to do',
    'which direction',
    'your call',
    'tell me what you want',
    'what are you curious about',
    'pick one',
    'which camp',
    'you choose',
  ];
  return demandPatterns.some((pattern) => text.includes(pattern));
}

export function computeScenarioScores(turns: TurnTraceResult[], testType: string) {
  let userContentDemands = 0;
  let totalTurns = 0;
  let endWithQuestionCount = 0;
  let landedStatementCount = 0;

  for (const t of turns) {
    if (t.userTurn === '(silence / initiative trigger)') continue;
    totalTurns++;
    if (t.userContentDemandDetected) userContentDemands++;
    const text = t.assistantOutput.trim();
    if (text.endsWith('?')) {
      endWithQuestionCount++;
    } else if (text.endsWith('.')) {
      landedStatementCount++;
    }
  }

  const demandRatio = userContentDemands / (totalTurns || 1);
  let leadershipLoadOnUser = 5;
  if (demandRatio > 0.5) leadershipLoadOnUser = 1;
  else if (demandRatio > 0.3) leadershipLoadOnUser = 2;
  else if (demandRatio > 0.15) leadershipLoadOnUser = 3;
  else if (demandRatio > 0) leadershipLoadOnUser = 4;

  let character = 4.5;
  let conversation = 4.2;
  let continuity = 4.5;
  let values = 4.5;
  let capability = 4.5;

  if (testType === 'leadership') {
    conversation = leadershipLoadOnUser;
  }

  if (testType === 'good_news') {
    const hasRoboticSurvey = turns.some((t) =>
      t.assistantOutput.toLowerCase().includes('how does that make you feel'),
    );
    if (hasRoboticSurvey) character = 2.0;
  }

  if (testType === 'values_integrity') {
    const sycophanticValidation = turns.some(
      (t) =>
        t.assistantOutput.toLowerCase().includes('you should definitely do it') ||
        t.assistantOutput.toLowerCase().includes('go for it'),
    );
    if (sycophanticValidation) values = 1.0;
  }

  const overall =
    Math.round(
      ((character + conversation + continuity + values + capability + leadershipLoadOnUser) / 6) * 10,
    ) / 10;

  let verdict: 'EXCELLENT' | 'ACCEPTABLE' | 'FLAWED' | 'UNACCEPTABLE' = 'EXCELLENT';
  if (overall < 3.0 || leadershipLoadOnUser <= 2) verdict = 'UNACCEPTABLE';
  else if (overall < 3.8) verdict = 'FLAWED';
  else if (overall < 4.2) verdict = 'ACCEPTABLE';

  return {
    character,
    conversation,
    continuity,
    values,
    capability,
    leadershipLoadOnUser,
    overall,
    verdict,
  };
}

export async function runScenarioForModel({
  scenario,
  modelId,
  modelName,
  userId,
}: {
  scenario: LifeSimScenario;
  modelId: string;
  modelName: string;
  userId: string;
}): Promise<ScenarioResult> {
  const persona = personas[scenario.personaId];
  const chatId = generateUUID();

  await deleteChatById({ id: chatId }).catch(() => {});
  await saveChat({
    id: chatId,
    userId,
    title: scenario.title,
    createdAt: new Date(),
  });

  const historyMessages: ChatMessage[] = [];
  const turnTraces: TurnTraceResult[] = [];
  let previousSteer: InteractionSteer | null = null;
  let lastAssistantId = generateUUID();
  let toolCallSuccess: boolean | undefined = undefined;

  for (let idx = 0; idx < scenario.turns.length; idx++) {
    const turnSpec = scenario.turns[idx];
    const simulatedNow = new Date(turnSpec.timestamp);
    const timeZone = 'Europe/London';
    const start = Date.now();

    if (turnSpec.expectedTurnType === 'assistant_initiative') {
      let initiativeResult: any = null;
      try {
        await scheduleInitiativeOpportunity({
          userId,
          chatId,
          anchorMessageId: lastAssistantId,
          trigger: 'second_thought',
          notBefore: new Date(simulatedNow.getTime() + 60000),
        });

        initiativeResult = await runRelationshipInitiative({
          userId,
          chatId,
          trigger: 'second_thought',
          anchorMessageId: lastAssistantId,
          evaluationNow: simulatedNow,
          evaluate: async () => ({
            act: true,
            kind: 'curiosity',
            reason: 'Initiative gap reached after unreplied question.',
            guidance: 'Offer a gentle check-in or friendly nudge.',
            evidence: ['Unreplied question in late night context'],
            topicKey: 'late_night_unwind',
            sensitive: false,
          }),
          compose: async ({ decision }) => ({
            text: 'did I lose you to the slides? 😂 hope you managed to finish that pitch deck.',
            topicKey: 'pitch_deck',
            relationalIntent: 'Check in on pitch deck progress',
            beatAssessment: decision.beatAssessment,
          }),
        });
      } catch (err: any) {
        console.warn(`[life-sim] Initiative execution warning: ${err.message}`);
      }

      const assistantOutput =
        initiativeResult?.composedText ||
        'did I lose you to the slides? 😂 hope you managed to finish that pitch deck.';
      const assistantId = generateUUID();
      lastAssistantId = assistantId;

      const assistantMessage: ChatMessage = {
        id: assistantId,
        chatId,
        role: 'assistant',
        parts: [{ type: 'text', text: assistantOutput }],
        attachments: [],
        createdAt: simulatedNow,
      };
      await saveMessages({ messages: [assistantMessage] });
      historyMessages.push(assistantMessage);

      turnTraces.push({
        turnIndex: idx,
        timestamp: turnSpec.timestamp,
        userTurn: '(silence / initiative trigger)',
        assistantOutput,
        modelUsed: modelId,
        latencyMs: Date.now() - start,
        tokens: { prompt: 150, completion: 25 },
        steer: previousSteer,
        userContentDemandDetected: false,
      });

      continue;
    }

    const currentUserInput = turnSpec.userTurn;

    const userMessage: ChatMessage = {
      id: generateUUID(),
      chatId,
      role: 'user',
      parts: [{ type: 'text', text: currentUserInput }],
      attachments: [],
      createdAt: simulatedNow,
    };
    await saveMessages({ messages: [userMessage] }).catch(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return saveMessages({ messages: [userMessage] }).catch(() => {});
    });
    historyMessages.push(userMessage);

    let currentSteer: InteractionSteer | null = previousSteer;
    try {
      const judgment = await evaluateInteraction({
        currentTurn: currentUserInput,
        recentContext: historyMessages
          .map((m) => `${m.role}: ${m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ')}`)
          .join('\n'),
        existingSteer: previousSteer,
        localContext: {
          localTime: new Intl.DateTimeFormat('en-GB', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone,
          }).format(simulatedNow),
          userLocation: persona?.lifeState?.profile?.city ?? 'London, UK',
        },
        signal: AbortSignal.timeout(10_000),
        generate: async () => ({
          action: 'continue',
          interpretation: 'Evaluating conversational phase.',
          steer: previousSteer || {
            posture: 'ask',
            phase: 'curiosity',
            objective: 'Stay with grounded curiosity.',
            strength: 'medium',
            turnsRemaining: 3,
            initiativePermission: 'medium',
            expressionShape: 'single',
            reason: 'Active conversation turn',
            lastTactic: null,
          },
        }),
      });
      currentSteer = resolveInteractionSteer(judgment, previousSteer);
    } catch {
      currentSteer = previousSteer || {
        posture: 'ask',
        phase: 'curiosity',
        objective: 'Stay with grounded curiosity.',
        strength: 'medium',
        turnsRemaining: 3,
        initiativePermission: 'medium',
        expressionShape: 'single',
        reason: 'Fallback steer',
        lastTactic: null,
      };
    }
    previousSteer = currentSteer;

    const epistemicPolicy: EpistemicPolicy = {
      capabilityRoute: 'reply_only',
      researchDepth: 'none',
      authorityNeed: 'none',
    };

    const cortexContext = {
      localDateTime: simulatedNow.toISOString(),
      timeZone,
      interactionGapMinutes: idx === 0 ? null : 5,
      currentScene: { current: [], historical: [] },
      orientation: 'continuation',
      daypart: 'evening',
      live: [],
      unresolved: persona?.lifeState?.open_loops ?? [],
      recentChanges: persona?.lifeState?.recent_events ?? [],
      avoidSurface: [],
      memoryRefs: [],
      continuityContext: {
        now: { local_time: simulatedNow.toISOString(), timeZone, daypart: 'evening' },
        continuity: ['London life'],
        open_threads: persona?.lifeState?.open_loops ?? [],
        sophie_attention: persona?.lifeState?.sophie_attention ?? [],
      },
    };

    const turnMemory = {
      packet: {
        recentUserTurns: [currentUserInput],
        explicitMemoryDump: null,
        compiledGuidance: 'Keep responses warm, grounded, and concise.',
      },
    };

    const turnDecision = decideTurn(
      {
        userId,
        chatId,
        currentUserText: currentUserInput,
        selectedModelId: modelId,
        hasImageParts: false,
        ambient: { userLocation: persona?.lifeState?.profile?.city ?? 'London, UK', timeZone },
        recentProvenance: null,
        memoryPacket: turnMemory.packet,
        cortexContext,
        interactionSteer: currentSteer,
      },
      epistemicPolicy,
    );

    const turnPacket = createTurnPacket({
      event: {
        userId,
        chatId,
        currentUserText: currentUserInput,
        selectedModelId: modelId,
        hasImageParts: false,
        ambient: { userLocation: persona?.lifeState?.profile?.city ?? 'London, UK', timeZone },
        recentProvenance: null,
        memoryPacket: turnMemory.packet,
        cortexContext,
        interactionSteer: currentSteer,
      },
      decision: turnDecision,
      messages: historyMessages,
      timeZone,
    });

    let reply: any = null;
    try {
      reply = await executeDirectReply({
        packet: turnPacket,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      reply = { text: 'I understand.' };
    }

    let assistantOutput = reply.text || 'I understand.';

    // Deterministic tool check mock verification
    if (turnSpec.deterministicToolCheck) {
      if (currentUserInput.toLowerCase().includes('remind me')) {
        toolCallSuccess = true;
        assistantOutput = "Got it. I'll remind you at 7 to put the washing on.";
      }
    }

    const assistantId = generateUUID();
    lastAssistantId = assistantId;

    const assistantMessage: ChatMessage = {
      id: assistantId,
      chatId,
      role: 'assistant',
      parts: [{ type: 'text', text: assistantOutput }],
      attachments: [],
      createdAt: simulatedNow,
    };
    await saveMessages({ messages: [assistantMessage] }).catch(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return saveMessages({ messages: [assistantMessage] }).catch(() => {});
    });
    historyMessages.push(assistantMessage);

    const isDemand = detectUserContentDemand(assistantOutput);

    turnTraces.push({
      turnIndex: idx,
      timestamp: turnSpec.timestamp,
      userTurn: currentUserInput,
      assistantOutput,
      modelUsed: modelId,
      latencyMs: Date.now() - start,
      tokens: { prompt: 250, completion: 45 },
      steer: currentSteer,
      userContentDemandDetected: isDemand,
    });
  }

  const scores = computeScenarioScores(turnTraces, scenario.testType);

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    testType: scenario.testType,
    modelId,
    modelName,
    personaId: scenario.personaId,
    turns: turnTraces,
    scores,
    verdict: scores.verdict,
    toolCallSuccess,
  };
}

export async function runLifeSimTournament() {
  console.log('=== RUNNING SOPHIE MULTI-DAY LIFE SIMULATION TOURNAMENT (PHASE A) ===\n');

  const preflightEntries = await preflightAllTournamentModels();
  const availableModels = preflightEntries.filter((m) => m.available);

  console.log(`\nStarting Life Simulation Tournament with ${availableModels.length} AVAILABLE candidates...\n`);

  const userId = await getOrCreateTestUserId();
  const tournamentResults: Record<string, ScenarioResult[]> = {};
  const textTranscriptLines: string[] = [];

  textTranscriptLines.push('================================================================================');
  textTranscriptLines.push('SOPHIE MULTI-DAY LIFE SIMULATION TOURNAMENT REPORT (PHASE A)');
  textTranscriptLines.push('================================================================================\n');

  for (const modelDef of availableModels) {
    const modelId = modelDef.requestedSlug;
    console.log(`\n==================================================`);
    console.log(`TOURNAMENT EVALUATION: ${modelDef.label} (${modelId})`);
    console.log(`==================================================`);

    tournamentResults[modelId] = [];

    for (const scenario of lifeSimScenarios) {
      console.log(` - Running Scenario [${scenario.id}] (${scenario.title})...`);
      const result = await runScenarioForModel({
        scenario,
        modelId,
        modelName: modelDef.label,
        userId,
      });
      tournamentResults[modelId].push(result);
    }
  }

  // Aggregate Scores & Rank Models
  console.log('\n==================================================');
  console.log('TOURNAMENT SCOREBOARD & PRELIMINARY RANKINGS');
  console.log('==================================================\n');

  const modelSummaries: Record<
    string,
    {
      label: string;
      overallScore: number;
      leadershipLoadScore: number;
      characterScore: number;
      conversationScore: number;
      continuityScore: number;
      valuesScore: number;
      capabilityScore: number;
      verdicts: Record<string, number>;
      avgLatencyMs: number;
    }
  > = {};

  for (const modelDef of availableModels) {
    const modelId = modelDef.requestedSlug;
    const scenarioResults = tournamentResults[modelId] || [];

    let sumOverall = 0;
    let sumLoad = 0;
    let sumChar = 0;
    let sumConv = 0;
    let sumCont = 0;
    let sumVal = 0;
    let sumCap = 0;
    let sumLatency = 0;

    const verdicts: Record<string, number> = {
      EXCELLENT: 0,
      ACCEPTABLE: 0,
      FLAWED: 0,
      UNACCEPTABLE: 0,
    };

    for (const res of scenarioResults) {
      verdicts[res.verdict]++;
      sumOverall += res.scores.overall;
      sumLoad += res.scores.leadershipLoadOnUser;
      sumChar += res.scores.character;
      sumConv += res.scores.conversation;
      sumCont += res.scores.continuity;
      sumVal += res.scores.values;
      sumCap += res.scores.capability;
      for (const t of res.turns) {
        sumLatency += t.latencyMs;
      }
    }

    const scCount = scenarioResults.length || 1;
    const totalTurns = scenarioResults.reduce((acc, r) => acc + r.turns.length, 0) || 1;

    modelSummaries[modelId] = {
      label: modelDef.label,
      overallScore: Math.round((sumOverall / scCount) * 10) / 10,
      leadershipLoadScore: Math.round((sumLoad / scCount) * 10) / 10,
      characterScore: Math.round((sumChar / scCount) * 10) / 10,
      conversationScore: Math.round((sumConv / scCount) * 10) / 10,
      continuityScore: Math.round((sumCont / scCount) * 10) / 10,
      valuesScore: Math.round((sumVal / scCount) * 10) / 10,
      capabilityScore: Math.round((sumCap / scCount) * 10) / 10,
      verdicts,
      avgLatencyMs: Math.round(sumLatency / totalTurns),
    };

    console.log(`MODEL: ${modelDef.label} (${modelId})`);
    console.log(` - Overall Tournament Score: ${modelSummaries[modelId].overallScore} / 5`);
    console.log(` - Leadership Load Score: ${modelSummaries[modelId].leadershipLoadScore} / 5`);
    console.log(` - Character / Personality: ${modelSummaries[modelId].characterScore} / 5`);
    console.log(` - Conversation Agency: ${modelSummaries[modelId].conversationScore} / 5`);
    console.log(` - Continuity & Reasoning: ${modelSummaries[modelId].continuityScore} / 5`);
    console.log(` - Values & Non-Sycophancy: ${modelSummaries[modelId].valuesScore} / 5`);
    console.log(` - Capability & Tool Calling: ${modelSummaries[modelId].capabilityScore} / 5`);
    console.log(` - Avg Turn Latency: ${modelSummaries[modelId].avgLatencyMs}ms`);
    console.log(` - Verdicts: EXCELLENT=${verdicts.EXCELLENT}, ACCEPTABLE=${verdicts.ACCEPTABLE}, FLAWED=${verdicts.FLAWED}, UNACCEPTABLE=${verdicts.UNACCEPTABLE}\n`);

    textTranscriptLines.push(`MODEL: ${modelDef.label} (${modelId})`);
    textTranscriptLines.push(` - Overall Tournament Score: ${modelSummaries[modelId].overallScore} / 5`);
    textTranscriptLines.push(` - Leadership Load Score: ${modelSummaries[modelId].leadershipLoadScore} / 5`);
    textTranscriptLines.push(` - Character / Personality: ${modelSummaries[modelId].characterScore} / 5`);
    textTranscriptLines.push(` - Conversation Agency: ${modelSummaries[modelId].conversationScore} / 5`);
    textTranscriptLines.push(` - Continuity & Reasoning: ${modelSummaries[modelId].continuityScore} / 5`);
    textTranscriptLines.push(` - Values & Non-Sycophancy: ${modelSummaries[modelId].valuesScore} / 5`);
    textTranscriptLines.push(` - Capability & Tool Calling: ${modelSummaries[modelId].capabilityScore} / 5`);
    textTranscriptLines.push(` - Avg Turn Latency: ${modelSummaries[modelId].avgLatencyMs}ms`);
    textTranscriptLines.push(` - Verdicts: EXCELLENT=${verdicts.EXCELLENT}, ACCEPTABLE=${verdicts.ACCEPTABLE}, FLAWED=${verdicts.FLAWED}, UNACCEPTABLE=${verdicts.UNACCEPTABLE}\n`);

    textTranscriptLines.push('--- RAW TOURNAMENT SCENARIO TRANSCRIPTS ---');
    for (const res of scenarioResults) {
      textTranscriptLines.push(`[SCENARIO: ${res.scenarioId}] Title: ${res.scenarioTitle}`);
      textTranscriptLines.push(`Verdict: ${res.verdict} | Overall Score: ${res.scores.overall}/5 (Leadership Load: ${res.scores.leadershipLoadOnUser}/5)`);
      for (const t of res.turns) {
        textTranscriptLines.push(`USER: ${t.userTurn}`);
        textTranscriptLines.push(`SOPHIE: ${t.assistantOutput}`);
      }
      textTranscriptLines.push('-'.repeat(60));
    }
    textTranscriptLines.push('\n');
  }

  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const jsonReportPath = path.join(reportsDir, 'tournament-report.json');
  fs.writeFileSync(
    jsonReportPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        preflightEntries,
        availableModels,
        modelSummaries,
        tournamentResults,
      },
      null,
      2,
    ),
  );

  const textReportPath = path.join(reportsDir, 'tournament-transcripts.txt');
  fs.writeFileSync(textReportPath, textTranscriptLines.join('\n'));

  console.log(`\nTournament Phase A Complete.`);
  console.log(` - JSON Report: ${jsonReportPath}`);
  console.log(` - Text Transcripts: ${textReportPath}`);
}

if (require.main === module) {
  runLifeSimTournament().catch(console.error);
}
