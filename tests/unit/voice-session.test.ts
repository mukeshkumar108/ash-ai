import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { signVoiceToken, verifyVoiceToken } from '@/lib/voice-session';

test.beforeEach(() => {
  process.env.VOICE_SESSION_SECRET = 'voice-test-secret';
});

const claims = {
  uid: 'user-1',
  cid: '11111111-1111-4111-8111-111111111111',
  tz: 'Europe/London',
  companion: 'sophie' as const,
};

test('a signed voice token binds user, chat, timezone and companion', () => {
  const token = signVoiceToken(claims);
  expect(verifyVoiceToken(token)).toMatchObject(claims);
});

test('tampered, expired and foreign-secret tokens are rejected', () => {
  const token = signVoiceToken(claims);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ ...claims, uid: 'someone-else', exp: 9999999999 }),
  ).toString('base64url');
  expect(verifyVoiceToken(`${forged}.${signature}`)).toBeNull();
  expect(verifyVoiceToken(`${payload}.AAAA`)).toBeNull();
  expect(verifyVoiceToken(null)).toBeNull();
  const expired = signVoiceToken({ ...claims, ttlSeconds: 1 }, Date.now() - 10_000);
  expect(verifyVoiceToken(expired)).toBeNull();
  process.env.VOICE_SESSION_SECRET = 'a-different-secret';
  expect(verifyVoiceToken(token)).toBeNull();
});

test('voice is a modality adapter: no instructions, secrets or local intelligence in the call UI', () => {
  const ui = readFileSync('components/voice-call.tsx', 'utf8');
  for (const forbidden of [
    'instructions',
    'COMPANION_RUNTIME',
    'NEXT_PUBLIC_VOICE_URL',
    'localhost:3002',
    'honcho',
    'cortex',
  ]) {
    expect(ui.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
  }
  expect(ui).toContain('/api/voice/session');
  for (const route of ['session', 'context', 'turn']) {
    const source = readFileSync(`app/(chat)/api/voice/${route}/route.ts`, 'utf8');
    expect(source).not.toMatch(/streamText|generateText|generateObject|executeCompanionRuntimeTurn/u);
  }
});
