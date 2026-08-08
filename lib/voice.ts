import 'server-only';

export const MAX_VOICE_BYTES = 10 * 1024 * 1024;
export const MAX_VOICE_DURATION_MS = 2 * 60 * 1000;
export const DEFAULT_ELEVENLABS_VOICE_ID = 'YY7fzZmDizFQQv8XPAIY';

export const ACCEPTED_VOICE_TYPES = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
  'video/mp4',
  'video/webm',
]);

export class VoiceProviderError extends Error {}

export function validateVoiceUpload(file: Blob, durationMs: number) {
  if (file.size === 0) return 'The recording is empty.';
  if (file.size > MAX_VOICE_BYTES)
    return 'Voice notes must be 10MB or smaller.';
  const mediaType = file.type.toLowerCase().split(';', 1)[0].trim();
  if (!ACCEPTED_VOICE_TYPES.has(mediaType)) {
    return 'Unsupported audio format.';
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 'A valid recording duration is required.';
  }
  if (durationMs > MAX_VOICE_DURATION_MS) {
    return 'Voice notes must be 2 minutes or shorter.';
  }
  return null;
}

export async function transcribeWithLemonFox({
  file,
  apiKey,
  fetchImpl = fetch,
}: {
  file: Blob;
  apiKey: string;
  fetchImpl?: typeof fetch;
}) {
  const body = new FormData();
  body.append('file', file, 'voice-note');
  body.append('response_format', 'json');

  const response = await fetchImpl(
    'https://api.lemonfox.ai/v1/audio/transcriptions',
    { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body },
  );
  if (!response.ok) throw new VoiceProviderError('Transcription failed.');
  const payload = (await response.json()) as { text?: unknown };
  const transcript =
    typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!transcript) throw new VoiceProviderError('No speech was detected.');
  return transcript;
}

export function textForSpeech(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/```[^\n]*\n?|```/g, ''),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function synthesizeWithElevenLabs({
  text,
  apiKey,
  voiceId,
  fetchImpl = fetch,
}: {
  text: string;
  apiKey: string;
  voiceId: string;
  fetchImpl?: typeof fetch;
}) {
  const spokenText = textForSpeech(text);
  if (!spokenText) throw new VoiceProviderError('There is no text to speak.');
  const response = await fetchImpl(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: spokenText,
        model_id: 'eleven_multilingual_v2',
      }),
    },
  );
  if (!response.ok) throw new VoiceProviderError('Speech generation failed.');
  return { audio: await response.arrayBuffer(), spokenText };
}
