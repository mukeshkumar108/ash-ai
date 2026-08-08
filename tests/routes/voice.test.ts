import { expect, test } from '../fixtures';

test.describe('/api/voice', () => {
  test('unauthenticated transcription and synthesis are rejected', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob(['voice'], { type: 'audio/webm' }),
        'voice.webm',
      );
      form.append('durationMs', '1000');
      const transcription = await context.request.post(
        '/api/voice/transcribe',
        {
          multipart: {
            file: {
              name: 'voice.webm',
              mimeType: 'audio/webm',
              buffer: Buffer.from('voice'),
            },
            durationMs: '1000',
          },
        },
      );
      expect(transcription.status()).toBe(401);
      const synthesis = await context.request.post('/api/voice/synthesize', {
        data: { chatId: crypto.randomUUID(), messageId: crypto.randomUUID() },
      });
      expect(synthesis.status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('authenticated invalid audio is rejected before a provider call', async ({
    adaContext,
  }) => {
    const response = await adaContext.request.post('/api/voice/transcribe', {
      multipart: {
        file: {
          name: 'bad.js',
          mimeType: 'application/javascript',
          buffer: Buffer.from('alert(1)'),
        },
        durationMs: '1000',
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('Unsupported');
  });
});
