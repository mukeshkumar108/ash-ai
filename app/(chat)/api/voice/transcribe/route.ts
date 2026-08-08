import { auth } from '@/app/(auth)/auth';
import {
  transcribeWithLemonFox,
  validateVoiceUpload,
  VoiceProviderError,
} from '@/lib/voice';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user)
    return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get('file');
    const durationMs = Number(form.get('durationMs'));
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
    return Response.json({ transcript, provider: 'lemonfox', durationMs });
  } catch (error) {
    const message =
      error instanceof VoiceProviderError
        ? error.message
        : 'Could not process that voice note.';
    return Response.json({ error: message }, { status: 502 });
  }
}
