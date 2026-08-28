import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { listCommitmentCandidates } from '@/lib/synapse-cortex';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await listCommitmentCandidates({
      userId: session.user.id,
      limit: 20,
    });
    if (!result) {
      return NextResponse.json(
        { ok: true, available: false, data: [] },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { ok: true, available: result.available, data: result.candidates },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        available: false,
        error:
          error instanceof Error ? error.message : 'candidates_unavailable',
      },
      { status: 502 },
    );
  }
}