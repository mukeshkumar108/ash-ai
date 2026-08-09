import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getGenerationsByUserId } from '@/lib/db/queries';

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await getGenerationsByUserId(session.user.id);

    const generations = rows.map((row) => ({
      id: row.id,
      modelId: row.modelId,
      prompt: row.prompt,
      images: row.images as Array<{
        url: string;
        pathname: string;
        mediaType: string;
      }>,
      generationIndex: row.generationIndex,
      parentGenerationId: row.parentGenerationId,
      parentOutputPathname: row.parentOutputPathname,
      instruction: row.instruction,
      inputImages: row.inputImages as Array<{
        pathname: string;
        mediaType: string;
        role: string;
      }> | null,
      remixState: row.remixState as {
        originalIntent: string;
        locked: string[];
        preserve: string[];
        established: string[];
        removed: string[];
      } | null,
      createdAt: row.createdAt.toISOString(),
    }));

    // Blob storage is shared by the deployment and does not carry trustworthy
    // ownership metadata. Only return database rows explicitly owned by the
    // authenticated user; globally listing "orphaned" blobs leaks images
    // across accounts.
    return NextResponse.json({ generations, orphans: [] });
  } catch (error) {
    console.error('[image-list] failed', error);
    return NextResponse.json(
      { error: 'Failed to list images' },
      { status: 500 },
    );
  }
}
