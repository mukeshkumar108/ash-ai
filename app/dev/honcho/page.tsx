import { auth } from '@/app/(auth)/auth';
import { getChatsByUserId } from '@/lib/db/queries';
import { notFound, redirect } from 'next/navigation';
import { HonchoInspector } from './inspector';

export default async function HonchoDevPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const { chats } = await getChatsByUserId({
    id: session.user.id,
    limit: 100,
    startingAfter: null,
    endingBefore: null,
  });
  return (
    <HonchoInspector chats={chats.map(({ id, title }) => ({ id, title }))} />
  );
}
