import { auth } from '@/app/(auth)/auth';
import { db } from '@/lib/db/queries';
import { streamTrace } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 401 });
  const value = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!value) return new Response(null, { status: 400 });
  const clientTtftMs = Number(value.clientTtftMs);
  if (!Number.isFinite(clientTtftMs) || clientTtftMs < 0) {
    return new Response(null, { status: 400 });
  }
  const kind =
    value.kind === 'first_text_delta' ? 'first_text_delta' : 'first_chunk';
  const turnId = typeof value.turnId === 'string' ? value.turnId : null;
  const chatId = typeof value.chatId === 'string' ? value.chatId : null;
  console.info('[latency-waterfall] browser_first_token', {
    userId: session.user.id,
    chatId,
    turnId,
    kind,
    clientTtftMs: Math.round(clientTtftMs),
  });

  // Persist the browser-observed timestamp onto the matching StreamTrace row
  // (if any) so the server side can be correlated with the client side.
  if (kind === 'first_chunk' && turnId && chatId) {
    try {
      await db
        .update(streamTrace)
        .set({ browserFirstChunkMs: Math.round(clientTtftMs) })
        .where(
          and(
            eq(streamTrace.turnId, turnId as never),
            eq(streamTrace.chatId, chatId as never),
          ),
        );
    } catch (error) {
      console.warn('[telemetry] first_chunk persist failed (fail-open)', error);
    }
  } else if (kind === 'first_text_delta' && turnId && chatId) {
    try {
      await db
        .update(streamTrace)
        .set({ browserFirstTextDeltaMs: Math.round(clientTtftMs) })
        .where(
          and(
            eq(streamTrace.turnId, turnId as never),
            eq(streamTrace.chatId, chatId as never),
          ),
        );
    } catch (error) {
      console.warn(
        '[telemetry] first_text_delta persist failed (fail-open)',
        error,
      );
    }
  }

  return new Response(null, { status: 204 });
}
