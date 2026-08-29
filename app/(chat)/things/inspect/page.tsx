import { auth } from '@/app/(auth)/auth';
import { ContinuityInspector } from '@/components/things/continuity-inspector';
import { listTasksForUser } from '@/lib/tasks/domain';
import { fetchContinuityInspectorState } from '@/lib/synapse-cortex';
import { getContinuityDeliveryDiagnostics } from '@/lib/continuity/diagnostics';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ContinuityInspectorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const [tasks, cortex, delivery] = await Promise.all([
    listTasksForUser(session.user.id),
    fetchContinuityInspectorState({ userId: session.user.id, limit: 150 }),
    getContinuityDeliveryDiagnostics(session.user.id),
  ]);

  return (
    <ContinuityInspector
      tasks={tasks.map((task) => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        status: task.status,
        source: task.source,
        sourceMessageId: task.sourceMessageId,
        dueAt: task.dueAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      }))}
      cortex={cortex}
      delivery={delivery}
    />
  );
}
