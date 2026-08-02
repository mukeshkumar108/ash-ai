import { expect, test } from '../fixtures';
import { seedChatThreadForUser } from '../helpers';
import type { Browser } from '@playwright/test';

async function createSmokeUser(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `smoke-${uniqueSuffix}@playwright.com`;
  const password = `pw-${uniqueSuffix}`;

  await page.goto('/register');
  await page.getByPlaceholder('user@acme.com').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await expect(page.getByTestId('toast').first()).toContainText(
    'Account created successfully!',
  );
  await page.waitForURL('/');

  for (let attempt = 0; attempt < 10; attempt++) {
    const profileResponse = await context.request.get('/api/profile');

    if (profileResponse.status() === 200) {
      return { context, page, request: context.request };
    }

    await page.waitForTimeout(300);
  }

  throw new Error('Authenticated smoke user session never became ready');
}

test.describe.serial('app smoke', () => {
  test('login, history, chat open, vote, and profile flows stay healthy', async ({
    browser,
  }) => {
    const user = await createSmokeUser(browser);

    try {
      const profileResponse = await user.request.get('/api/profile');
      expect(profileResponse.status()).toBe(200);

      const profile = await profileResponse.json();
      expect(profile).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
      });

      const seededChat = await seedChatThreadForUser({
        userId: profile.id,
      });

      const historyResponse = await user.request.get('/api/history');
      expect(historyResponse.status()).toBe(200);
      const historyPayload = await historyResponse.json();
      expect(historyPayload.chats.map((chat: { id: string }) => chat.id)).toContain(
        seededChat.chatId,
      );

      const voteResponse = await user.request.get(
        `/api/vote?chatId=${seededChat.chatId}`,
      );
      expect(voteResponse.status()).toBe(200);
      const votes = await voteResponse.json();
      expect(votes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chatId: seededChat.chatId,
            messageId: seededChat.assistantMessageId,
            isUpvoted: true,
          }),
        ]),
      );

      await user.page.goto(`/chat/${seededChat.chatId}`);
      await expect(user.page.getByText('Smoke test assistant reply')).toBeVisible();
      await expect(user.page.getByText('Smoke test user message')).toBeVisible();

      await user.page.goto('/profile');
      await expect(
        user.page.getByRole('heading', { name: 'Profile & Settings' }),
      ).toBeVisible();

      const statsResponse = await user.request.get('/api/profile/stats');
      expect(statsResponse.status()).toBe(200);
    } finally {
      await user.context.close();
    }
  });
});
