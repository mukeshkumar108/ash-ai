import { auth } from '@/app/(auth)/auth';
import { runRelationshipInitiative } from '@/lib/ai/relationship/outreach';
import { initiativeRequestSchema } from '@/lib/ai/relationship/types';
import { getChatAccessById, withQueryContext } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withQueryContext('POST /api/chat/[id]/initiative', async () => {
    const session = await auth();
    if (!session?.user?.id)
      return new ChatSDKError('unauthorized:chat').toResponse();
    const { id } = await params;
    const chat = await getChatAccessById({ id });
    if (!chat) return new ChatSDKError('not_found:chat').toResponse();
    if (chat.userId !== session.user.id)
      return new ChatSDKError('forbidden:chat').toResponse();
    const parsed = initiativeRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return Response.json(
        { error: 'Invalid initiative request' },
        { status: 400 },
      );
    const result = await runRelationshipInitiative({
      userId: session.user.id,
      chatId: id,
      trigger: parsed.data.trigger,
      anchorMessageId: parsed.data.anchorMessageId,
    });
    return Response.json(result);
  });
}
