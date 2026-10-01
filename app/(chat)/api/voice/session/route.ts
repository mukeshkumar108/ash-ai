import { auth } from '@/app/(auth)/auth';
import { resolveUserTimeZone } from '@/lib/agent/timezone';
import { getChatById, getUserById, saveChat } from '@/lib/db/queries';
import { signVoiceToken } from '@/lib/voice-session';

export const runtime = 'nodejs';

/** Issue a signed voice-call identity for one of the user's chats. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const wsUrl = process.env.VOICE_RUNTIME_WS_URL?.trim();
  if (!wsUrl) {
    return Response.json({ error: 'Voice is not configured' }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { chatId?: string };
  const chatId = String(body.chatId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/iu.test(chatId)) {
    return Response.json({ error: 'chatId is required' }, { status: 400 });
  }
  const existing = await getChatById({ id: chatId });
  if (existing && existing.userId !== session.user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!existing) {
    await saveChat({
      id: chatId,
      userId: session.user.id,
      title: 'Call',
      characterId: 'neutral',
      visibility: 'private',
      chatModel: 'chat-model',
    });
  }
  const profile = await getUserById(session.user.id);
  const token = signVoiceToken({
    uid: session.user.id,
    cid: chatId,
    tz: resolveUserTimeZone(profile?.timeZone),
    companion: 'sophie',
  });
  return Response.json({ url: wsUrl, token, chatId });
}
