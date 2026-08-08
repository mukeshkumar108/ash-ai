import { auth } from '@/app/(auth)/auth';
import { getChatAccessById } from '@/lib/db/queries';
import { inspectHoncho, queryHonchoMemory } from '@/lib/honcho';
import { getRecentMemoryTraces } from '@/lib/agent/memory';

function unavailable() {
  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function authorize(chatId: string | null) {
  if (process.env.NODE_ENV === 'production' || !chatId) return null;
  const session = await auth();
  if (!session?.user?.id) return null;
  const chat = await getChatAccessById({ id: chatId });
  if (!chat || chat.userId !== session.user.id) return null;
  return session.user.id;
}

export async function GET(request: Request) {
  const chatId = new URL(request.url).searchParams.get('chatId');
  const userId = await authorize(chatId);
  if (!userId || !chatId) return unavailable();
  try {
    return Response.json({
      ...(await inspectHoncho(userId, chatId)),
      retrievals: getRecentMemoryTraces(userId, chatId),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : 'Honcho inspection failed',
      },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  let body: { chatId?: string; query?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const userId = await authorize(body.chatId ?? null);
  const query = body.query?.trim();
  if (!userId || !body.chatId) return unavailable();
  if (!query || query.length > 2_000) {
    return Response.json(
      { error: 'Query must be 1-2000 characters' },
      { status: 400 },
    );
  }
  try {
    return Response.json({
      answer: await queryHonchoMemory(userId, body.chatId, query),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Honcho query failed' },
      { status: 503 },
    );
  }
}
