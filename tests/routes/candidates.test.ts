import { expect, test } from '../fixtures';

test.describe('/api/tasks/candidates — Sophie noticed', () => {
  test('unauthenticated candidate actions are rejected', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      expect((await context.request.get('/api/tasks/candidates')).status()).toBe(401);
      expect(
        (await context.request.post('/api/tasks/candidates/promote')).status(),
      ).toBe(401);
      expect(
        (await context.request.post('/api/tasks/candidates/dismiss')).status(),
      ).toBe(401);
    } finally {
      await context.close();
    }
  });

  test('authenticated listing fails open when Cortex is unavailable', async ({
    adaContext,
  }) => {
    // When SYNAPSE_CORTEX_URL is not configured the surface is present but
    // reports available:false with no candidates (fail-open, never a crash).
    const response = await adaContext.request.get('/api/tasks/candidates');
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      available: boolean;
      data: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.available).toBe(false);
    expect(body.data).toEqual([]);
  });

  test('missing or malformed candidate keys are rejected', async ({
    adaContext,
  }) => {
    const promote = await adaContext.request.post(
      '/api/tasks/candidates/promote',
      { data: { key: '' } },
    );
    expect(promote.status()).toBe(400);

    const dismiss = await adaContext.request.post(
      '/api/tasks/candidates/dismiss',
      { data: {} },
    );
    expect(dismiss.status()).toBe(400);
  });
});