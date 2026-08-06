import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import {
  createCalendarEvent,
  getUpcomingCalendarEvents,
  WorkspaceConnectError,
} from '@/lib/workspace-connect';
import { integrationFailureReason } from '@/lib/integrations';
import { parseCalendarEventCreateBody } from '@/lib/integrations/write-schemas';
import {
  readJsonBody,
  requireUserId,
  unauthorizedResponse,
  writeFailure,
  writeSuccess,
  writeTooLarge,
  writeValidationError,
} from '../../_write';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = { 'cache-control': 'no-store' };
const MAX_WRITE_BYTES = 256 * 1024;

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await getUpcomingCalendarEvents(session.user.id);

    return NextResponse.json(
      { ok: true, data: result },
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
      '[api/integrations/google/calendar/events] failed to fetch events',
    );
    return NextResponse.json(
      { ok: false, reason: 'unavailable' },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const body = await readJsonBody(request, MAX_WRITE_BYTES);

  if (!body.ok) {
    return body.error === 'too_large'
      ? writeTooLarge()
      : writeValidationError('invalid_request');
  }

  const parsed = parseCalendarEventCreateBody(body.body);

  if (!parsed.ok) {
    return writeValidationError(parsed.code);
  }

  try {
    const event = await createCalendarEvent(
      userId,
      parsed.value.input,
      parsed.value.operationId,
    );
    return writeSuccess(event);
  } catch (error) {
    return writeFailure(error);
  }
}
