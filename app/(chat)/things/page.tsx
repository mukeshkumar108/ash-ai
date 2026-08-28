import { auth } from '@/app/(auth)/auth';
import { redirect } from 'next/navigation';
import { listTasksForUser } from '@/lib/tasks/domain';
import { ThingsScreen } from '@/components/things/things-screen';

export default async function ThingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const tasks = await listTasksForUser(session.user.id);
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
    />
  );
}