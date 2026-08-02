import { auth } from '@/app/(auth)/auth';
import { db, getUserById, withQueryContext } from '@/lib/db/queries';
import { user } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET() {
  return withQueryContext('GET /api/profile', async () => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userProfile = await getUserById(session.user.id);

    if (!userProfile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    return NextResponse.json(userProfile);
  }).catch((error) => {
    console.error('Failed to get profile:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  });
}

export async function PUT(request: NextRequest) {
  return withQueryContext('PUT /api/profile', async () => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { displayName, themePreference } = body;

    // Validate input
    if (typeof displayName !== 'string' || displayName.length > 100) {
      return NextResponse.json(
        { error: 'Invalid display name' },
        { status: 400 },
      );
    }

    const updates: Record<string, string | null> = {
      displayName: displayName.trim() || null,
    };

    if (themePreference != null) {
      if (!['light', 'dark', 'system'].includes(themePreference)) {
        return NextResponse.json(
          { error: 'Invalid theme preference' },
          { status: 400 },
        );
      }
      updates.themePreference = themePreference;
    }

    try {
      await db.update(user).set(updates).where(eq(user.id, session.user.id));
    } catch (error) {
      await db
        .update(user)
        .set({ displayName: updates.displayName })
        .where(eq(user.id, session.user.id));
    }

    return NextResponse.json({ success: true });
  }).catch((error) => {
    console.error('Failed to update profile:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.startsWith('Invalid ')
            ? error.message
            : 'Internal server error',
      },
      {
        status:
          error instanceof Error && error.message.startsWith('Invalid ')
            ? 400
            : 500,
      },
    );
  });
}
