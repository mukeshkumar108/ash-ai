import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { createTask } from '@/lib/tasks/domain';
import {
  listCommitmentCandidates,
  markCommitmentCandidate,
} from '@/lib/synapse-cortex';

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

  // Owner-scoped resolution from Cortex: only a pending candidate of THIS user
  // can be promoted (dismissed/materialized candidates never list).
  const result = await listCommitmentCandidates({
    userId: session.user.id,
    limit: 50,
  });
  const candidate = result?.candidates.find((entry) => entry.key === key);
  if (!candidate) {
    return NextResponse.json(
      { ok: false, error: 'candidate_not_found' },
      { status: 404 },
    );
  }

  // Deterministic canonical materialization. The materializedCandidateKey
  // (== cortex candidate key) makes retries/promote races idempotent.
  const task = await createTask({
    userId: session.user.id,
    chatId: null,
    title: candidate.title,
    notes: candidate.notes ?? null,
    source: 'sophie_accepted',
    materializedCandidateKey: candidate.key,
  });

  try {
    await markCommitmentCandidate({
      userId: session.user.id,
      candidateKey: candidate.key,
      status: 'materialized',
      sourceObjectId: task.id,
    });
  } catch (error) {
    // The canonical Task exists and is durable; a retry of this promote
    // converges (same candidate key -> same task) and completes the mark.
    console.warn('[candidates] cortex materialization mark failed open', {
      candidateKey: candidate.key,
      taskId: task.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return NextResponse.json(
    { ok: true, data: task },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}