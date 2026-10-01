import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Identity for realtime voice calls. The browser never holds the Runtime
 * secret or a user id of its own: this BFF issues a short-lived signed token
 * that binds (user, chat, timezone, companion). The Voice Runtime verifies it
 * with the shared VOICE_SESSION_SECRET and uses the same token as a bearer for
 * its server-to-server context/turn calls back here. Voice is a modality; the
 * conversation it joins is the user's existing chat.
 */
export type VoiceClaims = {
  uid: string;
  cid: string;
  tz: string;
  companion: 'sophie';
  exp: number;
};

const b64url = (value: Buffer | string) =>
  (typeof value === 'string' ? Buffer.from(value, 'utf8') : value).toString(
    'base64url',
  );

function secret() {
  const value = process.env.VOICE_SESSION_SECRET?.trim();
  if (!value) throw new Error('VOICE_SESSION_SECRET is required for voice calls');
  return value;
}

function mac(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest();
}

export function signVoiceToken(
  claims: Omit<VoiceClaims, 'exp'> & { ttlSeconds?: number },
  now = Date.now(),
): string {
  const { ttlSeconds = 2 * 60 * 60, ...rest } = claims;
  const payload = b64url(
    JSON.stringify({ ...rest, exp: Math.floor(now / 1000) + ttlSeconds }),
  );
  return `${payload}.${b64url(mac(payload))}`;
}

export function verifyVoiceToken(
  token: string | null | undefined,
  now = Date.now(),
): VoiceClaims | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = mac(payload);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as VoiceClaims;
    if (
      typeof claims.uid !== 'string' ||
      typeof claims.cid !== 'string' ||
      typeof claims.tz !== 'string' ||
      claims.exp * 1000 < now
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

export function bearerVoiceClaims(request: Request): VoiceClaims | null {
  const header = request.headers.get('authorization') ?? '';
  return verifyVoiceToken(header.startsWith('Bearer ') ? header.slice(7) : null);
}
