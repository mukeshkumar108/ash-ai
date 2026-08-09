import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { redeemPromoCode } from '@/lib/gems/service';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.code !== 'string' || body.code.length > 100) {
    return NextResponse.json({ error: 'Enter a valid code.' }, { status: 400 });
  }
  const result = await redeemPromoCode(session.user.id, body.code);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
