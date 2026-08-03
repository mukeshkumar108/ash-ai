import { list } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { blobs } = await list({
      prefix: 'image-gen/',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      limit: 500,
    });

    return NextResponse.json({
      blobs: blobs.map((blob) => ({
        pathname: blob.pathname,
        url: blob.url,
        uploadedAt: blob.uploadedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('[image-list] failed', error);
    return NextResponse.json({ error: 'Failed to list images' }, { status: 500 });
  }
}
