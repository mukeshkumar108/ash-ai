import { expect, test } from '../fixtures';
import type { APIRequestContext } from '@playwright/test';

async function createTask(
  request: APIRequestContext,
  payload: Record<string, unknown>,
) {
  const response = await request.post('/api/tasks', { data: payload });
  return { response, body: (await response.json()) as { ok: boolean; data: any } };
}

async function patchTask(
  request: APIRequestContext,
  taskId: string,
  payload: Record<string, unknown>,
) {
  const response = await request.patch(`/api/tasks/${taskId}`, { data: payload });
  return { response, body: (await response.json()) as { ok: boolean; error?: string; data?: any } };
}

test.describe('/api/tasks — Things surface', () => {
  test('unauthenticated requests are rejected', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      expect((await context.request.get('/api/tasks')).status()).toBe(401);
      expect((await context.request.post('/api/tasks')).status()).toBe(401);
      expect((await context.request.patch('/api/tasks/some-id')).status()).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('manual chatless create + edit + complete + cancel + snooze + reschedule', async ({
    adaContext,
  }) => {
    const { request } = adaContext;

    // Manual chatless create.
    const created = await createTask(request, {
      title: 'Renew passport',
      dueAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
      source: 'manual',
    });
    expect(created.response.status()).toBe(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.data.chatId).toBeNull();
    expect(created.body.data.source).toBe('manual');
    const taskId = created.body.data.id as string;

    // Chat-agented create uses the authenticated chat provenance path.
    const viaChat = await createTask(request, {
      title: 'Born in a chat',
      source: 'api',
    });
    expect(viaChat.response.status()).toBe(201);

    // User-level listing shows both chatless and chat-set tasks in one list.
    const listed = await request.get('/api/tasks');
    expect(listed.status()).toBe(200);
    const listedBody = (await listed.json()) as { data: any[] };
    const titles = listedBody.data.map((task) => task.title);
    expect(titles).toContain('Renew passport');
    expect(titles).toContain('Born in a chat');

    // Edit.
    const edited = await patchTask(request, taskId, {
      action: 'edit',
      title: 'Renew passport (2026)',
    });
    expect(edited.response.status()).toBe(200);
    expect(edited.body.data.title).toBe('Renew passport (2026)');

    // Snooze moves the due date forward.
    const before = await request.get(`/api/tasks/${taskId}`);
    const beforeDue = new Date(
      ((await before.json()) as { data: { dueAt: string | null } }).data.dueAt ?? '',
    ).getTime();
    const snoozed = await patchTask(request, taskId, {
      action: 'snooze',
      offsetMinutes: 60,
    });
    expect(snoozed.response.status()).toBe(200);
    const afterDue = new Date(snoozed.body.data.dueAt ?? '').getTime();
    expect(afterDue).toBeGreaterThan(beforeDue);

    // Reschedule to a concrete Friday.
    const friday = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    const rescheduled = await patchTask(request, taskId, {
      action: 'reschedule',
      dueAt: friday,
    });
    expect(rescheduled.response.status()).toBe(200);
    expect(new Date(rescheduled.body.data.dueAt).toISOString()).toBe(friday);

    // Complete.
    const completed = await patchTask(request, taskId, { action: 'complete' });
    expect(completed.response.status()).toBe(200);
    expect(completed.body.data.status).toBe('completed');

    // Cancel another one.
    const cancelled = await patchTask(request, taskId, { action: 'cancel' });
    expect(cancelled.response.status()).toBe(409);
  });

  test('no ownership leak between users', async ({ adaContext, babbageContext }) => {
    const ada = await createTask(adaContext.request, {
      title: 'ada-private-thing',
      source: 'manual',
    });
    expect(ada.response.status()).toBe(201);
    const taskId = ada.body.data.id as string;

    // babbage cannot see or mutate ada's task.
    const babbageList = await babbageContext.request.get('/api/tasks');
    expect(babbageList.status()).toBe(200);
    const titles = ((await babbageList.json()) as { data: any[] }).data.map(
      (task) => task.title,
    );
    expect(titles).not.toContain('ada-private-thing');

    const read = await babbageContext.request.get(`/api/tasks/${taskId}`);
    expect(read.status()).toBe(404);

    const complete = await babbageContext.request.patch(`/api/tasks/${taskId}`, {
      data: { action: 'complete' },
    });
    expect(complete.status()).toBe(404);

    // ada still owns it and can mutate it.
    const adaComplete = await patchTask(adaContext.request, taskId, {
      action: 'complete',
    });
    expect(adaComplete.response.status()).toBe(200);
  });
});