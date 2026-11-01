import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { completeTask, snoozeTask } from '@/lib/tasks/domain';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorised(request: Request): boolean {
  const expected = process.env.COMPANION_RUNTIME_SECRET?.trim();
  const given = request.headers.get('x-companion-runtime-key')?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The companion acts on the person's OWN canonical task, only on their explicit say-so: mark it done, or move it. Same domain functions the Things page uses (one store, one set
 * of rules). Deleting is not offered here: that stays with the person, or with the executive's confirmation path. The response is the receipt the companion may report from.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { user_id?: string; action?: string; until?: string; time_zone?: string } | null;
  if (!UUID.test(id) || !body?.user_id || !UUID.test(body.user_id)) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }
  const provenance = { evidenceClass: 'companion_on_explicit_request' };
  if (body.action === 'complete') {
    const out = await completeTask(body.user_id, id, { timeZone: body.time_zone ?? null, provenance });
    if (!out.ok) return NextResponse.json({ ok: false, error: out.reason ?? 'failed' }, { status: out.reason === 'not_found' ? 404 : 409 });
    return NextResponse.json({ ok: true, id, status: out.task?.status ?? 'completed', title: out.task?.title ?? null });
  }
  if (body.action === 'snooze') {
    const until = body.until ? new Date(body.until) : null;
    if (!until || Number.isNaN(until.getTime()) || until.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ ok: false, error: 'a future time is needed' }, { status: 400 });
    }
    const out = await snoozeTask(body.user_id, id, { until, timeZone: body.time_zone ?? null, provenance });
    if (!out.ok) return NextResponse.json({ ok: false, error: out.reason ?? 'failed' }, { status: out.reason === 'not_found' ? 404 : 409 });
    return NextResponse.json({ ok: true, id, status: out.task?.status ?? 'pending', title: out.task?.title ?? null, due_at: out.task?.dueAt ? new Date(out.task.dueAt).toISOString() : null });
  }
  return NextResponse.json({ ok: false, error: 'unsupported_action' }, { status: 400 });
}
