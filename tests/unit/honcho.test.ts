import { expect, test } from '@playwright/test';
import { honchoIds } from '@/lib/honcho';

test.describe('Honcho identity mapping', () => {
  test('is deterministic and namespaced', () => {
    const ids = honchoIds(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(ids.userPeerId).toBe('user_11111111-1111-4111-8111-111111111111');
    expect(ids.sophiePeerId).toBe('sophie');
    expect(ids.sessionId).toBe('chat_22222222-2222-4222-8222-222222222222');
  });

  test('reuses a user peer across different chat sessions', () => {
    const first = honchoIds('same-user', 'chat-one');
    const second = honchoIds('same-user', 'chat-two');
    expect(first.userPeerId).toBe(second.userPeerId);
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});
