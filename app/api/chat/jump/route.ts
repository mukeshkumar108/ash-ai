import { auth } from '@/app/(auth)/auth';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const characterId = searchParams.get('characterId');

  if (!characterId) {
    redirect('/');
  }

  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  // Always start a fresh chat for this character so fantasies stay isolated
  // to the current thread instead of reviving the previous one.
  redirect(`/?characterId=${characterId}`);
}
