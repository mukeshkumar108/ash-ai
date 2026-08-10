import { auth } from '@/app/(auth)/auth';
import {
  transcribeWithLemonFox,
  validateVoiceUpload,
  VoiceProviderError,
} from '@/lib/voice';
import { assessTranscriptReliability } from '@/lib/ai/transcript-reliability';
import { getChatAccessById, getMessagesByChatId } from '@/lib/db/queries';
import { mechanicalTranscriptReliability } from '@/lib/transcript-reliability';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get('file');
    const durationMs = Number(form.get('durationMs'));
    const chatId = String(form.get('chatId') ?? '');
    if (!(file instanceof Blob)) {
      return Response.json(
        { error: 'No audio file uploaded.' },
        { status: 400 },
      );
    }
    const validationError = validateVoiceUpload(file, durationMs);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }
    const apiKey = process.env.LEMONFOX_API_KEY?.trim();
    if (!apiKey)
      return Response.json(
        { error: 'Voice transcription is unavailable.' },
        { status: 503 },
      );

    const transcript = await transcribeWithLemonFox({ file, apiKey });
    const mechanical = mechanicalTranscriptReliability({
      transcript,
      durationMs,
      source: 'audio_transcript',
    });
    let recentContext: string | null = null;
    if (
      mechanical.status !== 'reliable' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        chatId,
      )
    ) {
      const chat = await getChatAccessById({ id: chatId });
      if (chat && chat.userId !== session.user.id)
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (chat) {
        const messages = await getMessagesByChatId({ id: chatId });
        recentContext = messages
          .slice(-8)
          .map((message) => {
            const text = Array.isArray(message.parts)
              ? message.parts
                  .filter((part: any) => part?.type === 'text')
                  .map((part: any) => String(part.text ?? ''))
                  .join(' ')
              : '';
            return `${message.role}: ${text.trim().slice(0, 500)}`;
          })
          .filter((line) => !line.endsWith(': '))
          .join('\n')
          .slice(-3_000);
      }
    }
    const reliability = await assessTranscriptReliability({
      transcript,
      durationMs,
      recentContext,
      source: 'audio_transcript',
      mechanical,
    });
    console.info('[voice] transcript reliability', {
      userId: session.user.id,
      source: reliability.source,
      status: reliability.status,
      confidence: reliability.confidence,
      signals: reliability.signals,
      reason: reliability.reason,
    });
    return Response.json({
      transcript,
      provider: 'lemonfox',
      durationMs,
      reliability,
    });
  } catch (error) {
    const message =
      error instanceof VoiceProviderError
        ? error.message
        : 'Could not process that voice note.';
    return Response.json({ error: message }, { status: 502 });
  }
}
