import { expect, test } from '@playwright/test';

import { fatalVoiceRuntimeError } from '@/lib/voice-runtime-events';

test('speech recognition failure ends the call with an actionable message', () => {
  expect(
    fatalVoiceRuntimeError({
      type: 'error',
      error: {
        type: 'transcription_failed',
        message: 'Speech recognition failed with scribe_v2_realtime.',
      },
    }),
  ).toBe('Speech recognition unavailable');
});

test('recoverable response errors do not end the call', () => {
  expect(
    fatalVoiceRuntimeError({
      type: 'error',
      error: { type: 'response_failed', message: 'Try that turn again.' },
    }),
  ).toBeNull();
});

test('session setup failures are fatal', () => {
  expect(
    fatalVoiceRuntimeError({
      type: 'error',
      error: { type: 'session_limit_reached', message: 'No slots.' },
    }),
  ).toBe('Voice server is busy');
});
