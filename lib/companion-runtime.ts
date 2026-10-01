import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';

const executionLaneSchema = z.enum([
  'reply_only',
  'read_tools',
  'live_data',
  'research',
]);

const beatDeliverySchema = z.object({
  kind: z.enum(['immediate', 'continuation']),
  available_after_ms: z.number().int().nonnegative().max(30_000),
});

// The accepted Runtime result is slim: no decision record, epistemic
// classification, memory packet or context packet. State the product must
// carry is `execution_metadata.next_session_state` (opaque, verbatim).
const completedTurnSchema = z.object({
  status: z.literal('completed'),
  turn_id: z.string(),
  conversation_id: z.string(),
  companion_id: z.string().optional(),
  assistant_message: z.string().min(1),
  // Optional native multi-beat structure: 1..3 intentional beats in delivery
  // order. Absent when the reply is a single logical beat.
  beats: z.array(z.string().min(1)).min(1).max(3).nullable().optional(),
  beat_delivery: z.array(beatDeliverySchema).min(1).max(3).nullable().optional(),
  model_used: z.string(),
  provider_used: z.string(),
  execution_lane: z.literal('reply_only'),
  used_fallback: z.boolean(),
  finish_reason: z.string(),
  execution_metadata: z.record(z.unknown()),
  scene_state: z.record(z.unknown()),
  latency_ms: z.number().optional(),
});

// A lane the Runtime's Jev routed to a product-executed capability.
const deferredTurnSchema = z.object({
  status: z.literal('deferred'),
  turn_id: z.string(),
  conversation_id: z.string(),
  companion_id: z.string().optional(),
  execution_lane: executionLaneSchema.exclude(['reply_only']),
  model_role: z.enum(['conversation', 'judgment', 'live_data', 'research']),
  model_id: z.string(),
  fallback_model_id: z.string(),
  reason: z.string(),
  scene_state: z.record(z.unknown()),
  context: z.record(z.unknown()).default({}),
  next_session_state: z.record(z.unknown()).default({}),
});

const runtimeResultSchema = z.discriminatedUnion('status', [
  completedTurnSchema,
  deferredTurnSchema,
]);

const statusResponseSchema = z.object({
  status: z.enum(['executing', 'completed', 'failed', 'cancelled', 'deferred']),
  result: z.unknown().nullable(),
});

const proactiveTickResultSchema = z.object({
  contract_version: z.literal('v1'),
  request_id: z.string(),
  should_appear: z.boolean(),
  reason: z.string(),
  outbound_text: z.string().nullable().optional(),
  model_used: z.string().nullable().optional(),
  decision_id: z.string().nullable().optional(),
  occurrence_id: z.string().nullable().optional(),
  handover: z.record(z.unknown()),
  trace: z.record(z.unknown()),
});

export type CompanionRuntimeProactiveResult = z.infer<
  typeof proactiveTickResultSchema
>;

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

const streamBeatStartEventSchema = z.object({
  contract_version: z.literal('v1'),
  turn_id: z.string(),
  conversation_id: z.string(),
  beat_index: z.number().int().nonnegative(),
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
  | { type: 'beat_start'; data: z.infer<typeof streamBeatStartEventSchema> }
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

type TurnHistoryEntry = {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string }>;
  metadata?: { createdAt?: string } | null;
};

/**
 * The single product -> Runtime request shape. Products supply facts and
 * transport state only: user identity, timezone, deterministic chronology,
 * the explicit session-mode button state, the previous Runtime
 * `next_session_state` (verbatim, so resident Cortex state is not rehydrated),
 * delivery medium and audio provenance. No moves, modes, plans or context
 * packets of their own.
 */
export function buildCompanionRuntimeTurnInput(input: {
  turnId: string;
  conversationId: string;
  selectedModelAlias: string;
  currentText: string;
  currentParts: unknown[];
  history: TurnHistoryEntry[];
  userId: string;
  timeZone: string;
  entryContext: Record<string, unknown>;
  sessionRouting: Record<string, unknown>;
  medium: 'voice' | 'mobile_text' | 'desktop';
  transcriptReliability: unknown | null;
}): CompanionRuntimeTurnInput {
  return {
    contract_version: 'v1',
    turn_id: input.turnId,
    conversation_id: input.conversationId,
    companion_id: 'sophie',
    // Dropdown alias only; the Runtime owns foreground model selection.
    selected_model_id: input.selectedModelAlias,
    current_sanitized_message: input.currentText,
    message_parts: input.currentParts,
    canonical_history: input.history.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('\n'),
      created_at: entry.metadata?.createdAt,
      parts: entry.parts.filter(
        (part) => part.type === 'text' || part.type === 'file',
      ),
    })),
    trusted_user_context: {
      user_id: input.userId,
      timezone: input.timeZone,
      entry_context: input.entryContext,
      session_routing: input.sessionRouting,
      medium: input.medium,
    },
    recent_provenance: {},
    capability_grant: {
      allow_read_tools: true,
      allow_live_data: true,
      allow_research: true,
      granted_scopes: ['read_tools', 'live_data', 'research'],
    },
    transcript_reliability: input.transcriptReliability,
  };
}

