import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getGmailThread, WorkspaceConnectError } from '@/lib/workspace-connect';
import { integrationFailureReason, validateThreadId } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export async function GET(
  _: Request,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { threadId } = await params;
  const validatedThreadId = validateThreadId(threadId);

  if (!validatedThreadId) {
    return NextResponse.json(
      { error: 'invalid_thread_id' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const thread = await getGmailThread(session.user.id, validatedThreadId);

    return NextResponse.json(
      { ok: true, data: { thread } },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof WorkspaceConnectError) {
      return NextResponse.json(
        { ok: false, reason: integrationFailureReason(error.code) },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    console.error(
      '[api/integrations/google/gmail/threads] failed to fetch thread',
    );
    return NextResponse.json(
      { ok: false, reason: 'unavailable' },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}
