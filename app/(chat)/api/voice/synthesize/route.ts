import { auth } from '@/app/(auth)/auth';
import { getChatAccessById, getMessageById } from '@/lib/db/queries';
import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  synthesizeWithElevenLabs,
  VoiceProviderError,
} from '@/lib/voice';
import { z } from 'zod';

export const runtime = 'nodejs';

const bodySchema = z.object({
  chatId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { chatId, messageId } = bodySchema.parse(await request.json());
    const chat = await getChatAccessById({ id: chatId });
    if (!chat || chat.userId !== session.user.id) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }
    const [message] = await getMessageById({ id: messageId });
    if (!message || message.chatId !== chatId || message.role !== 'assistant') {
      return Response.json(
        { error: 'Assistant message not found.' },
        { status: 404 },
      );
    }
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n')
      .trim();
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    const voiceId =
      process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_ELEVENLABS_VOICE_ID;
    if (!apiKey)
      return Response.json(
        { error: 'Voice replies are unavailable.' },
        { status: 503 },
      );

    const { audio } = await synthesizeWithElevenLabs({ text, apiKey, voiceId });
    return new Response(audio, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: 'Invalid request.' }, { status: 400 });
    const message =
      error instanceof VoiceProviderError
        ? error.message
        : 'Could not generate the voice reply.';
    return Response.json({ error: message }, { status: 502 });
  }
}
