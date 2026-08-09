import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { GEM_BUNDLES } from '@/lib/gems/catalog';
import { getGemStatus } from '@/lib/gems/service';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const status = await getGemStatus(session.user.id, true);
  return NextResponse.json({
    ...status,
    bundles: GEM_BUNDLES,
    devModeAvailable: Boolean(process.env.GEMS_DEV_CODE),
  });
}
