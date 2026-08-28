import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getChatById } from '@/lib/db/queries';
import { createTask, listTasksForUser } from '@/lib/tasks/domain';
import { createTaskSchema } from '@/lib/tasks/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const statusParam = new URL(request.url).searchParams.get('status');
  const status =
    statusParam === 'pending' ||
    statusParam === 'completed' ||
    statusParam === 'cancelled'
      ? statusParam
      : undefined;
  const tasks = await listTasksForUser(session.user.id, { status });
  return NextResponse.json(
    { ok: true, data: tasks },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_request' },
      { status: 400 },
    );
  }
  const parsed = createTaskSchema.safeParse(body);
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
  // If a chat is supplied as origin provenance, verify it belongs to the caller.
  if (parsed.data.chatId) {
    const chat = await getChatById({ id: parsed.data.chatId });
    if (!chat || chat.userId !== session.user.id) {
      return NextResponse.json(
        { ok: false, error: 'invalid_chat' },
        { status: 400 },
      );
    }
  }
  const task = await createTask({
    userId: session.user.id,
    chatId: parsed.data.chatId ?? null,
    title: parsed.data.title,
    notes: parsed.data.notes ?? null,
    dueAt: parsed.data.dueAt ?? null,
    reminders: (parsed.data.reminders ?? []).map((window) => ({
      startAt: window.startAt,
      endAt: window.endAt ?? null,
      label: window.label ?? null,
    })),
    sourceMessageId: parsed.data.sourceMessageId ?? null,
    source: parsed.data.source ?? (parsed.data.chatId ? 'api' : 'manual'),
    materializedCandidateKey: parsed.data.materializedCandidateKey ?? null,
  });
  return NextResponse.json(
    { ok: true, data: task },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}
