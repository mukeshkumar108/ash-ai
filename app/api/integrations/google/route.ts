import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import {
  createGoogleConnectUrl,
  disconnectGoogle,
  getGoogleConnectionStatus,
  turnOffGoogleCapability,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';
import {
  buildIntegrationsStatusResponse,
  FIRST_GOOGLE_CAPABILITY,
  isOfferedGoogleCapability,
} from '@/lib/integrations';

const ASKED_COOKIE = 'google_asked';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getGoogleConnectionStatus(session.user.id);
    const body = buildIntegrationsStatusResponse(result);

    // What the person was just sent to Google for, so a permission they declined there can be said plainly. Read once, then forgotten.
    const asked = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${ASKED_COOKIE}=`))
      ?.slice(ASKED_COOKIE.length + 1);
    const response = NextResponse.json(
      asked
        ? {
            ...body,
            declined: decodeURIComponent(asked)
              .split(',')
              .filter(
                (id) =>
                  isOfferedGoogleCapability(id) &&
                  !body.capabilities.find((c) => c.id === id)?.enabled,
              ),
          }
        : body,
      { headers: NO_STORE_HEADERS },
    );
    if (asked) response.cookies.delete(ASKED_COOKIE);
    return response;
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

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Only the capabilities the person chose, and only ones this product offers; Calendar when nothing was named (the lightest first connection).
    const form = await request.formData().catch(() => null);
    const chosen = (form?.getAll('capabilities') ?? [])
      .map(String)
      .filter(isOfferedGoogleCapability);
    const capabilities = chosen.length ? chosen : [FIRST_GOOGLE_CAPABILITY];
    const connectUrl = createGoogleConnectUrl(session.user.id, capabilities);
    const response = NextResponse.redirect(connectUrl, 303);
    response.cookies.set(ASKED_COOKIE, capabilities.join(','), {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 900,
      path: '/api/integrations/google',
    });
    return response;
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

export async function DELETE(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ?capability=x turns one thing off and leaves the rest; with none named, Google is disconnected entirely.
    const capability = new URL(request.url).searchParams.get('capability');
    if (capability) {
      if (!isOfferedGoogleCapability(capability)) {
        return NextResponse.json({ error: 'unknown_capability' }, { status: 400 });
      }
      await turnOffGoogleCapability(session.user.id, capability);
      return NextResponse.json({ success: true });
    }
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
