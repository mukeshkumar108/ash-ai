import 'server-only';

import { honchoIds } from '@/lib/honcho';
import type { SceneState } from '@/lib/agent/scene-state';

export type CortexContext = {
  localDateTime: string;
  timeZone: string;
  interactionGapMinutes: number | null;
  currentScene: SceneState;
  orientation: unknown;
  daypart: unknown;
  live: unknown[];
  unresolved: unknown[];
  recentChanges: unknown[];
  avoidSurface: unknown[];
  memoryRefs: unknown[];
  continuityContext: Record<string, unknown>;
};

export type CanonicalContinuityContext = {
  now?: { local_time?: string; timezone?: string; daypart?: string };
  continuity?: unknown[];
  open_threads?: unknown[];
  recent_resolutions?: unknown[];
  avoid_repeating?: unknown[];
  relevant_honcho_message_ids?: string[];
};

function list(value: unknown, limit: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

export function compactCortexContext(
  attention: Record<string, unknown>,
  handshake: Record<string, unknown>,
  localDateTime: string,
  timeZone = 'UTC',
  interactionGapMinutes: number | null = null,
  currentScene: SceneState = { current: [], historical: [] },
): CortexContext {
  const continuityContext =
    attention.continuity_context &&
    typeof attention.continuity_context === 'object' &&
    !Array.isArray(attention.continuity_context)
      ? (attention.continuity_context as Record<string, unknown>)
      : {
          now: { local_time: localDateTime, timeZone, daypart: handshake.daypart },
          continuity: list(attention.followups, 3),
          open_threads: list(attention.open_loops, 3),
          recent_resolutions: list(attention.recent_resolutions, 3),
          avoid_repeating: list(attention.suppressed_targets, 5),
          relevant_honcho_message_ids: list(
            attention.relevant_honcho_message_ids,
            8,
          ),
        };
  return {
    localDateTime,
    timeZone,
    interactionGapMinutes,
    currentScene,
    orientation:
      interactionGapMinutes === null
        ? (handshake.orientation ?? 'fresh_start')
        : interactionGapMinutes < 120
          ? 'continuation'
          : 'returning',
    daypart: handshake.daypart ?? null,
    live: list(handshake.live_threads, 3),
    unresolved: [
      ...list(attention.waiting_on, 2),
      ...list(attention.open_loops, 2),
    ].slice(0, 3),
    recentChanges: list(attention.recent_resolutions, 2),
    avoidSurface: list(handshake.avoid_surface, 3),
    memoryRefs: list(handshake.relevant_memory_refs, 3),
    continuityContext,
  };
}

export async function fetchCanonicalContinuityContext(input: {
  userId: string;
  chatId: string;
  timeZone: string;
  now?: Date;
}): Promise<CanonicalContinuityContext | null> {
  const config = configuration();
  if (!config.enabled || !config.contextEnabled || !config.baseURL) return null;
  const ids = honchoIds(input.userId, input.chatId);
  const query = new URLSearchParams({
    workspace_id: ids.workspaceId,
    session_id: ids.sessionId,
    now: (input.now ?? new Date()).toISOString(),
    timezone: input.timeZone,
  });
  try {
    const attention = await cortexFetch(
      `/v1/cortex/attention-packet?${query.toString()}`,
    );
    if (!attention) return null;
    const context = attention.continuity_context;
    return context && typeof context === 'object' && !Array.isArray(context)
      ? (context as CanonicalContinuityContext)
      : (compactCortexContext(
          attention,
          {},
          (input.now ?? new Date()).toISOString(),
          input.timeZone,
        ).continuityContext as CanonicalContinuityContext);
  } catch (error) {
    console.warn('[synapse-cortex] continuity fetch failed (fail-open)', {
      chatId: input.chatId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

function configuration() {
  const baseURL = process.env.SYNAPSE_CORTEX_URL?.trim().replace(/\/$/u, '');
  return {
    enabled:
      Boolean(baseURL) && process.env.SYNAPSE_CORTEX_ENABLED !== 'false',
    contextEnabled: process.env.SYNAPSE_CORTEX_CONTEXT_ENABLED !== 'false',
    baseURL,
    token: process.env.SYNAPSE_CORTEX_API_TOKEN?.trim(),
    timeoutMs: Number(process.env.SYNAPSE_CORTEX_TIMEOUT_MS ?? 1500),
  };
}

async function cortexFetch(path: string, init?: RequestInit) {
  const config = configuration();
  if (!config.enabled || !config.baseURL) return null;
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (config.token) headers.set('Authorization', `Bearer ${config.token}`);
  const response = await fetch(`${config.baseURL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(`Cortex HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function fetchCortexContext(input: {
  userId: string;
  chatId: string;
  timeZone: string;
  now?: Date;
  lastInteractionTime?: Date | null;
  sceneState?: SceneState;
}): Promise<CortexContext | null> {
  const config = configuration();
  if (!config.contextEnabled) return null;
  const ids = honchoIds(input.userId, input.chatId);
  const now = (input.now ?? new Date()).toISOString();
  try {
    const attentionQuery = new URLSearchParams({
      workspace_id: ids.workspaceId,
      session_id: ids.sessionId,
      now,
      timezone: input.timeZone,
    });
    const [attention, handshake] = await Promise.all([
      cortexFetch(`/v1/cortex/attention-packet?${attentionQuery.toString()}`),
      cortexFetch('/v1/cortex/handshake', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: ids.workspaceId,
          session_id: ids.sessionId,
          now,
          timezone: input.timeZone,
          last_interaction_time:
            input.lastInteractionTime?.toISOString() ?? null,
        }),
      }),
    ]);
    if (!attention || !handshake) return null;
    const context = compactCortexContext(
      attention,
      handshake,
      new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: input.timeZone,
      }).format(input.now ?? new Date()),
      input.timeZone,
      input.lastInteractionTime
        ? Math.max(
            0,
            Math.floor(
              ((input.now ?? new Date()).getTime() -
                input.lastInteractionTime.getTime()) /
                60_000,
            ),
          )
        : null,
      input.sceneState,
    );
    console.info('[synapse-cortex] context delivered', {
      chatId: input.chatId,
      context,
    });
    return context;
  } catch (error) {
    console.warn('[synapse-cortex] context fetch failed (fail-open)', {
      chatId: input.chatId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

export async function routeWithCortex(query: string) {
  try {
    return await cortexFetch('/v1/cortex/route', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  } catch (error) {
    console.warn('[synapse-cortex] route lookup failed (fail-open)', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}
