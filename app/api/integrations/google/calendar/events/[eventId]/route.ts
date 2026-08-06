import { validateOpaqueId } from '@/lib/integrations';
import { parseCalendarEventUpdateBody } from '@/lib/integrations/write-schemas';
import {
  deleteCalendarEvent,
  getCalendarEvent,
  updateCalendarEvent,
} from '@/lib/workspace-connect';
import {
  readJsonBody,
  requireUserId,
  unauthorizedResponse,
  writeFailure,
  writeSuccess,
  writeTooLarge,
  writeValidationError,
} from '../../../_write';

export const dynamic = 'force-dynamic';

const MAX_WRITE_BYTES = 256 * 1024;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const { eventId } = await params;

  if (!validateOpaqueId(eventId)) {
    return writeValidationError('invalid_event_id');
  }

  try {
    const event = await getCalendarEvent(userId, eventId);
    return writeSuccess(event);
  } catch (error) {
    return writeFailure(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const { eventId } = await params;

  if (!validateOpaqueId(eventId)) {
    return writeValidationError('invalid_event_id');
  }

  const body = await readJsonBody(request, MAX_WRITE_BYTES);

  if (!body.ok) {
    return body.error === 'too_large'
      ? writeTooLarge()
      : writeValidationError('invalid_request');
  }

  const parsed = parseCalendarEventUpdateBody(body.body);

  if (!parsed.ok) {
    return writeValidationError(parsed.code);
  }

  try {
    const event = await updateCalendarEvent(userId, eventId, parsed.value);
    return writeSuccess(event);
  } catch (error) {
    return writeFailure(error);
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const { eventId } = await params;

  if (!validateOpaqueId(eventId)) {
    return writeValidationError('invalid_event_id');
  }

  try {
    await deleteCalendarEvent(userId, eventId);
    return writeSuccess({ deleted: true });
  } catch (error) {
    return writeFailure(error);
  }
}
