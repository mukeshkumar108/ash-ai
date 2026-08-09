import { generateUUID } from '@/lib/utils';
import { saveGeneration } from '@/lib/db/queries';
import { getMessageByErrorCode } from '@/lib/errors';
import { expect, test, type Browser } from '@playwright/test';
import { seedChatThreadForUser } from '../helpers';

async function createAuthenticatedContext(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/register');
  await page
    .getByPlaceholder('user@acme.com')
    .fill(`guardrails-${uniqueSuffix}@playwright.com`);
  await page.getByLabel('Password').fill(`pw-${uniqueSuffix}`);
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await expect(page.getByTestId('toast').first()).toContainText(
    'Account created successfully!',
  );
  await page.waitForURL('/');

  for (let attempt = 0; attempt < 10; attempt++) {
    const profileResponse = await context.request.get('/api/profile');

    if (profileResponse.status() === 200) {
      break;
    }

    await page.waitForTimeout(300);
  }

  await page.close();

  return context;
}

test.describe
  .serial('session guardrails', () => {
    test('guest requests do not hit protected history/profile/chat routes successfully', async ({
      request,
    }) => {
      const historyResponse = await request.get('/api/history');
      expect(historyResponse.status()).toBe(401);
      expect(await historyResponse.json()).toMatchObject({
        code: 'unauthorized:chat',
        message: getMessageByErrorCode('unauthorized:chat'),
      });

      const profileResponse = await request.get('/api/profile');
      expect(profileResponse.status()).toBe(401);

      const profileStatsResponse = await request.get('/api/profile/stats');
      expect(profileStatsResponse.status()).toBe(401);

      const messagesResponse = await request.get(
        `/api/chat/${generateUUID()}/messages`,
      );
      expect(messagesResponse.status()).toBe(401);
      expect(await messagesResponse.json()).toMatchObject({
        code: 'unauthorized:chat',
        message: getMessageByErrorCode('unauthorized:chat'),
      });

      const voteResponse = await request.get(
        `/api/vote?chatId=${generateUUID()}`,
      );
      expect(voteResponse.status()).toBe(401);
      expect(await voteResponse.json()).toMatchObject({
        code: 'unauthorized:vote',
        message: getMessageByErrorCode('unauthorized:vote'),
      });
    });

    test('authenticated requests return stable responses for empty history and missing chats', async ({
      browser,
    }) => {
      const context = await createAuthenticatedContext(browser);

      try {
        const historyResponse = await context.request.get('/api/history');
        expect(historyResponse.status()).toBe(200);

        const historyPayload = await historyResponse.json();
        expect(Array.isArray(historyPayload.chats)).toBe(true);
        expect(typeof historyPayload.hasMore).toBe('boolean');

        const missingChatId = generateUUID();

        const messagesResponse = await context.request.get(
          `/api/chat/${missingChatId}/messages`,
        );
        expect(messagesResponse.status()).toBe(404);
        expect(await messagesResponse.json()).toMatchObject({
          code: 'not_found:chat',
          message: getMessageByErrorCode('not_found:chat'),
        });

        const voteResponse = await context.request.get(
          `/api/vote?chatId=${missingChatId}`,
        );
        expect(voteResponse.status()).toBe(404);
        expect(await voteResponse.json()).toMatchObject({
          code: 'not_found:chat',
          message: getMessageByErrorCode('not_found:chat'),
        });
      } finally {
        await context.close();
      }
    });

    test('authenticated profile endpoints resolve without database wrapper failures', async ({
      browser,
    }) => {
      const context = await createAuthenticatedContext(browser);

      try {
        const profileResponse = await context.request.get('/api/profile');
        expect(profileResponse.status()).toBe(200);

        const profilePayload = await profileResponse.json();
        expect(profilePayload).toMatchObject({
          id: expect.any(String),
          email: expect.any(String),
          themePreference: expect.any(String),
        });

        const statsResponse = await context.request.get('/api/profile/stats');
        expect(statsResponse.status()).toBe(200);

        const statsPayload = await statsResponse.json();
        expect(statsPayload).toMatchObject({
          chatCount: expect.any(Number),
          documentCount: expect.any(Number),
          createdAt: expect.any(String),
        });
      } finally {
        await context.close();
      }
    });

    test('mobile chat drawer shows persisted history when desktop sidebar is collapsed', async ({
      browser,
    }) => {
      const context = await createAuthenticatedContext(browser);

      try {
        const profileResponse = await context.request.get('/api/profile');
        const profile = await profileResponse.json();
        await seedChatThreadForUser({ userId: profile.id });

        const page = await context.newPage();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');
        await page.getByRole('button', { name: 'Chats' }).click();

        await expect(page.getByText('Smoke test chat')).toBeVisible();
        await page.close();
      } finally {
        await context.close();
      }
    });

    test('image listing never returns another account generation or global orphans', async ({
      browser,
    }) => {
      const owner = await createAuthenticatedContext(browser);
      const other = await createAuthenticatedContext(browser);

      try {
        const ownerProfile = await (
          await owner.request.get('/api/profile')
        ).json();
        await saveGeneration({
          userId: ownerProfile.id,
          modelId: 'isolation-test',
          prompt: 'private image prompt',
          images: [
            {
              url: 'https://example.test/private.png',
              pathname: 'image-gen/private.png',
              mediaType: 'image/png',
            },
          ],
        });

        const response = await other.request.get('/api/image/list');
        expect(response.status()).toBe(200);
        const payload = await response.json();
        expect(payload.orphans).toEqual([]);
        expect(payload.generations).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ prompt: 'private image prompt' }),
          ]),
        );
      } finally {
        await owner.close();
        await other.close();
      }
    });
  });
