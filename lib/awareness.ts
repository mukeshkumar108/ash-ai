import 'server-only';

export type BriefingItem = { text: string; source: string; at: string; ref: string; via?: string };
export type BriefingSection = { id: string; title: string; items: BriefingItem[] };
export type BriefingSource = { id: string; label: string; used: boolean };
export type BriefingResult = {
  id: string;
  brief: {
    generated_at: string;
    time_zone: string;
    sections: BriefingSection[];
    freshness: Record<string, string>;
    unavailable: string[];
  };
  sources: BriefingSource[];
  remember_from_mail: boolean;
  place?: string;
  morning?: boolean;
  updated_at?: string;
  slot?: string;
};

function runtime() {
  const baseUrl = process.env.COMPANION_RUNTIME_URL?.trim().replace(/\/$/u, '');
  const secret = process.env.COMPANION_RUNTIME_SECRET?.trim();
  if (!baseUrl || !secret) throw new Error('COMPANION_RUNTIME_URL and COMPANION_RUNTIME_SECRET are required');
  return { baseUrl, secret };
}

async function call(path: string, init: RequestInit = {}, timeoutMs = 45_000) {
  const { baseUrl, secret } = runtime();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Companion-Runtime-Key': secret, ...init.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw Object.assign(new Error(`Runtime HTTP ${response.status}`), { status: response.status });
  return response.json();
}

/** The person's daily briefing, prepared by the Companion Runtime (the same preparation Sophie's tool uses). */
export async function fetchBriefing(userId: string, timeZone: string, fresh = false): Promise<BriefingResult> {
  const q = new URLSearchParams({ companion_id: 'sophie', time_zone: timeZone, ...(fresh ? { fresh: 'true' } : {}) });
  return call(`/v1/users/${encodeURIComponent(userId)}/awareness/briefing?${q}`);
}

export async function changeBriefingSettings(
  userId: string,
  change: { source?: string; use?: boolean; remember_from_mail?: boolean; place?: string; morning?: boolean },
) {
  return call(`/v1/users/${encodeURIComponent(userId)}/awareness/settings`, {
    method: 'POST',
    body: JSON.stringify({ companion_id: 'sophie', ...change }),
  });
}
