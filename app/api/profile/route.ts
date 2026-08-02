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
    const {
      displayName,
      rpDisplayName,
      rpAge,
      rpLocation,
      rpOccupation,
      rpVibe,
      themePreference,
    } = body;

    // Validate input
    if (typeof displayName !== 'string' || displayName.length > 100) {
      return NextResponse.json(
        { error: 'Invalid display name' },
        { status: 400 },
      );
    }

    if (!['light', 'dark', 'system'].includes(themePreference)) {
      return NextResponse.json(
        { error: 'Invalid theme preference' },
        { status: 400 },
      );
    }

    const normalizeOptionalString = (
      value: unknown,
      maxLength: number,
      field: string,
    ) => {
      if (value == null) {
        return null;
      }

      if (typeof value !== 'string' || value.length > maxLength) {
        throw new Error(`Invalid ${field}`);
      }

      const trimmed = value.trim();
      return trimmed || null;
    };

    const normalizedDisplayName = displayName.trim() || null;
    const normalizedRpDisplayName = normalizeOptionalString(
      rpDisplayName,
      100,
      'roleplay display name',
    );
    const normalizedRpAge = normalizeOptionalString(rpAge, 32, 'roleplay age');
    const normalizedRpLocation = normalizeOptionalString(
      rpLocation,
      120,
      'roleplay location',
    );
    const normalizedRpOccupation = normalizeOptionalString(
      rpOccupation,
      120,
      'roleplay occupation',
    );
    const normalizedRpVibe = normalizeOptionalString(
      rpVibe,
      160,
      'roleplay vibe',
    );

    try {
      await db
        .update(user)
        .set({
          displayName: normalizedDisplayName,
          rpDisplayName: normalizedRpDisplayName,
          rpAge: normalizedRpAge,
          rpLocation: normalizedRpLocation,
          rpOccupation: normalizedRpOccupation,
          rpVibe: normalizedRpVibe,
          themePreference,
        })
        .where(eq(user.id, session.user.id));
    } catch (error) {
      await db
        .update(user)
        .set({
          displayName: normalizedDisplayName,
          themePreference,
        })
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
