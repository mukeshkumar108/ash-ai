import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { enableGemDevMode, getGemStatus } from '@/lib/gems/service';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.email)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.code !== 'string')
    return NextResponse.json(
      { error: 'Enter the developer code.' },
      { status: 400 },
    );
  const enabled = await enableGemDevMode(
    session.user.id,
    session.user.email,
    body.code,
  );
  if (!enabled)
    return NextResponse.json(
      { error: 'That developer code is not valid for this account.' },
      { status: 403 },
    );
  return NextResponse.json(await getGemStatus(session.user.id, false));
}
