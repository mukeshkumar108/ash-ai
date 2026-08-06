import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import {
  getRecentGmailMessages,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';
import {
  integrationFailureReason,
  parseGmailMessagesQuery,
} from '@/lib/integrations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const parsed = parseGmailMessagesQuery(
    searchParams.get('limit'),
    searchParams.get('query'),
  );

  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const messages = await getRecentGmailMessages(session.user.id, {
      limit: parsed.limit,
      query: parsed.query ?? undefined,
    });

    return NextResponse.json(
      { ok: true, data: { messages } },
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
      '[api/integrations/google/gmail/messages] failed to fetch messages',
    );
    return NextResponse.json(
      { ok: false, reason: 'unavailable' },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}
