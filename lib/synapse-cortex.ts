import 'server-only';

import { honchoIds } from '@/lib/honcho';
import type { SceneState } from '@/lib/agent/scene-state';
import type { UserChronology } from '@/lib/agent/chronology';

export type CortexContext = {
  localDateTime: string;
  timeZone: string;
  interactionGapMinutes: number | null;
  currentScene: SceneState;
  orientation: unknown;
  daypart: unknown;
  sitting: unknown;
  firstContactToday: boolean;
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
  sophie_attention?: unknown[];
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
          now: {
            local_time: localDateTime,
            timeZone,
            daypart: handshake.daypart,
          },
          continuity: list(attention.followups, 3),
          open_threads: list(attention.open_loops, 3),
          sophie_attention: list(attention.sophie_attention, 5),
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
    // Demoted from authoritative gap classification: chronology authority
    // lives in lib/agent/chronology.ts (30-min TemporalSession + 05:00
    // UserDay, derived from canonical user-role message timestamps). These
    // fields echo what the app decided; Cortex consumes them, it never
    // re-derives them.
    orientation: handshake.orientation ?? null,
    daypart: handshake.daypart ?? null,
    sitting: handshake.sitting ?? null,
    firstContactToday: handshake.first_contact_today === true,
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
    // Owner scope: source-linked attention (task/calendar follow-ups) remains
    // visible across the owner's chats.
    peer_id: ids.userPeerId,
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
    enabled: Boolean(baseURL) && process.env.SYNAPSE_CORTEX_ENABLED !== 'false',
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

export async function persistSophieAttention(input: {
  userId: string;
  chatId: string;
  sourceMessageId: string;
  sourceAssistantMessageId: string;
  candidates: Array<{
    key: string;
    kind:
      | 'pending_question'
      | 'unfinished_thought'
      | 'callback'
      | 'promise'
      | 'reentry';
    content: string;
    salience: number;
    confidence: number;
    notBeforeMinutes: number | null;
    expiresAfterHours: number;
  }>;
  now?: Date;
}) {
  if (input.candidates.length === 0) return { persisted: false as const };
  const ids = honchoIds(input.userId, input.chatId);
  const now = input.now ?? new Date();
  try {
    const result = await cortexFetch('/v1/events/attention', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ids.workspaceId,
        session_id: ids.sessionId,
        source_message_id: input.sourceMessageId,
        source_assistant_message_id: input.sourceAssistantMessageId,
        candidates: input.candidates.map((candidate) => ({
          key: candidate.key,
          kind: candidate.kind,
          content: candidate.content,
          salience: candidate.salience,
          confidence: candidate.confidence,
          not_before:
            candidate.notBeforeMinutes === null
              ? null
              : new Date(
                  now.getTime() + candidate.notBeforeMinutes * 60_000,
                ).toISOString(),
          expires_at: new Date(
            now.getTime() + candidate.expiresAfterHours * 3_600_000,
          ).toISOString(),
        })),
      }),
    });
    return { persisted: true as const, result };
  } catch (error) {
    console.warn('[synapse-cortex] Sophie attention persistence failed open', {
      chatId: input.chatId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { persisted: false as const };
  }
}

/**
 * Deterministic object-state projection into Cortex lifecycle state.
 *
 * Canonical tasks (app Postgres) and Google Calendar events are referenced by
 * stable source system + object id + integer version — never embedded as
 * duplicate provider objects. Cortex derives lifecycle/attention state only.
 * Fire-and-forget by design: callers mark canonical rows dirty and a cron
 * sweep re-pushes on failure, so a dropped call never loses state.
 */
export async function postObjectState(
  input: {
    userId: string;
    chatId: string;
    now?: Date;
    timeZone?: string;
    source: {
      system: 'app_task' | 'google_calendar';
      objectId: string;
      version: number;
      kind: 'task' | 'calendar_event';
    };
    action: 'created' | 'updated' | 'completed' | 'cancelled';
    title: string;
    notes?: string | null;
    dueAt?: Date | null;
    eventStart?: Date | null;
    eventEnd?: Date | null;
    reminderWindows?: Array<{
      start: Date;
      end?: Date | null;
      label?: string | null;
    }>;
    followupWindowHours?: number | null;
    // Real-time provenance: originating app/honcho user message id — lets the
    // watcher canonicalize (supersede) its own same-message duplicates.
    origin?: { messageId: string; evidenceSpan?: string | null } | null;
    // Promotion: derived Cortex objects absorbed into this canonical object.
    absorbs?: Array<{ kind: 'expectation' | 'open_loop'; id: string }> | null;
  },
  opts: { post?: typeof fetch; timeoutMs?: number } = {},
): Promise<{
  pushed: boolean;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const config = configuration();
  if (!config.enabled || !config.baseURL) {
    return { pushed: false, error: 'cortex_disabled' };
  }
  const ids = honchoIds(input.userId, input.chatId);
  const now = (input.now ?? new Date()).toISOString();
  const body = {
    workspace_id: ids.workspaceId,
    session_id: ids.sessionId,
    peer_id: ids.userPeerId,
    owner_peer_id: ids.userPeerId,
    now,
    timezone:
      input.timeZone?.trim() ||
      process.env.ASH_TIME_ZONE?.trim() ||
      'Europe/London',
    source: {
      system: input.source.system,
      object_id: input.source.objectId,
      version: input.source.version,
      kind: input.source.kind,
    },
    action: input.action,
    title: input.title,
    notes: input.notes ?? null,
    due_at: input.dueAt ? input.dueAt.toISOString() : null,
    event_start: input.eventStart ? input.eventStart.toISOString() : null,
    event_end: input.eventEnd ? input.eventEnd.toISOString() : null,
    reminder_windows: (input.reminderWindows ?? []).map((window) => ({
      start: window.start.toISOString(),
      end: window.end ? window.end.toISOString() : null,
      label: window.label ?? null,
    })),
    followup_window_hours: input.followupWindowHours ?? null,
    origin: input.origin
      ? {
          message_id: input.origin.messageId,
          evidence_span: input.origin.evidenceSpan ?? null,
        }
      : null,
    absorbs: (input.absorbs ?? []).map((ref) => ({
      kind: ref.kind,
      id: ref.id,
    })),
  };
  const post = opts.post ?? fetch;
  try {
    const response = await post(`${config.baseURL}/v1/events/object`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? config.timeoutMs),
      cache: 'no-store',
    });
    if (!response.ok) {
      return { pushed: false, error: `cortex_http_${response.status}` };
    }
    const result = (await response.json()) as Record<string, unknown>;
    return { pushed: true, result };
  } catch (error) {
    return {
      pushed: false,
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}

export async function fetchCortexContext(input: {
  userId: string;
  chatId: string;
  timeZone: string;
  now?: Date;
  lastInteractionTime?: Date | null;
  sceneState?: SceneState;
  chronology?: UserChronology;
}): Promise<CortexContext | null> {
  const config = configuration();
  if (!config.contextEnabled) return null;
  const ids = honchoIds(input.userId, input.chatId);
  const now = (input.now ?? new Date()).toISOString();
  try {
    const attentionQuery = new URLSearchParams({
      workspace_id: ids.workspaceId,
      session_id: ids.sessionId,
      peer_id: ids.userPeerId,
      now,
      timezone: input.timeZone,
    });
    // Canonical chronology: the app decides whether this is a new sitting.
    // Cortex consumes the fact; it never infers new-vs-ongoing from timestamps.
    const chronology = input.chronology;
    const handshakeChronology = chronology
      ? {
          temporalSession: chronology.newTemporalSession ? 'new' : 'same',
          firstContactUserDay: chronology.isFirstContactUserDay,
          gapMinutes: chronology.inactivityGapMinutes ?? null,
        }
      : undefined;
    const [attention, handshake] = await Promise.all([
      cortexFetch(`/v1/cortex/attention-packet?${attentionQuery.toString()}`),
      cortexFetch('/v1/cortex/handshake', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: ids.workspaceId,
          session_id: ids.sessionId,
          peer_id: ids.userPeerId,
          now,
          timezone: input.timeZone,
          last_interaction_time:
            input.lastInteractionTime?.toISOString() ?? null,
          ...(handshakeChronology ? { chronology: handshakeChronology } : {}),
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

// ── Commitment candidates ("Sophie noticed") ──────────────────────────────
// Cortex owns the uncertain/implicit commitment intelligence; the app only
// exposes its pending candidates and turns a promoted candidate into a
// canonical Task through the deterministic domain (never a second detector).

export type CommitmentCandidate = {
  key: string;
  canonicalKey: string | null;
  title: string;
  notes: string | null;
  evidenceVerbatim: string | null;
  evidenceClass: string | null;
  authority: 'act' | 'ask';
  sourceMessageId: string | null;
  createdAt: string;
};

function mapCommitmentCandidate(
  row: Record<string, unknown>,
): CommitmentCandidate | null {
  const key = typeof row.candidate_key === 'string' ? row.candidate_key : '';
  const title = typeof row.title === 'string' ? row.title : '';
  if (!key || !title) return null;
  return {
    key,
    canonicalKey:
      typeof row.canonical_key === 'string' ? row.canonical_key : null,
    title,
    notes: typeof row.notes === 'string' ? row.notes : null,
    evidenceVerbatim:
      typeof row.evidence_verbatim === 'string' ? row.evidence_verbatim : null,
    evidenceClass:
      typeof row.evidence_class === 'string' ? row.evidence_class : null,
    authority: row.authority === 'ask' ? 'ask' : 'act',
    sourceMessageId:
      typeof row.source_message_id === 'string' ? row.source_message_id : null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : new Date().toISOString(),
  };
}

export async function listCommitmentCandidates(input: {
  userId: string;
  limit?: number;
}): Promise<{ available: boolean; candidates: CommitmentCandidate[] } | null> {
  const configurationLocal = configuration();
  if (!configurationLocal.enabled || !configurationLocal.baseURL) return null;
  const ids = honchoIds(input.userId, '');
  const params = new URLSearchParams({
    workspace_id: ids.workspaceId,
    owner_peer_id: ids.userPeerId,
    limit: String(Math.max(1, Math.min(input.limit ?? 20, 50))),
  });
  try {
    const raw = await cortexFetch(
      `/v1/cortex/commitment-candidates?${params.toString()}`,
    );
    if (!raw) return null;
    const rows =
      (raw as { candidates?: Array<Record<string, unknown>> }).candidates ?? [];
    const candidates = rows
      .map(mapCommitmentCandidate)
      .filter(
        (candidate): candidate is CommitmentCandidate => candidate !== null,
      )
      .slice(0, 50);
    return { available: true, candidates };
  } catch (error) {
    console.warn(
      '[synapse-cortex] commitment candidates list failed (fail-open)',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    );
    return null;
  }
}

export async function markCommitmentCandidate(input: {
  userId: string;
  candidateKey: string;
  status: 'materialized' | 'dismissed';
  sourceObjectId?: string | null;
}): Promise<Record<string, unknown> | null> {
  const configLocal = configuration();
  if (!configLocal.enabled || !configLocal.baseURL) {
    throw new Error('cortex_disabled');
  }
  const ids = honchoIds(input.userId, '');
  return cortexFetch('/v1/cortex/commitment-candidates/mark', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ids.workspaceId,
      owner_peer_id: ids.userPeerId,
      candidate_key: input.candidateKey,
      status: input.status,
      source_object_id: input.sourceObjectId ?? null,
    }),
  });
}
