import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { markCommitmentCandidate } from '@/lib/synapse-cortex';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { key?: unknown };
  try {
    body = (await request.json()) as { key?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_request' },
      { status: 400 },
    );
  }
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key || key.length > 160) {
    return NextResponse.json(
      { ok: false, error: 'invalid_candidate_key' },
      { status: 400 },
    );
  }
  try {
    const marked = await markCommitmentCandidate({
      userId: session.user.id,
      candidateKey: key,
      status: 'dismissed',
    });
    if (!marked) {
      return NextResponse.json(
        { ok: false, error: 'candidate_not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.warn('[candidates] dismissal failed', {
      candidateKey: key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'candidate_dismissal_failed',
      },
      { status: 502 },
    );
  }
}