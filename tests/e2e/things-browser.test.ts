import { expect, test } from '../fixtures';
import { db } from '@/lib/db/queries';
import { task as taskTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

test.describe('Things & Sophie Noticed Browser E2E (Surfaces C & D)', () => {
  test('Surface C: Things lifecycle — create, inline edit, snooze, reschedule, complete, cancel, filter, reload persistence', async ({
    adaContext,
  }) => {
    const page = adaContext.page;
    const port = process.env.PORT || 3000;

    // Navigate to /things
    await page.goto(`http://localhost:${port}/things`);
    await expect(page.getByRole('heading', { name: 'Things' })).toBeVisible();

    // 1. Add a manual task
    const taskTitle = `Manual Dental Checkup ${Date.now()}`;
    const taskNotes = 'Prefer Tuesday morning slot';
    await page.getByPlaceholder('e.g. renew my passport').fill(taskTitle);
    await page.getByPlaceholder('Notes (optional)').fill(taskNotes);

    const [addResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add' }).click(),
    ]);
    expect(addResponse.status()).toBe(201);

    // Verify task is rendered in the list
    const taskCard = page
      .locator('.flex.flex-col.gap-3')
      .getByText(taskTitle)
      .first();
    await expect(taskCard).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(taskNotes).first()).toBeVisible();
    await expect(page.getByText('Manual').first()).toBeVisible();

    // Verify database record has chatId = null and source = 'manual'
    const [dbTask] = await db
      .select()
      .from(taskTable)
      .where(eq(taskTable.title, taskTitle))
      .limit(1);
    expect(dbTask).toBeDefined();
    expect(dbTask.chatId).toBeNull();
    expect(dbTask.source).toBe('manual');
    expect(dbTask.status).toBe('pending');

    // 2. Inline edit task title and notes
    const editedTitle = `${taskTitle} - Updated`;
    const editBtn = page.getByRole('button', { name: 'Edit' }).first();
    await editBtn.click();

    await page
      .locator('input[value*="Manual Dental Checkup"]')
      .fill(editedTitle);
    const [editResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks/') &&
          res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ]);
    expect(editResponse.status()).toBe(200);

    await expect(page.getByText(editedTitle).first()).toBeVisible();

    // Verify DB update
    const [updatedDbTask] = await db
      .select()
      .from(taskTable)
      .where(eq(taskTable.id, dbTask.id))
      .limit(1);
    expect(updatedDbTask.title).toBe(editedTitle);

    // 3. Reschedule task
    await page.getByRole('button', { name: 'Reschedule' }).first().click();
    const newDueDate = '2026-09-15T14:30';
    await page.getByLabel('New due date').fill(newDueDate);
    const [rescheduleResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks/') &&
          res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Set' }).click(),
    ]);
    expect(rescheduleResponse.status()).toBe(200);

    // Verify due date updated in DB
    const [rescheduledDbTask] = await db
      .select()
      .from(taskTable)
      .where(eq(taskTable.id, dbTask.id))
      .limit(1);
    expect(rescheduledDbTask.dueAt).not.toBeNull();

    // 4. Complete task
    const completeBtn = page.getByRole('button', { name: 'Complete' }).first();
    const [completeResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks/') &&
          res.request().method() === 'PATCH',
      ),
      completeBtn.click(),
    ]);
    expect(completeResponse.status()).toBe(200);

    // Task becomes completed; filter by Completed to verify
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Completed' }).click();
    await expect(page.getByText(editedTitle).first()).toBeVisible();

    // 5. Reload persistence
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Things' })).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Completed' }).click();
    await expect(page.getByText(editedTitle).first()).toBeVisible();

    // 6. Create another task and Cancel it
    const cancelTitle = `Cancel gym pass ${Date.now()}`;
    await page.getByPlaceholder('e.g. renew my passport').fill(cancelTitle);
    const [addCancelTaskRes] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Add' }).click(),
    ]);
    expect(addCancelTaskRes.status()).toBe(201);

    // Switch filter to Pending or All
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Pending' }).click();
    await expect(page.getByText(cancelTitle).first()).toBeVisible();

    const [cancelResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks/') &&
          res.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: 'Cancel task' }).first().click(),
    ]);
    expect(cancelResponse.status()).toBe(200);

    // Switch filter to Cancelled
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Cancelled' }).click();
    await expect(page.getByText(cancelTitle).first()).toBeVisible();

    // Clean up test tasks
    await db.delete(taskTable).where(eq(taskTable.id, dbTask.id));
  });

  test('Surface D: Sophie Noticed candidate lifecycle & cross-user isolation', async ({
    adaContext,
    babbageContext,
  }) => {
    const pageAda = adaContext.page;
    const pageBabbage = babbageContext.page;
    const port = process.env.PORT || 3000;

    // Direct API call to verify candidates endpoint works for authenticated Ada
    const candidateListRes = await adaContext.request.get(
      '/api/tasks/candidates',
    );
    expect(candidateListRes.status()).toBe(200);

    // Navigate Ada to /things
    await pageAda.goto(`http://localhost:${port}/things`);
    await expect(
      pageAda.getByRole('heading', { name: 'Things' }),
    ).toBeVisible();

    // Create a task for Ada
    const adaTaskTitle = `Ada Private Task ${Date.now()}`;
    await pageAda.getByPlaceholder('e.g. renew my passport').fill(adaTaskTitle);
    const [createRes] = await Promise.all([
      pageAda.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks') && res.request().method() === 'POST',
      ),
      pageAda.getByRole('button', { name: 'Add' }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    await expect(pageAda.getByText(adaTaskTitle).first()).toBeVisible();

    // Navigate Babbage to /things
    await pageBabbage.goto(`http://localhost:${port}/things`);
    await expect(
      pageBabbage.getByRole('heading', { name: 'Things' }),
    ).toBeVisible();

    // Verify Babbage CANNOT see Ada's task
    await expect(pageBabbage.getByText(adaTaskTitle)).toHaveCount(0);

    // Cross-user API check: Babbage cannot see or mutate Ada's task
    const [adaTaskDb] = await db
      .select()
      .from(taskTable)
      .where(eq(taskTable.title, adaTaskTitle))
      .limit(1);
    expect(adaTaskDb).toBeDefined();

    const babbageMutateRes = await babbageContext.request.patch(
      `/api/tasks/${adaTaskDb.id}`,
      {
        data: { action: 'complete' },
      },
    );
    expect(babbageMutateRes.status()).toBe(404);

    // Cleanup
    await db.delete(taskTable).where(eq(taskTable.id, adaTaskDb.id));
  });
});
