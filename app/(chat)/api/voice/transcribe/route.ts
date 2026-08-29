import { auth } from '@/app/(auth)/auth';
import {
  transcribeWithElevenLabs,
  transcribeWithLemonFox,
  validateVoiceUpload,
  VoiceProviderError,
} from '@/lib/voice';
import { assessTranscriptReliability } from '@/lib/ai/transcript-reliability';
import { getChatAccessById, getMessagesByChatId } from '@/lib/db/queries';
import { mechanicalTranscriptReliability } from '@/lib/transcript-reliability';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get('x-vercel-id');
  let recordingId = '';
  const session = await auth();
  if (!session?.user)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get('file');
    const durationMs = Number(form.get('durationMs'));
    const chatId = String(form.get('chatId') ?? '');
    recordingId = String(form.get('recordingId') ?? '').slice(0, 80);
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'voice_transcription_started',
        requestId,
        recordingId,
        durationMs,
        bytes: file instanceof Blob ? file.size : null,
        mimeType: file instanceof Blob ? file.type : null,
      }),
    );
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
    const lemonFoxApiKey = process.env.LEMONFOX_API_KEY?.trim();
    const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!lemonFoxApiKey && !elevenLabsApiKey)
      return Response.json(
        { error: 'Voice transcription is unavailable.' },
        { status: 503 },
      );

    const providerAttempts: Array<{
      provider: 'lemonfox' | 'elevenlabs';
      durationMs: number;
      outcome: 'success' | 'failure';
    }> = [];
    const configuredPrimary =
      process.env.VOICE_TRANSCRIPTION_PRIMARY?.trim().toLowerCase() ===
      'lemonfox'
        ? 'lemonfox'
        : 'elevenlabs';
    const configuredProviders = {
      lemonfox: lemonFoxApiKey
        ? () => transcribeWithLemonFox({ file, apiKey: lemonFoxApiKey })
        : null,
      elevenlabs: elevenLabsApiKey
        ? () => transcribeWithElevenLabs({ file, apiKey: elevenLabsApiKey })
        : null,
    } as const;
    const providerOrder: Array<'lemonfox' | 'elevenlabs'> = [
      configuredPrimary,
      configuredPrimary === 'elevenlabs' ? 'lemonfox' : 'elevenlabs',
    ];
    let provider: 'lemonfox' | 'elevenlabs' | null = null;
    let transcript: string | null = null;
    let lastProviderError: unknown;
    for (const candidate of providerOrder) {
      const transcribe = configuredProviders[candidate];
      if (!transcribe) continue;
      const providerStartedAt = Date.now();
      try {
        transcript = await transcribe();
        provider = candidate;
        providerAttempts.push({
          provider: candidate,
          durationMs: Date.now() - providerStartedAt,
          outcome: 'success',
        });
        break;
      } catch (error) {
        lastProviderError = error;
        providerAttempts.push({
          provider: candidate,
          durationMs: Date.now() - providerStartedAt,
          outcome: 'failure',
        });
      }
    }
    if (!provider || !transcript) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'voice_transcription_providers_exhausted',
          requestId,
          recordingId,
          configuredPrimary,
          providerAttempts,
        }),
      );
      throw (
        lastProviderError ?? new VoiceProviderError('Transcription failed.')
      );
    }
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
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'voice_transcription_completed',
        requestId,
        recordingId,
        provider,
        providerAttempts,
        totalDurationMs: Date.now() - startedAt,
        reliabilityStatus: reliability.status,
        transcriptCharacters: transcript.length,
      }),
    );
    return Response.json({
      transcript,
      provider,
      durationMs,
      reliability,
    });
  } catch (error) {
    const message =
      error instanceof VoiceProviderError
        ? error.message
        : 'Could not process that voice note.';
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'voice_transcription_failed',
        requestId,
        recordingId,
        errorType:
          error instanceof VoiceProviderError
            ? 'provider'
            : error instanceof Error
              ? error.name
              : 'unknown',
        totalDurationMs: Date.now() - startedAt,
      }),
    );
    return Response.json({ error: message }, { status: 502 });
  }
}
