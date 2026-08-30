import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';

const executionLaneSchema = z.enum([
  'reply_only',
  'read_tools',
  'live_data',
  'research',
]);

const completedTurnSchema = z.object({
  status: z.literal('completed'),
  turn_id: z.string(),
  conversation_id: z.string(),
  assistant_message: z.string().min(1),
  // Optional native multi-beat structure: 1..3 intentional beats in delivery
  // order. Absent when the reply is a single logical beat.
  beats: z.array(z.string().min(1)).min(1).max(3).nullable().optional(),
  beat_delivery: z.array(z.object({
    kind: z.enum(['immediate', 'continuation']),
    available_after_ms: z.number().int().nonnegative().max(30_000),
  })).min(1).max(3).nullable().optional(),
  model_used: z.string(),
  provider_used: z.string(),
  execution_lane: z.literal('reply_only'),
  used_fallback: z.boolean(),
  finish_reason: z.string(),
  execution_metadata: z.record(z.unknown()),
  scene_state: z.record(z.unknown()),
  epistemic_classification: z.record(z.unknown()),
  honcho_memory_packet: z.record(z.unknown()).nullable(),
  cortex_context_packet: z.record(z.unknown()).nullable(),
});

const deferredTurnSchema = z.object({
  status: z.literal('deferred'),
  turn_id: z.string(),
  conversation_id: z.string(),
  execution_lane: executionLaneSchema.exclude(['reply_only']),
  model_role: z.enum(['conversation', 'judgment', 'live_data', 'research']),
  model_id: z.string(),
  fallback_model_id: z.string(),
  reason: z.string(),
  epistemic_classification: z.record(z.unknown()),
  scene_state: z.record(z.unknown()),
  honcho_memory_packet: z.record(z.unknown()).nullable(),
  cortex_context_packet: z.record(z.unknown()).nullable(),
});

const runtimeResultSchema = z.discriminatedUnion('status', [
  completedTurnSchema,
  deferredTurnSchema,
]);

const statusResponseSchema = z.object({
  status: z.enum(['executing', 'completed', 'failed', 'cancelled', 'deferred']),
  result: z.unknown().nullable(),
});

const streamStatusEventSchema = z.object({
  contract_version: z.literal('v1'),
  turn_id: z.string(),
  conversation_id: z.string(),
  status: z.literal('executing'),
  // Consumers must tolerate phases added by later runtime versions.
  phase: z.string(),
  elapsed_ms: z.number().nonnegative(),
});

const streamTextDeltaEventSchema = z.object({
  contract_version: z.literal('v1'),
  turn_id: z.string(),
  conversation_id: z.string(),
  delta: z.string(),
  index: z.number().int().nonnegative(),
  elapsed_ms: z.number().nonnegative(),
});

const streamCompletedEventSchema = z.object({
  contract_version: z.literal('v1'),
  turn_id: z.string(),
  conversation_id: z.string(),
  result: runtimeResultSchema,
});

const streamErrorEventSchema = z.object({
  contract_version: z.literal('v1'),
  turn_id: z.string(),
  conversation_id: z.string(),
  error: z.object({
    status: z.string(),
    error_code: z.string(),
    message: z.string(),
  }),
});

export type CompanionRuntimeStreamEvent =
  | { type: 'status'; data: z.infer<typeof streamStatusEventSchema> }
  | { type: 'text_delta'; data: z.infer<typeof streamTextDeltaEventSchema> }
  | { type: 'completed'; data: z.infer<typeof streamCompletedEventSchema> }
  | { type: 'error'; data: z.infer<typeof streamErrorEventSchema> };

export type CompanionRuntimeResult = z.infer<typeof runtimeResultSchema>;

export type CompanionRuntimeTurnInput = {
  contract_version: 'v1';
  turn_id: string;
  conversation_id: string;
  companion_id: 'sophie';
  selected_model_id: string;
  current_sanitized_message: string;
  message_parts: unknown[];
  canonical_history: unknown[];
  trusted_user_context: Record<string, unknown>;
  recent_provenance: Record<string, unknown>;
  capability_grant: {
    allow_read_tools: boolean;
    allow_live_data: boolean;
    allow_research: boolean;
    granted_scopes: string[];
  };
  transcript_reliability: unknown | null;
};

function configuration() {
  const baseUrl = process.env.COMPANION_RUNTIME_URL?.trim().replace(/\/$/u, '');
  const secret = process.env.COMPANION_RUNTIME_SECRET?.trim();
  return {
    enabled:
      Boolean(baseUrl && secret) &&
      process.env.COMPANION_RUNTIME_REPLY_ONLY_ENABLED !== 'false',
    baseUrl,
    secret,
  };
}

export function companionRuntimeReplyOnlyEnabled() {
  return configuration().enabled;
}

