import { auth } from '@/app/(auth)/auth';
import {
  getChatAccessById,
  updateMessageParts,
  withQueryContext,
} from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import { z } from 'zod';

const patchBodySchema = z.object({
  messageId: z.string().min(1),
  chatId: z.string().min(1),
  parts: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
  })),
});

export async function PATCH(request: Request) {
  return withQueryContext('PATCH /api/chat/messages', async () => {
    let body: z.infer<typeof patchBodySchema>;

    try {
      const json = await request.json();
      body = patchBodySchema.parse(json);
    } catch {
      return new ChatSDKError('bad_request:api').toResponse();
    }

    const { messageId, chatId, parts } = body;

    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError('unauthorized:vote').toResponse();
    }

    const chat = await getChatAccessById({ id: chatId });
    if (!chat) {
      return new ChatSDKError('not_found:chat').toResponse();
    }
    if (chat.userId !== session.user.id) {
      return new ChatSDKError('forbidden:chat').toResponse();
    }

    await updateMessageParts({ id: messageId, parts });

    return new Response('Message updated', { status: 200 });
  });
}
