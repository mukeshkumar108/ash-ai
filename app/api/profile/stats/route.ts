import { auth } from '@/app/(auth)/auth';
import { db, getUserById, withQueryContext } from '@/lib/db/queries';
import { chat, document } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET() {
  return withQueryContext('GET /api/profile/stats', async () => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get basic user info (created date)
    const userProfile = await getUserById(session.user.id);

    if (!userProfile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get chat count
    const [chatStats] = await db
      .select({ count: count(chat.id) })
      .from(chat)
      .where(eq(chat.userId, session.user.id))
      .execute();

    // Get document count
    const [documentStats] = await db
      .select({ count: count(document.id) })
      .from(document)
      .where(eq(document.userId, session.user.id))
      .execute();

    // Get created date (first chat or fallback to account creation)
    const [firstChat] = await db
      .select({ createdAt: chat.createdAt })
      .from(chat)
      .where(eq(chat.userId, session.user.id))
      .orderBy(chat.createdAt)
      .limit(1);

    // Determine the created date (first chat or use current date as fallback)
    const createdAt = firstChat?.createdAt || new Date();

    return NextResponse.json({
      chatCount: chatStats?.count ?? 0,
      documentCount: documentStats?.count ?? 0,
      createdAt: createdAt.toISOString(),
    });
  }).catch((error) => {
    console.error('Failed to get profile stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  });
}
