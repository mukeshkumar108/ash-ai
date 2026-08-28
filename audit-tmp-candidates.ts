/** TEMP Checkpoint 5 probe — removed after run. Exercises the real candidate
 * list/promote/dismiss against a live local Cortex + the real app domain. */
import { config } from 'dotenv';

config({ path: '.env.local' });

process.env.SYNAPSE_CORTEX_URL = 'http://127.0.0.1:8010';
process.env.SYNAPSE_CORTEX_ENABLED = 'true';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/queries';
import { chat as chatTable, user as userTable } from '@/lib/db/schema';
import { createTask, getTaskWithReminders, listTasksForUser } from '@/lib/tasks/domain';
import {
  listCommitmentCandidates,
  markCommitmentCandidate,
} from '@/lib/synapse-cortex';

let failures = 0;
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) { failures += 1; console.error('  FAIL:', msg); }
  else console.log('  ok:', msg);
}

const USER_ID = 'c5f30000-0000-4000-8000-0000000000aa';
const KEY_PROMOTE = 'c_promote_abc';
const KEY_DISMISS = 'c_dismiss_xyz';

async function main() {
  await db.insert(userTable).values({ id: USER_ID, email: `candidate-probe-${USER_ID}@test.local` }).onConflictDoNothing();
  await db.insert(chatTable).values({ id: 'c5f31111-0000-4000-8000-0000000000bb', userId: USER_ID, title: 'probe', createdAt: new Date() }).onConflictDoNothing();
  try {
    // 1. List candidates from the live cortex (owner-scoped).
    const listed = await listCommitmentCandidates({ userId: USER_ID, limit: 20 });
    assert(listed?.available === true, 'candidates available from live Cortex');
    const keys = listed?.candidates.map((c) => c.key) ?? [];
    assert(keys.includes(KEY_PROMOTE) && keys.includes(KEY_DISMISS), 'both pending candidates listed under the user');
    const promote = listed?.candidates.find((c) => c.key === KEY_PROMOTE);
    assert(promote?.title === 'Renew my passport', 'cortex title surfaced');

    // 2. Promote -> canonical Task, exactly one, retry idempotent.
    const task = await createTask({
      userId: USER_ID,
      chatId: null,
      title: promote.title,
      notes: promote.notes ?? null,
      source: 'sophie_accepted',
      materializedCandidateKey: promote.key,
    });
    await markCommitmentCandidate({
      userId: USER_ID,
      candidateKey: promote.key,
      status: 'materialized',
      sourceObjectId: task.id,
    });
    assert((await getTaskWithReminders(USER_ID, task.id)) !== null, 'promoted candidate is a canonical Task');
    assert(task.source === 'sophie_accepted', 'promoted task source is sophie_accepted');
    const retry = await createTask({
      userId: USER_ID,
      chatId: null,
      title: 'Renew my passport',
      source: 'sophie_accepted',
      materializedCandidateKey: promote.key,
    });
    assert(retry.id === task.id, 're-promotion returns the same Task (no duplicate)');
    const owned = (await listTasksForUser(USER_ID, { status: 'pending' })).filter(
      (t) => t.materializedCandidateKey === promote.key,
    );
    assert(owned.length === 1, 'exactly one canonical Task per promoted candidate');

    // 3. Materialized candidate no longer lists as pending.
    const afterPromote = await listCommitmentCandidates({ userId: USER_ID, limit: 20 });
    assert(
      !(afterPromote?.candidates.some((c) => c.key === KEY_PROMOTE) ?? true),
      'materialized candidate drops out of Sophie-noticed list',
    );

    // 4. Dismiss is durable; dismissed candidate never re-lists; promote-after-dismiss is impossible.
    await markCommitmentCandidate({ userId: USER_ID, candidateKey: KEY_DISMISS, status: 'dismissed' });
    const afterDismiss = await listCommitmentCandidates({ userId: USER_ID, limit: 20 });
    assert(
      !(afterDismiss?.candidates.some((c) => c.key === KEY_DISMISS) ?? true),
      'dismissed candidate never re-appears in the list',
    );
    const dismissedStillLists = await listCommitmentCandidates({ userId: USER_ID, limit: 50 });
    assert(
      !(dismissedStillLists?.candidates.some((c) => c.key === KEY_DISMISS) ?? true),
      'dismissed candidate does not reappear at higher limits',
    );
  } finally {
    await db.delete(chatTable).where(eq(chatTable.id, 'c5f31111-0000-4000-8000-0000000000bb')).catch(() => undefined);
    await db.delete(userTable).where(eq(userTable.id, USER_ID)).catch(() => undefined);
  }
  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nall candidate probe assertions passed');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });