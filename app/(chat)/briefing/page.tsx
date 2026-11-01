import { redirect } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';
import { BriefingScreen } from '@/components/briefing/briefing-screen';
import { fetchBriefing, type BriefingResult } from '@/lib/awareness';

export const dynamic = 'force-dynamic';

export default async function BriefingPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const { fresh } = await searchParams;
  const timeZone = process.env.ASH_TIME_ZONE?.trim() || 'Europe/London';
  let briefing: BriefingResult | null = null;
  try {
    briefing = await fetchBriefing(session.user.id, timeZone, fresh === '1');
  } catch {
    briefing = null;
  }
  return <BriefingScreen briefing={briefing} />;
}
