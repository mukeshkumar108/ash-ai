import { timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

import { listTasksForUser } from '@/lib/tasks/domain';
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
