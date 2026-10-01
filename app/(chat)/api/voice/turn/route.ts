import { z } from 'zod';

import { companionRuntimeMessageId } from '@/lib/companion-runtime';
import { db, getChatById } from '@/lib/db/queries';
import { message as messageTable } from '@/lib/db/schema';
import {
  boundedRecentContext,
  persistRuntimeReply,
} from '@/lib/runtime-turn-persistence';
import { mechanicalTranscriptReliability } from '@/lib/transcript-reliability';
import { bearerVoiceClaims } from '@/lib/voice-session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  turn_id: z.string().min(1).max(100),
  user_text: z.string().min(1).max(8000),
  assistant_text: z.string().min(1).max(20000),
  next_session_state: z.record(z.unknown()).nullish(),
  reliability_status: z.enum(['reliable', 'uncertain', 'likely_garbled']).optional(),
});

/**
 * Server-to-server (Voice Runtime -> BFF): a completed spoken turn becomes
 * ordinary chat history, so text and voice are one conversation. Idempotent
 * by deterministic message ids; mirrors and Runtime state follow the exact
 * same path as a text turn.
 */
export async function POST(request: Request) {
  const claims = bearerVoiceClaims(request);
  if (!claims) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const chat = await getChatById({ id: claims.cid });
  if (!chat || chat.userId !== claims.uid) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = parsed.data;
  const userMessageId = companionRuntimeMessageId('voice-user', claims.cid, body.turn_id);
  const assistantId = companionRuntimeMessageId('voice-assistant', claims.cid, body.turn_id);
  const userCreatedAt = new Date();
  await db
    .insert(messageTable)
    .values({
      chatId: claims.cid,
      id: userMessageId,
      role: 'user',
      parts: [{ type: 'text', text: body.user_text }] as never,
      attachments: [],
      createdAt: userCreatedAt,
    })
    .onConflictDoNothing();
  const reliability = mechanicalTranscriptReliability({ transcript: body.user_text });
  await persistRuntimeReply({
    assistantText: body.assistant_text,
    nextSessionState: body.next_session_state ?? undefined,
    assistantId,
    chatId: claims.cid,
    userId: claims.uid,
    userMessageId,
    userText: body.user_text,
    userCreatedAt,
    timeZone: claims.tz,
    recentContext: boundedRecentContext([]),
    transcriptReliability: {
      ...reliability,
      source: 'voice_stream',
      status: body.reliability_status ?? 'reliable',
    } as never,
  });
  return Response.json({ ok: true, assistantMessageId: assistantId });
}
