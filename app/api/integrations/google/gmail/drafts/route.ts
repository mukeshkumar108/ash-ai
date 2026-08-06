import { createGmailDraft } from '@/lib/workspace-connect';
import { parseGmailDraftCreateBody } from '@/lib/integrations/write-schemas';
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

const MAX_WRITE_BYTES = 256 * 1024;

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

  const parsed = parseGmailDraftCreateBody(body.body);

  if (!parsed.ok) {
    return writeValidationError(parsed.code);
  }

  try {
    const draft = await createGmailDraft(userId, parsed.value);
    return writeSuccess(draft);
  } catch (error) {
    return writeFailure(error);
  }
}
