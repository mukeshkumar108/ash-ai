import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { videoModels } from '@/lib/ai/video-models';
import { getVideoGenerationsByUserId } from '@/lib/db/queries';

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await getVideoGenerationsByUserId(
      session.user.id,
      videoModels.map((model) => model.id),
    );

    const videos = rows.map((row) => ({
      id: row.id,
      modelId: row.modelId,
      prompt: row.prompt,
      videos: row.images as Array<{
        url: string;
        pathname: string;
        mediaType: string;
      }>,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json({ videos });
  } catch (error) {
    console.error('[video-list] failed', error);
    return NextResponse.json(
      { error: 'Failed to list videos' },
      { status: 500 },
    );
  }
}
