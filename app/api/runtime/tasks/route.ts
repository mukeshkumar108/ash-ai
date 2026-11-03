import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  createTask,
  findPendingReminderNear,
  listTasksForUser,
} from '@/lib/tasks/domain';
import { bucketTasks } from '@/lib/tasks/runtime-view';

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
 * READ-ONLY view of the person's canonical Things for the Companion Runtime (the same Task store the Things page uses; nothing is copied or changed).
 * Authenticated with the shared Runtime key the two services already hold.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const userId = params.get('user_id') ?? '';
  if (!UUID.test(userId)) return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
  const tasks = await listTasksForUser(userId, { status: 'pending' });
  const view = bucketTasks(
    tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dueAt: t.dueAt, snoozeCount: t.snoozeCount, source: t.source })),
    new Date(),
    params.get('time_zone') ?? 'Europe/London',
  );
  return NextResponse.json({ ok: true, ...view }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * The companion sets a reminder the person asked for (or that she offered and they took up). One canonical task with one scheduled reminder, through the same
 * domain function the Things page and the post-turn interpreter use, so delivery, undo and the Cortex projection are the existing ones. The response is the receipt
 * she may report from; if a reminder already exists for that moment, that one is returned (`already: true`) and nothing is created twice.
 */
export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    user_id?: string;
    title?: string;
    remind_at?: string;
    time_zone?: string;
    origin_message_id?: string;
  } | null;
  const title = String(body?.title ?? '').trim().slice(0, 200);
  const at = body?.remind_at ? new Date(body.remind_at) : null;
  if (!body?.user_id || !UUID.test(body.user_id) || !title) {
    return NextResponse.json({ ok: false, error: 'invalid_request' }, { status: 400 });
  }
  if (!at || Number.isNaN(at.getTime())) {
    return NextResponse.json({ ok: false, error: 'a time with its offset is needed' }, { status: 400 });
  }
  const now = Date.now();
  if (at.getTime() < now - 60_000) return NextResponse.json({ ok: false, error: 'that time has passed' }, { status: 400 });
  if (at.getTime() > now + 366 * 24 * 3_600_000) return NextResponse.json({ ok: false, error: 'too far ahead' }, { status: 400 });

  const existing = await findPendingReminderNear(body.user_id, at);
  if (existing) {
    return NextResponse.json({ ok: true, already: true, id: existing.id, title: existing.title, remind_at: (existing.reminders[0]?.startAt ?? at).toISOString() });
  }
  try {
    const created = await createTask({
      userId: body.user_id,
      title,
      dueAt: at,
      reminders: [{ startAt: at, endAt: null, label: null }],
      source: 'api',
      originMessageId: body.origin_message_id ?? null,
      originEvidence: 'companion_reminder_tool',
    });
    return NextResponse.json({ ok: true, already: false, id: created.id, title: created.title, remind_at: at.toISOString() });
  } catch {
    return NextResponse.json({ ok: false, error: 'could_not_save' }, { status: 500 });
  }
}
