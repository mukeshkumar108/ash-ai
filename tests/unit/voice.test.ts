import { expect, test } from '@playwright/test';
import {
  MAX_VOICE_BYTES,
  synthesizeWithElevenLabs,
  textForSpeech,
  transcribeWithLemonFox,
  transcribeWithElevenLabs,
  validateVoiceUpload,
  VoiceProviderError,
} from '@/lib/voice';
import { voiceTranscriptParts } from '@/lib/voice-message';

test.describe('voice-note adapters', () => {
  test('accepts a bounded browser recording', () => {
    expect(
      validateVoiceUpload(new Blob(['audio'], { type: 'audio/webm' }), 1500),
    ).toBeNull();
    expect(
      validateVoiceUpload(
        new Blob(['audio'], { type: 'audio/webm;codecs=opus' }),
        1500,
      ),
    ).toBeNull();
  });

  test('rejects invalid, empty, oversize, and overlong recordings', () => {
    expect(
      validateVoiceUpload(
        new Blob(['x'], { type: 'application/javascript' }),
        1000,
      ),
    ).toContain('Unsupported');
    expect(
      validateVoiceUpload(new Blob([], { type: 'audio/webm' }), 1000),
    ).toContain('empty');
    expect(
      validateVoiceUpload(
        new Blob([new Uint8Array(MAX_VOICE_BYTES + 1)], { type: 'audio/webm' }),
        1000,
      ),
    ).toContain('10MB');
    expect(
      validateVoiceUpload(new Blob(['x'], { type: 'audio/webm' }), 120_001),
    ).toContain('2 minutes');
  });

  test('uploads binary data to LemonFox and returns canonical transcript text', async () => {
    let receivedBody: FormData | undefined;
    const transcript = await transcribeWithLemonFox({
      file: new Blob(['voice'], { type: 'audio/webm' }),
      apiKey: 'test-key',
      fetchImpl: async (_url, init) => {
        expect(new Headers(init?.headers).get('Authorization')).toBe(
          'Bearer test-key',
        );
        receivedBody = init?.body as FormData;
        return Response.json({ text: '  Same text runtime, please.  ' });
      },
    });
    expect(receivedBody?.get('file')).toBeInstanceOf(Blob);
    expect(transcript).toBe('Same text runtime, please.');
  });

  test('a transcript enters the same canonical text shape as a typed turn', () => {
    const transcript = 'Remember this exact conversational text.';
    const voiceParts = voiceTranscriptParts(transcript);
    const typedParts = [{ type: 'text' as const, text: transcript }];
    expect(voiceParts).toEqual(typedParts);
    expect(voiceParts).not.toContainEqual(
      expect.objectContaining({ type: 'file' }),
    );
  });

  test('handles LemonFox provider failures without inventing a transcript', async () => {
    await expect(
      transcribeWithLemonFox({
        file: new Blob(['voice'], { type: 'audio/webm' }),
        apiKey: 'test-key',
        fetchImpl: async () => new Response('down', { status: 503 }),
      }),
    ).rejects.toBeInstanceOf(VoiceProviderError);
  });

  test('uploads binary data to ElevenLabs Scribe and returns transcript text', async () => {
    let receivedBody: FormData | undefined;
    let receivedHeaders: HeadersInit | undefined;
    const transcript = await transcribeWithElevenLabs({
      file: new Blob(['voice'], { type: 'audio/webm' }),
      apiKey: 'test-key',
      fetchImpl: async (_input, init) => {
        receivedBody = init?.body as FormData;
        receivedHeaders = init?.headers;
        return Response.json({ text: ' fallback transcript ' });
      },
    });

    expect(transcript).toBe('fallback transcript');
    expect(receivedBody?.get('file')).toBeInstanceOf(Blob);
    expect(receivedBody?.get('model_id')).toBe('scribe_v2');
    expect(receivedHeaders).toEqual({ 'xi-api-key': 'test-key' });
  });

  test('rejects an empty ElevenLabs transcript', async () => {
    await expect(
      transcribeWithElevenLabs({
        file: new Blob(['voice'], { type: 'audio/webm' }),
        apiKey: 'test-key',
        fetchImpl: async () => Response.json({ text: '  ' }),
      }),
    ).rejects.toThrow('No speech was detected.');
  });

  test('speaks the actual response with markdown syntax removed', async () => {
    let providerText = '';
    const result = await synthesizeWithElevenLabs({
      text: '**Hello**, [Mukesh](https://example.com).',
      apiKey: 'eleven-key',
      voiceId: 'YY7fzZmDizFQQv8XPAIY',
      fetchImpl: async (url, init) => {
        expect(String(url)).toContain('YY7fzZmDizFQQv8XPAIY');
        expect(new Headers(init?.headers).get('xi-api-key')).toBe('eleven-key');
        providerText = JSON.parse(String(init?.body)).text;
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    });
    expect(providerText).toBe('Hello, Mukesh.');
    expect(result.spokenText).toBe(providerText);
    expect(result.audio.byteLength).toBe(3);
  });

  test('TTS provider failure is isolated from the already-persisted text', async () => {
    const canonicalText = 'This remains visible.';
    await expect(
      synthesizeWithElevenLabs({
        text: canonicalText,
        apiKey: 'eleven-key',
        voiceId: 'voice',
        fetchImpl: async () => new Response('down', { status: 500 }),
      }),
    ).rejects.toBeInstanceOf(VoiceProviderError);
    expect(canonicalText).toBe('This remains visible.');
  });

  test('text normalization does not create a second summary or alter meaning', () => {
    expect(textForSpeech('# Answer\n\n- Keep the **canonical text**.')).toBe(
      'Answer\nKeep the canonical text.',
    );
  });
});
