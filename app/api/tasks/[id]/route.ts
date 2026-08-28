import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getUserById } from '@/lib/db/queries';
import {
  cancelTask,
  completeTask,
  editTask,
  getTaskWithReminders,
  rescheduleTask,
  snoozeTask,
} from '@/lib/tasks/domain';
import { mutateTaskSchema } from '@/lib/tasks/schemas';

export const dynamic = 'force-dynamic';

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const task = await getTaskWithReminders(session.user.id, id);
  if (!task) {
    return NextResponse.json(
      { ok: false, error: 'not_found' },
      { status: 404 },
    );
  }
  return NextResponse.json(
    { ok: true, data: task },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const userId = session.user.id;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_request' },
      { status: 400 },
    );
  }
  const parsed = mutateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_request',
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }
  const timeZone = (await getUserById(session.user.id))?.timeZone ?? null;
  const input = parsed.data;
  const outcome = await (async () => {
    switch (input.action) {
      case 'complete':
        return completeTask(userId, id, { timeZone });
      case 'cancel':
        return cancelTask(userId, id, { timeZone });
      case 'edit':
        return editTask(userId, id, {
          title: input.title,
          notes: input.notes,
          timeZone,
        });
      case 'snooze':
        return snoozeTask(userId, id, {
          offsetMinutes: input.offsetMinutes,
          until: input.until,
          timeZone,
        });
      case 'reschedule':
        return rescheduleTask(userId, id, {
          dueAt: input.dueAt ?? null,
          reminders: (input.reminders ?? []).map((window) => ({
            startAt: window.startAt,
            endAt: window.endAt ?? null,
            label: window.label ?? null,
          })),
          timeZone,
        });
    }
  })();
  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, error: outcome.reason },
      { status: outcome.reason === 'not_found' ? 404 : 409 },
    );
  }
  return NextResponse.json(
    { ok: true, data: outcome.task },
    { headers: { 'cache-control': 'no-store' } },
  );
}
