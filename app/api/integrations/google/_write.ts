import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import {
  integrationFailureReason,
  type IntegrationFailureReason,
} from '@/lib/integrations';
import { WorkspaceConnectError } from '@/lib/workspace-connect';

export const NO_STORE_HEADERS = { 'cache-control': 'no-store' };

export type JsonBodyRead =
  | { ok: true; body: unknown }
  | { ok: false; error: 'too_large' | 'invalid_json' };

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBodyRead> {
  const text = await request.text();

  if (text.length > maxBytes) {
    return { ok: false, error: 'too_large' };
  }

  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}

export async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function writeSuccess<T>(data: T) {
  return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
}

export function writeValidationError(code: string) {
  return NextResponse.json(
    { ok: false, error: code },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

export function writeTooLarge() {
  return NextResponse.json(
    { ok: false, error: 'invalid_request' },
    { status: 413, headers: NO_STORE_HEADERS },
  );
}

function reasonStatus(reason: IntegrationFailureReason): number {
  if (reason === 'conflict') {
    return 409;
  }

  if (reason === 'invalid') {
    return 400;
  }

  return 200;
}

export function writeFailure(error: unknown) {
  if (error instanceof WorkspaceConnectError) {
    const reason = integrationFailureReason(error.code);

    return NextResponse.json(
      { ok: false, reason },
      { status: reasonStatus(reason), headers: NO_STORE_HEADERS },
    );
  }

  console.error('[api/integrations/google] write failed', error);
  return NextResponse.json(
    { ok: false, reason: 'unavailable' },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
