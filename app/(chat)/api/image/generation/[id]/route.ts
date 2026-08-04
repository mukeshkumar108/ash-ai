import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { deleteGenerationById } from '@/lib/db/queries';

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await props.params;

  try {
    await deleteGenerationById({ id, userId: session.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[image-generation-delete] failed', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
