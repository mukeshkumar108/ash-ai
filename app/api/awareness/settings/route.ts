import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { changeBriefingSettings } from '@/lib/awareness';

export const dynamic = 'force-dynamic';

const SOURCES = new Set(['mail', 'calendar', 'things', 'memory', 'weather']);

/** What the briefing may use. Stopping a source takes effect at once; for email it also sets aside what email had reported. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { source?: string; use?: boolean; remember_from_mail?: boolean };
  const change: { source?: string; use?: boolean; remember_from_mail?: boolean } = {};
  if (typeof body.source === 'string' && SOURCES.has(body.source) && typeof body.use === 'boolean') {
    change.source = body.source;
    change.use = body.use;
  }
  if (typeof body.remember_from_mail === 'boolean') change.remember_from_mail = body.remember_from_mail;
  if (!Object.keys(change).length) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  try {
    return NextResponse.json(await changeBriefingSettings(session.user.id, change));
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  }
}
