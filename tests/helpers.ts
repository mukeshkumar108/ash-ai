import fs from 'node:fs';
import path from 'node:path';
import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from '@playwright/test';
import { generateId } from 'ai';
import { generateUUID } from '@/lib/utils';
import { getUnixTime } from 'date-fns';
import { saveChat, saveMessages, voteMessage } from '@/lib/db/queries';
import type { DBMessage } from '@/lib/db/schema';

export type UserContext = {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
};

export async function createAuthenticatedContext({
  browser,
  name,
  chatModel = 'chat-model',
}: {
  browser: Browser;
  name: string;
  chatModel?: 'chat-model' | 'chat-model-reasoning';
}): Promise<UserContext> {
  const directory = path.join(__dirname, '../playwright/.sessions');

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const storageFile = path.join(directory, `${name}.json`);

  const context = await browser.newContext();
  const page = await context.newPage();

  const email = `test-${name}@playwright.com`;
  const password = generateId();
  const port = process.env.PORT || 3000;
  await page.goto(`http://localhost:${port}/register`);
  await page.getByPlaceholder('user@acme.com').click();
  await page.getByPlaceholder('user@acme.com').fill(email);
  await page.getByLabel('Password').click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign Up' }).click();

  await expect(page.getByTestId('toast').first()).toContainText(
    'Account created successfully!',
  );

  await page.waitForTimeout(1000);

  for (let attempt = 0; attempt < 10; attempt++) {
    const profileResponse = await context.request.get('/api/profile');

    if (profileResponse.status() === 200) {
      break;
    }

    await page.waitForTimeout(300);
  }

  await context.storageState({ path: storageFile });
  await page.close();

  const newContext = await browser.newContext({ storageState: storageFile });
  const newPage = await newContext.newPage();

  return {
    context: newContext,
    page: newPage,
    request: newContext.request,
  };
}

export function generateRandomTestUser() {
  const email = `test-${getUnixTime(new Date())}@playwright.com`;
  const password = generateId();

  return {
    email,
    password,
  };
}

export async function seedChatThreadForUser({
  userId,
  chatId = generateUUID(),
}: {
  userId: string;
  chatId?: string;
}) {
  const now = new Date();
  const userMessageId = generateUUID();
  const assistantMessageId = generateUUID();

  await saveChat({
    id: chatId,
    userId,
    title: 'Smoke test chat',
    characterId: 'lila-harper',
    visibility: 'private',
    chatModel: 'chat-model',
  });

  const messages: DBMessage[] = [
    {
      id: userMessageId,
      chatId,
      role: 'user',
      parts: [{ type: 'text', text: 'Smoke test user message' }],
      attachments: [],
      createdAt: now,
    },
    {
      id: assistantMessageId,
      chatId,
      role: 'assistant',
      parts: [{ type: 'text', text: 'Smoke test assistant reply' }],
      attachments: [],
      createdAt: new Date(now.getTime() + 1_000),
    },
  ];

  await saveMessages({ messages });
  await voteMessage({
    chatId,
    messageId: assistantMessageId,
    type: 'up',
  });

  return {
    chatId,
    userMessageId,
    assistantMessageId,
  };
}