function configuration() {
  const baseUrl = process.env.COMPANION_RUNTIME_URL?.trim().replace(/\/$/u, '');
  const secret = process.env.COMPANION_RUNTIME_SECRET?.trim();
  return { baseUrl, secret };
}

export function companionRuntimeMessageId(
  label: string,
  conversationId: string,
  turnId: string,
) {
  const hex = createHash('sha256')
    .update(`${label}:${conversationId}:${turnId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
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

function configuredRuntime() {
  const config = configuration();
  if (!config.baseUrl || !config.secret) {
    throw new Error(
      'COMPANION_RUNTIME_URL and COMPANION_RUNTIME_SECRET are required: Companion Runtime is the only conversational path.',
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
    throw Object.assign(new Error(`Companion Runtime HTTP ${response.status}`), {
      status: response.status,
    });
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
      // 404: the POST never reached the Runtime (e.g. a stale keep-alive
      // socket), so the identical turn is simply submitted.
      if ((recoveryError as { status?: number }).status === 404) {
        return await submit(baseUrl, secret, input);
      }
      throw new AggregateError(
        [initialError, recoveryError],
        'Companion Runtime execution became ambiguous and status recovery failed.',
      );
    }
    throw initialError;
  }
}

export async function executeCompanionRuntimeProactiveTick(input: {
  request_id: string;
  user_id: string;
  conversation_id: string;
  anchor_message_id: string;
  trigger: string;
  now: string;
  timezone: string;
  recent_history: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at?: string;
  }>;
}): Promise<CompanionRuntimeProactiveResult> {
  const { baseUrl, secret } = configuredRuntime();
  const raw = await requestJson(
    `${baseUrl}/v1/proactive/tick`,
    secret,
    {
      method: 'POST',
      body: JSON.stringify({ contract_version: 'v1', ...input }),
    },
    Number(process.env.COMPANION_RUNTIME_REQUEST_TIMEOUT_MS ?? 250_000),
  );
  return proactiveTickResultSchema.parse(raw);
}

export async function completeCompanionRuntimeProactive(input: {
  user_id: string;
  conversation_id: string;
  decision_id: string;
  occurrence_id?: string | null;
  delivered: boolean;
  now: string;
  reason?: string;
}) {
  const { baseUrl, secret } = configuredRuntime();
  return requestJson(
    `${baseUrl}/v1/proactive/complete`,
    secret,
    {
      method: 'POST',
      body: JSON.stringify({ contract_version: 'v1', ...input }),
    },
    20_000,
  );
}

function parseStreamEvent(
  eventName: string,
  data: string,
): CompanionRuntimeStreamEvent | null {
  if (
    !['status', 'text_delta', 'beat_start', 'completed', 'error'].includes(
      eventName,
    )
  ) {
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
    case 'beat_start':
      return {
        type: 'beat_start',
        data: streamBeatStartEventSchema.parse(value),
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
  signal?: AbortSignal,
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
    signal: signal
      ? AbortSignal.any([
          signal,
          AbortSignal.timeout(
            Number(process.env.COMPANION_RUNTIME_REQUEST_TIMEOUT_MS ?? 250_000),
          ),
        ])
      : AbortSignal.timeout(
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
