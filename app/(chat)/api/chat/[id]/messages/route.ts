import { auth } from '@/app/(auth)/auth';
import {
  getChatAccessById,
  getMessagePageByChatId,
  withQueryContext,
} from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import { convertToUIMessages } from '@/lib/utils';

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withQueryContext('GET /api/chat/[id]/messages', async () => {
    const { id } = await params;
    const requestUrl = new URL(_.url);
    const limitParam = requestUrl.searchParams.get('limit');
    const before = requestUrl.searchParams.get('before');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 40;

    if (!id) {
      return new ChatSDKError('bad_request:api').toResponse();
    }

    const session = await auth();

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const chat = await getChatAccessById({ id });

    if (!chat) {
      return new ChatSDKError('not_found:chat').toResponse();
    }

    if (chat.visibility === 'private' && chat.userId !== session.user.id) {
      return new ChatSDKError('forbidden:chat').toResponse();
    }

    const { messages, hasMore } = await getMessagePageByChatId({
      id,
      limit: Number.isNaN(limit) ? 40 : limit,
      before,
    });

    return Response.json({
      messages: convertToUIMessages(messages),
      hasMore,
    });
  }).catch((error) => {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error('Failed to get chat messages:', error);
    return new ChatSDKError('bad_request:database').toResponse();
  });
}
