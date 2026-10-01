import { convertToUIMessages } from '@/lib/utils';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { bearerVoiceClaims } from '@/lib/voice-session';

export const runtime = 'nodejs';

const HISTORY_WINDOW = Number(process.env.CONTEXT_WINDOW_SIZE ?? 40);

/**
 * Server-to-server (Voice Runtime -> BFF): the chat the call joins. History
 * and the previous Runtime session state, exactly what a text turn would send.
 */
export async function GET(request: Request) {
  const claims = bearerVoiceClaims(request);
  if (!claims) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const chat = await getChatById({ id: claims.cid });
  if (chat && chat.userId !== claims.uid) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const messages = chat ? await getMessagesByChatId({ id: claims.cid }) : [];
  const history = convertToUIMessages(messages)
    .slice(-HISTORY_WINDOW)
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n'),
      created_at: entry.metadata?.createdAt,
    }))
    .filter((entry) => entry.content.trim().length > 0);
  return Response.json({
    history,
    session_routing: (chat?.sessionRouting ?? {}) as Record<string, unknown>,
  });
}
