import { auth } from '@/app/(auth)/auth';

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
  console.info('[latency-waterfall] browser_first_token', {
    userId: session.user.id,
    chatId: typeof value.chatId === 'string' ? value.chatId : null,
    turnId: typeof value.turnId === 'string' ? value.turnId : null,
    clientTtftMs: Math.round(clientTtftMs),
  });
  return new Response(null, { status: 204 });
}
