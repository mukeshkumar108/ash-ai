import { list } from '@vercel/blob';
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
      parentImageId: row.parentImageId,
      createdAt: row.createdAt.toISOString(),
    }));

    // Orphaned blobs (generated before metadata persisted, or not yet saved)
    // are returned separately so older images stay visible.
    const ownedPathnames = new Set(
      generations.flatMap((gen) => gen.images.map((img) => img.pathname)),
    );

    const { blobs } = await list({
      prefix: 'image-gen/',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      limit: 500,
    });

    const orphans = blobs
      .filter((blob) => !ownedPathnames.has(blob.pathname))
      .map((blob) => ({
        pathname: blob.pathname,
        url: blob.url,
        uploadedAt: blob.uploadedAt.toISOString(),
      }));

    return NextResponse.json({ generations, orphans });
  } catch (error) {
    console.error('[image-list] failed', error);
    return NextResponse.json({ error: 'Failed to list images' }, { status: 500 });
  }
}
