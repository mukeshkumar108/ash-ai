import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import {
  createGoogleConnectUrl,
  disconnectGoogle,
  getGoogleConnectionStatus,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';
import { buildIntegrationsStatusResponse } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getGoogleConnectionStatus(session.user.id);

    return NextResponse.json(buildIntegrationsStatusResponse(result), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof WorkspaceConnectError) {
      return NextResponse.json(
        {
          available: false,
          connected: false,
          googleEmail: null,
          gmailAuthorized: false,
          calendarAuthorized: false,
          status: 'unavailable',
          error: error.code,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    console.error('[api/integrations/google] failed to fetch status');
    return NextResponse.json(
      {
        available: false,
        connected: false,
        googleEmail: null,
        gmailAuthorized: false,
        calendarAuthorized: false,
        status: 'unavailable',
        error: 'internal_error',
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const connectUrl = createGoogleConnectUrl(session.user.id);
    return NextResponse.redirect(connectUrl, 303);
  } catch (error) {
    if (error instanceof WorkspaceConnectError) {
      return NextResponse.json(
        { error: 'workspace_connect_unavailable' },
        { status: 502 },
      );
    }

    console.error('[api/integrations/google] failed to start connect');
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await disconnectGoogle(session.user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof WorkspaceConnectError) {
      return NextResponse.json(
        { error: 'workspace_connect_unavailable' },
        { status: 502 },
      );
    }

    console.error('[api/integrations/google] failed to disconnect');
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
