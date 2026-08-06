import { validateOpaqueId } from '@/lib/integrations';
import { parseGmailDraftUpdateBody } from '@/lib/integrations/write-schemas';
import {
  deleteGmailDraft,
  getGmailDraft,
  updateGmailDraft,
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
  { params }: { params: Promise<{ draftId: string }> },
) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const { draftId } = await params;

  if (!validateOpaqueId(draftId)) {
    return writeValidationError('invalid_draft_id');
  }

  try {
    const draft = await getGmailDraft(userId, draftId);
    return writeSuccess(draft);
  } catch (error) {
    return writeFailure(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const { draftId } = await params;

  if (!validateOpaqueId(draftId)) {
    return writeValidationError('invalid_draft_id');
  }

  const body = await readJsonBody(request, MAX_WRITE_BYTES);

  if (!body.ok) {
    return body.error === 'too_large'
      ? writeTooLarge()
      : writeValidationError('invalid_request');
  }

  const parsed = parseGmailDraftUpdateBody(body.body);

  if (!parsed.ok) {
    return writeValidationError(parsed.code);
  }

  try {
    const draft = await updateGmailDraft(userId, draftId, parsed.value);
    return writeSuccess(draft);
  } catch (error) {
    return writeFailure(error);
  }
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const userId = await requireUserId();

  if (!userId) {
    return unauthorizedResponse();
  }

  const { draftId } = await params;

  if (!validateOpaqueId(draftId)) {
    return writeValidationError('invalid_draft_id');
  }

  try {
    await deleteGmailDraft(userId, draftId);
    return writeSuccess({ deleted: true });
  } catch (error) {
    return writeFailure(error);
  }
}
