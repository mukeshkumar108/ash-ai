import { get } from '@vercel/blob';
import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pathname = searchParams.get('pathname');

  if (!pathname) {
    return NextResponse.json({ error: 'Missing pathname' }, { status: 400 });
  }

  try {
    const result = await get(pathname, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    if (result?.statusCode !== 200 || !result.stream) {
      return new NextResponse('Not found', { status: 404 });
    }

    return new NextResponse(result.stream, {
      headers: {
        'Cache-Control': 'private, no-cache',
        'Content-Type': result.blob.contentType ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 });
  }
}
