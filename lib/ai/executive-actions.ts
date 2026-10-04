import 'server-only';

import {
  cancelTask,
  createTask,
  listTasksForUser,
  rescheduleTask,
} from '@/lib/tasks/domain';
import {
  fetchPendingExecutiveActions,
  postExecutiveReceipt,
} from '@/lib/synapse-cortex';

/**
 * Executes the action intents Cortex's executive has cleared (authority and risk are decided and enforced on the Cortex side). Each action is first
 * CLAIMED with a `started` receipt so it can never run twice, then executed through the app's own capability, then reported with a real receipt.
 * The result also flows back into the world by itself: createTask pushes the new task to Cortex as a source-linked object.
 */
export async function runExecutiveActionSweep() {
  const pending = await fetchPendingExecutiveActions();
  let succeeded = 0;
  let failed = 0;
  for (const action of pending) {
    const base = { userId: action.userId, workItemId: action.workItemId };
    try {
      await postExecutiveReceipt({ ...base, status: 'started' });
    } catch {
      continue; // could not claim: leave it for the next sweep rather than risk a double run
    }
    try {
      if (action.tool.tool === 'task.create') {
        const args = action.tool.args ?? {};
        const title = String(args.title ?? action.title ?? '').trim();
        if (!title) throw new Error('task.create needs a title');
        const dueRaw = args.due_at ?? args.dueAt;
        const dueAt = dueRaw ? new Date(String(dueRaw)) : null;
        const created = await createTask({
          userId: action.userId,
          chatId: null,
          title: title.slice(0, 300),
          notes: args.notes ? String(args.notes).slice(0, 2_000) : null,
          dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
          source: 'sophie_accepted',
        });
        await postExecutiveReceipt({
          ...base,
          status: 'succeeded',
          resultRef: String(created.id),
        });
        succeeded += 1;
      } else if (action.tool.tool === 'task.list') {
        // A QUERY capability: the result is an observation returned in the receipt for the executive to reason over.
        const args = action.tool.args ?? {};
        const status = ['pending', 'completed', 'cancelled'].includes(String(args.status))
          ? (String(args.status) as 'pending' | 'completed' | 'cancelled')
          : 'pending';
        const tasks = (await listTasksForUser(action.userId, { status })).slice(0, 20);
        const observation = tasks.map((t) => ({
          id: t.id,
          title: t.title,
          due_at: t.dueAt ? new Date(t.dueAt).toISOString() : null,
          status: t.status,
        }));
        await postExecutiveReceipt({
          ...base,
          status: 'succeeded',
          resultRef: `tasks:${tasks.length}`,
          detail: JSON.stringify(observation).slice(0, 1_900),
        });
        succeeded += 1;
      } else if (action.tool.tool === 'task.reschedule') {
        // Mutates an EXISTING object by its id (ids come from the world state or a task.list observation).
        const args = action.tool.args ?? {};
        const taskId = String(args.task_id ?? args.taskId ?? '').trim();
        const dueRaw = args.due_at ?? args.dueAt;
        const dueAt = dueRaw ? new Date(String(dueRaw)) : null;
        if (!taskId) throw new Error('task.reschedule needs task_id');
        if (!dueAt || Number.isNaN(dueAt.getTime())) throw new Error('task.reschedule needs a valid due_at');
        const outcome = await rescheduleTask(action.userId, taskId, { dueAt });
        if (!outcome.ok) throw new Error(`reschedule refused: ${outcome.reason ?? 'unknown'}`);
        await postExecutiveReceipt({
          ...base,
          status: 'succeeded',
          resultRef: taskId,
          detail: `rescheduled to ${dueAt.toISOString()}`,
        });
        succeeded += 1;
      } else if (action.tool.tool === 'task.cancel') {
        // Consequential (the product declares it irreversible): Cortex only releases this after the user's own confirmation.
        const args = action.tool.args ?? {};
        const taskId = String(args.task_id ?? args.taskId ?? '').trim();
        if (!taskId) throw new Error('task.cancel needs task_id');
        const outcome = await cancelTask(action.userId, taskId);
        if (!outcome.ok) throw new Error(`cancel refused: ${outcome.reason ?? 'unknown'}`);
        await postExecutiveReceipt({
          ...base,
          status: 'succeeded',
          resultRef: taskId,
          detail: 'cancelled',
        });
        succeeded += 1;
      } else {
        throw new Error(`unsupported tool: ${String(action.tool.tool)}`);
      }
    } catch (error) {
      failed += 1;
      await postExecutiveReceipt({
        ...base,
        status: 'failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => undefined);
    }
  }
  return { pending: pending.length, succeeded, failed };
}
