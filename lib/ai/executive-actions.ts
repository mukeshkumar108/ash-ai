import 'server-only';

import { createTask } from '@/lib/tasks/domain';
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
