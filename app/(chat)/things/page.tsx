import { auth } from '@/app/(auth)/auth';
import { redirect } from 'next/navigation';
import { listTasksForUser } from '@/lib/tasks/domain';
import { listCommitmentCandidates } from '@/lib/synapse-cortex';
import { ThingsScreen } from '@/components/things/things-screen';

export default async function ThingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const [tasks, candidates] = await Promise.all([
    listTasksForUser(session.user.id),
    listCommitmentCandidates({ userId: session.user.id, limit: 20 }),
  ]);
  return (
    <ThingsScreen
      initialTasks={tasks.map((task) => ({
        id: task.id,
        title: task.title,
        notes: task.notes,
        status: task.status,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        source: task.source,
        sourceMessageId: task.sourceMessageId,
        chatId: task.chatId,
        reminders: task.reminders.map((reminder) => ({
          id: reminder.id,
          label: reminder.label,
          startAt: reminder.startAt ? reminder.startAt.toISOString() : null,
          endAt: reminder.endAt ? reminder.endAt.toISOString() : null,
          status: reminder.status,
        })),
      }))}
      initialCandidates={candidates?.candidates.map((candidate) => ({
        key: candidate.key,
        title: candidate.title,
        notes: candidate.notes,
        evidence: candidate.evidenceVerbatim,
        authority: candidate.authority,
        createdAt: candidate.createdAt,
      }))}
      candidatesAvailable={candidates?.available ?? false}
    />
  );
}