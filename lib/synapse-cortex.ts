import 'server-only';

import { honchoIds } from '@/lib/honcho';

export type CanonicalContinuityContext = {
  now?: { local_time?: string; timezone?: string; daypart?: string };
  brief?: {
    version?: string;
    user_day?: string;
    daypart?: string;
    horizons?: Record<string, unknown[]>;
    task_candidates?: unknown[];
    constraints?: Record<string, unknown>;
  };
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

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Product-view read of the accepted Cortex AttentionState (GET, no writes).
 * This feeds Sophie's own day-brief/Things views only; it is not a
 * conversation path (the chat turn gets Cortex state exclusively through
 * Companion Runtime). Shape mapping follows CORTEX_CUTOVER.md section 11.
 */
export async function fetchCanonicalContinuityContext(input: {
  userId: string;
  chatId: string;
  timeZone: string;
  now?: Date;
}): Promise<CanonicalContinuityContext | null> {
  const config = configuration();
  if (!config.enabled || !config.baseURL) return null;
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
    const state = await cortexFetch(`/v1/cortex/attention-state?${query.toString()}`);
    if (!state) return null;
    const window = (state.window ?? {}) as Record<string, unknown>;
    const scopes = (window.scopes ?? {}) as Record<string, unknown>;
    return {
      now: {
        local_time: String(window.local_time ?? state.timestamp ?? ''),
        timezone: input.timeZone,
        daypart: typeof window.daypart === 'string' ? window.daypart : undefined,
      },
      brief: {
        version: 'attention-state',
        user_day: typeof window.user_day === 'string' ? window.user_day : undefined,
        daypart: typeof window.daypart === 'string' ? window.daypart : undefined,
        horizons: {
          now: asList(scopes.immediate),
          today: asList(scopes.today),
          upcoming: asList(scopes.upcoming),
          unresolved: asList(scopes.unresolved),
          review_needed: asList(scopes.review_needed),
        },
      },
      continuity: asList(state.eligible),
      open_threads: asList(state.open_loops),
      sophie_attention: asList(state.sophie_attention),
      recent_resolutions: asList(state.recent_resolutions),
      avoid_repeating: asList(state.suppressed_targets),
      relevant_honcho_message_ids: asList(state.relevant_honcho_message_ids) as string[],
    };
  } catch (error) {
    console.warn('[synapse-cortex] attention-state read failed (fail-open)', {
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

export type ContinuityInspectorState = {
  generated_at: string;
  counts: Record<string, number>;
  expectations: Array<Record<string, unknown>>;
  open_loops: Array<Record<string, unknown>>;
  recurring_intentions: Array<Record<string, unknown>>;
  recurring_occurrences: Array<Record<string, unknown>>;
  objective_progress: Array<Record<string, unknown>>;
  attention_candidates: Array<Record<string, unknown>>;
  commitment_candidates: Array<Record<string, unknown>>;
};

export async function fetchContinuityInspectorState(input: {
  userId: string;
  limit?: number;
}): Promise<ContinuityInspectorState | null> {
  const configLocal = configuration();
  if (!configLocal.enabled || !configLocal.baseURL) return null;
  const ids = honchoIds(input.userId, '');
  const params = new URLSearchParams({
    workspace_id: ids.workspaceId,
    owner_peer_id: ids.userPeerId,
    limit: String(Math.max(1, Math.min(input.limit ?? 100, 250))),
  });
  try {
    const raw = await cortexFetch(`/v1/debug/owner-state?${params.toString()}`);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as ContinuityInspectorState;
  } catch (error) {
    console.warn('[synapse-cortex] owner-state inspection failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

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

export async function proposeCommitmentCandidates(input: {
  userId: string;
  sourceMessageId: string;
  candidates: Array<{
    key: string;
    title: string;
    notes?: string | null;
    evidenceVerbatim: string;
    authority: 'act' | 'ask';
    temporalPhrase?: string | null;
  }>;
}) {
  const config = configuration();
  if (!config.enabled || !config.baseURL) return null;
  const ids = honchoIds(input.userId, 'continuity-brief');
  return cortexFetch('/v1/cortex/commitment-candidates/propose', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: ids.workspaceId,
      session_id: ids.sessionId,
      owner_peer_id: ids.userPeerId,
      source_message_id: input.sourceMessageId,
      candidates: input.candidates.map((item) => ({
        key: item.key,
        title: item.title,
        notes: item.notes ?? null,
        evidence_verbatim: item.evidenceVerbatim,
        evidence_class: 'implicit_self_commitment',
        authority: item.authority,
        temporal_phrase: item.temporalPhrase ?? null,
      })),
    }),
  });
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


export type ExecutiveSpeakCandidate = {
  userId: string;
  intentId: string;
  title: string;
};

/**
 * Owners for whom Cortex's executive has something it wants to raise (cheap SQL on the Cortex side, no model).
 * The app owns the conversation and the push channel, so its proactive scan treats these as one more candidate
 * source; the initiative gate (quiet hours, budget, cadence) still decides when the Runtime tick runs.
 * Fail-open: any error means "no executive candidates", never a broken scan.
 */
export async function fetchExecutiveSpeakCandidates(): Promise<
  ExecutiveSpeakCandidate[]
> {
  try {
    const ids = honchoIds('scan', 'scan');
    const body = await cortexFetch('/v1/executive/speak-candidates', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: ids.workspaceId }),
    });
    const rows = Array.isArray(body) ? body : [];
    return rows.flatMap((row: any) => {
      const owner = String(row?.owner ?? '');
      if (!owner.startsWith('user_') || !row?.intent_id) return [];
      return [
        {
          userId: owner.slice('user_'.length),
          intentId: String(row.intent_id),
          title: String(row.title ?? ''),
        },
      ];
    });
  } catch (error) {
    console.warn('[relationship] executive candidates unavailable', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}