export function companionRuntimeAssistantMessageId(
  conversationId: string,
  turnId: string,
) {
  const hex = createHash('sha256')
    .update(`companion-runtime-assistant:${conversationId}:${turnId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function legacyCompanionRuntimeAssistantMessageId(turnId: string) {
  const hex = createHash('sha256')
    .update(`companion-runtime-assistant:${turnId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function configuredRuntime() {
  const config = configuration();
  if (!config.baseUrl || !config.secret) {
    throw new Error(
      'Companion Runtime is enabled but COMPANION_RUNTIME_URL or COMPANION_RUNTIME_SECRET is missing.',
    );
  }
  return { baseUrl: config.baseUrl, secret: config.secret };
}

async function requestJson(
  url: string,
  secret: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Companion-Runtime-Key': secret,
      ...init.headers,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Companion Runtime HTTP ${response.status}`);
  }
  return response.json();
}

async function submit(
  baseUrl: string,
  secret: string,
  input: CompanionRuntimeTurnInput,
) {
  const raw = await requestJson(
    `${baseUrl}/v1/turns`,
    secret,
    { method: 'POST', body: JSON.stringify(input) },
    Number(process.env.COMPANION_RUNTIME_REQUEST_TIMEOUT_MS ?? 250_000),
  );
  return runtimeResultSchema.parse(raw);
}

export async function executeCompanionRuntimeTurn(
  input: CompanionRuntimeTurnInput,
): Promise<CompanionRuntimeResult> {
  const { baseUrl, secret } = configuredRuntime();
  // WS10 latency waterfall: BFF-side cost of the runtime turn call
  // (network + full runtime execution). Surfaced via logs and metadata.
  const runtimeCallStartedAtMs = Date.now();
  try {
    const result = await submit(baseUrl, secret, input);
    const bffRuntimeCallMs = Date.now() - runtimeCallStartedAtMs;
    const completedMeta =
      result.status === 'completed'
        ? (result as { execution_metadata?: Record<string, unknown> })
            .execution_metadata
        : null;
    console.log('[latency-waterfall] bff_runtime_call_ms', {
      turnId: input.turn_id,
      bffRuntimeCallMs,
      runtimeTotalMs: completedMeta?.total_ms ?? null,
      runtimeTtftMs: completedMeta?.time_to_first_token_ms ?? null,
      runtimeContextMs: completedMeta?.context_ms ?? null,
      runtimeStages: completedMeta?.stage_timings_ms ?? null,
    });
    return result;
  } catch (initialError) {
    // The POST may have reached Python even when its HTTP response was lost.
    // Resolve through the durable turn record, then retry the identical input;
    // never fall through to the TypeScript reply model from this path.
    try {
      const rawStatus = await requestJson(
        `${baseUrl}/v1/turns/${encodeURIComponent(input.turn_id)}?conversation_id=${encodeURIComponent(input.conversation_id)}`,
        secret,
        { method: 'GET' },
        10_000,
      );
      const status = statusResponseSchema.parse(rawStatus);
      if (status.status === 'completed' || status.status === 'deferred') {
        return runtimeResultSchema.parse(status.result);
      }
      if (
        status.status === 'executing' ||
        status.status === 'failed' ||
        status.status === 'cancelled'
      ) {
        return await submit(baseUrl, secret, input);
      }
    } catch (recoveryError) {
      throw new AggregateError(
        [initialError, recoveryError],
        'Companion Runtime execution became ambiguous and status recovery failed.',
      );
    }
    throw initialError;
  }
}

function parseStreamEvent(
  eventName: string,
  data: string,
): CompanionRuntimeStreamEvent | null {
  if (!['status', 'text_delta', 'completed', 'error'].includes(eventName)) {
    return null;
  }

  const value: unknown = JSON.parse(data);
  switch (eventName) {
    case 'status':
      return { type: 'status', data: streamStatusEventSchema.parse(value) };
    case 'text_delta':
      return {
        type: 'text_delta',
        data: streamTextDeltaEventSchema.parse(value),
      };
    case 'completed':
      return {
        type: 'completed',
        data: streamCompletedEventSchema.parse(value),
      };
    case 'error':
      return { type: 'error', data: streamErrorEventSchema.parse(value) };
    default:
      return null;
  }
}

/**
 * Consume Companion Runtime's authenticated SSE protocol. Deltas are
 * presentation-only; callers must persist only the terminal completed result.
 */
export async function* streamCompanionRuntimeTurn(
  input: CompanionRuntimeTurnInput,
): AsyncGenerator<CompanionRuntimeStreamEvent> {
  const { baseUrl, secret } = configuredRuntime();
  const response = await fetch(`${baseUrl}/v1/turns/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Companion-Runtime-Key': secret,
    },
    body: JSON.stringify(input),
    cache: 'no-store',
    signal: AbortSignal.timeout(
      Number(process.env.COMPANION_RUNTIME_REQUEST_TIMEOUT_MS ?? 250_000),
    ),
  });

  if (!response.ok) {
    throw new Error(`Companion Runtime stream HTTP ${response.status}`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('Companion Runtime stream returned a non-SSE response');
  }
  if (!response.body) {
    throw new Error('Companion Runtime stream returned no response body');
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let terminalSeen = false;

  while (true) {
    const { done, value } = await reader.read();
    buffer += value ?? '';
    const normalized = buffer.replace(/\r\n/gu, '\n');
    const frames = normalized.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }
      if (dataLines.length === 0) continue;
      const event = parseStreamEvent(eventName, dataLines.join('\n'));
      if (!event) continue;
      if (event.type === 'completed' || event.type === 'error') {
        terminalSeen = true;
      }
      yield event;
    }

    if (done) break;
  }

  if (!terminalSeen) {
    throw new Error('Companion Runtime stream ended without a terminal event');
  }
}
