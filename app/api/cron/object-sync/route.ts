import { NextResponse } from 'next/server';

import { getUserSyncAnchors, syncAllCalendars } from '@/lib/calendar/sync';
import { sweepDirtyTaskProjections } from '@/lib/tasks/domain';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Syncs canonical objects into Cortex lifecycle state:
 * 1. dirty task projections (task create/update/complete/cancel pushes that
 *    failed their direct delivery)
 * 2. calendar reconciliation through the Workspace Connect boundary:
 *    discover/derive new events, update reschedules, invalidate cancellations,
 *    and mark bounded post-event follow-up windows.
 *
 * This is state projection only — no messages are sent here. Proactive
 * outreach remains the exclusive decision of the relationship initiative cron.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const provided = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/iu, '');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.SYNAPSE_CORTEX_ENABLED === 'false') {
    return NextResponse.json({ ok: true, skipped: 'cortex_disabled' });
  }
  const taskSweep = await sweepDirtyTaskProjections({ limit: 25 }).catch(
    (error) => {
      console.warn('[object-sync] task sweep failed open', error);
      return { processed: 0, pushed: 0 };
    },
  );
  const anchors = await getUserSyncAnchors().catch((error) => {
    console.warn('[object-sync] anchor resolution failed open', error);
    return [];
  });
  const calendar = await syncAllCalendars(anchors).catch((error) => {
    console.warn('[object-sync] calendar sync failed open', error);
    return [];
  });
  return NextResponse.json(
    { ok: true, taskSweep, calendar },
    { headers: { 'cache-control': 'no-store' } },
  );
}
