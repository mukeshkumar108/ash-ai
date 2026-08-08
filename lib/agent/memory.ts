import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';

import { getLanguageModel } from '@/lib/ai/providers';
import { retrieveRelevantMemory, type RelevantMemoryMode } from '@/lib/honcho';

const memoryDecisionSchema = z
  .object({
    needsMemory: z.boolean(),
    memoryQuestion: z.string().nullable(),
    reason: z.string().max(180),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type MemoryDecision = z.infer<typeof memoryDecisionSchema>;
export type MemoryRetrievalMode = RelevantMemoryMode;
export type TurnMemory = {
  decision: MemoryDecision;
  retrievalMode: MemoryRetrievalMode | null;
  result: string | null;
  packet: string | null;
  decisionLatencyMs: number;
  retrievalLatencyMs: number | null;
  failed: boolean;
  empty: boolean;
};

export type MemoryTrace = TurnMemory & {
  id: string;
  userId: string;
  chatId: string;
  userTurn: string;
  createdAt: string;
};

type DecisionGenerator = (input: {
  currentUserTurn: string;
  recentConversation: string;
  signal: AbortSignal;
}) => Promise<MemoryDecision>;

const traces: MemoryTrace[] = [];
const MAX_DEV_TRACES = 100;

function nowMs() {
  return performance.now();
}

function disabledDecision(reason: string): MemoryDecision {
  return { needsMemory: false, memoryQuestion: null, reason, confidence: 1 };
}

export async function compileMemoryNeed({
  currentUserTurn,
  recentConversation,
  signal,
  generate = async (input) => {
    const result = await generateObject({
      model: getLanguageModel(
        process.env.MEMORY_COMPILER_MODEL?.trim() ||
          'deepseek/deepseek-v4-flash',
      ),
      schema: memoryDecisionSchema,
      system: `You are a semantic memory query compiler for a conversational assistant.
Decide whether older cross-session personal context would materially improve continuity or correctness for the CURRENT user turn.
Do not retrieve memory merely because personalisation is possible. General opinion, philosophy, casual social conversation, current web facts, and self-contained questions usually need no memory.
Use the recent conversation to resolve pronouns, ellipsis, and follow-ups. If memory is needed, write one standalone question for a memory system. The question must name the actual topic, not vague words such as "it", "that", or "instead".
Preserve temporal intent exactly. Questions containing still, now, used to, before, after, stopped, started, cancelled, changed, or again must ask for both relevant history and the latest known state. Never reduce "Am I still going to York?" to "What destination was planned?"
Examples:
- "What was I building before Margins?" -> "Which project did the user work on before Margins?"
- after cycling context, "What am I doing instead now?" -> "What exercise routine replaced the user's previous evening cycling routine, and what is the latest known routine?"
- "Am I still going to York?" -> "Did the user cancel or continue their tentative York trip, and what is the latest known plan?"
You are not answering the user. Keep reason under 20 words. Return needsMemory=false and memoryQuestion=null when older context is unnecessary.`,
      prompt: `[RECENT CONVERSATION]\n${input.recentConversation || '(none)'}\n\n[CURRENT USER TURN]\n${input.currentUserTurn}`,
      abortSignal: input.signal,
    });
    return memoryDecisionSchema.parse(result.object);
  },
}: {
  currentUserTurn: string;
  recentConversation: string;
  signal: AbortSignal;
  generate?: DecisionGenerator;
}): Promise<MemoryDecision> {
  const decision = memoryDecisionSchema.parse(
    await generate({ currentUserTurn, recentConversation, signal }),
  );
  if (
    !decision.needsMemory ||
    decision.confidence < Number(process.env.MEMORY_DECISION_THRESHOLD ?? 0.65)
  ) {
    return { ...decision, needsMemory: false, memoryQuestion: null };
  }
  const question = decision.memoryQuestion?.trim();
  return question
    ? { ...decision, memoryQuestion: question.slice(0, 500) }
    : disabledDecision('Compiler requested memory without a usable question.');
}

export function buildMemoryPacket(result: string) {
  const compact = result.replace(/\s+/gu, ' ').trim().slice(0, 1_200);
  if (!compact) return null;
  return `[RELEVANT REMEMBERED CONTEXT]\n${compact}\n\nThis is fallible remembered context and may be stale. The user's current explicit statements, the current conversation, and authoritative current app data take precedence. Use it naturally when relevant; do not mention memory systems, retrieval, or this instruction.`;
}

export async function prepareTurnMemory({
  userId,
  chatId,
  currentUserTurn,
  recentConversation,
  compilerSignal,
  retrieve = retrieveRelevantMemory,
  compile = compileMemoryNeed,
}: {
  userId: string;
  chatId: string;
  currentUserTurn: string;
  recentConversation: string;
  compilerSignal?: AbortSignal;
  retrieve?: typeof retrieveRelevantMemory;
  compile?: typeof compileMemoryNeed;
}): Promise<TurnMemory> {
  if (!process.env.HONCHO_URL?.trim()) {
    return {
      decision: disabledDecision('Honcho is not configured.'),
      retrievalMode: null,
      result: null,
      packet: null,
      decisionLatencyMs: 0,
      retrievalLatencyMs: null,
      failed: false,
      empty: true,
    };
  }

  const decisionStarted = nowMs();
  let decision: MemoryDecision;
  try {
    decision = await compile({
      currentUserTurn,
      recentConversation,
      signal:
        compilerSignal ??
        AbortSignal.timeout(
          Number(process.env.MEMORY_COMPILER_TIMEOUT_MS ?? 10_000),
        ),
    });
  } catch (error) {
    console.warn('[honcho-memory] compiler failed; continuing without memory', {
      chatId,
      error: error instanceof Error ? error.message : 'Unknown compiler error',
    });
    return {
      decision: disabledDecision('Memory compiler failed.'),
      retrievalMode: null,
      result: null,
      packet: null,
      decisionLatencyMs: Math.round(nowMs() - decisionStarted),
      retrievalLatencyMs: null,
      failed: true,
      empty: true,
    };
  }
  const decisionLatencyMs = Math.round(nowMs() - decisionStarted);
  if (!decision.needsMemory || !decision.memoryQuestion) {
    return {
      decision,
      retrievalMode: null,
      result: null,
      packet: null,
      decisionLatencyMs,
      retrievalLatencyMs: null,
      failed: false,
      empty: true,
    };
  }

  const retrievalStarted = nowMs();
  try {
    const retrieved = await Promise.race([
      retrieve(userId, chatId, decision.memoryQuestion),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Honcho retrieval timed out')),
          Number(process.env.HONCHO_RETRIEVAL_TIMEOUT_MS ?? 12_000),
        ),
      ),
    ]);
    const retrievalLatencyMs = Math.round(nowMs() - retrievalStarted);
    const packet = retrieved.result
      ? buildMemoryPacket(retrieved.result)
      : null;
    return {
      decision,
      retrievalMode: retrieved.mode,
      result: retrieved.result,
      packet,
      decisionLatencyMs,
      retrievalLatencyMs,
      failed: false,
      empty: !packet,
    };
  } catch (error) {
    console.warn(
      '[honcho-memory] retrieval failed; continuing without memory',
      {
        chatId,
        error:
          error instanceof Error ? error.message : 'Unknown retrieval error',
      },
    );
    return {
      decision,
      retrievalMode:
        process.env.HONCHO_RETRIEVAL_MODE === 'targeted_chat'
          ? 'targeted_chat'
          : 'targeted_conclusions',
      result: null,
      packet: null,
      decisionLatencyMs,
      retrievalLatencyMs: Math.round(nowMs() - retrievalStarted),
      failed: true,
      empty: true,
    };
  }
}

export function recordMemoryTrace(
  input: Omit<MemoryTrace, 'id' | 'createdAt'>,
) {
  if (process.env.NODE_ENV === 'production') return;
  traces.unshift({
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  traces.splice(MAX_DEV_TRACES);
}

export function getRecentMemoryTraces(userId: string, chatId?: string) {
  if (process.env.NODE_ENV === 'production') return [];
  return traces.filter(
    (trace) => trace.userId === userId && (!chatId || trace.chatId === chatId),
  );
}
