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
  try {
    return await submit(baseUrl, secret, input);
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
