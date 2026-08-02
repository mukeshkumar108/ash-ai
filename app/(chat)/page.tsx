import { cookies } from 'next/headers';
import { HomeScreen } from '@/components/home-screen';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { generateUUID } from '@/lib/utils';
import { auth } from '../(auth)/auth';
import { redirect } from 'next/navigation';

export default async function Page() {
  const session = await auth();

  if (!session) {
    redirect('/login');
  }

  const id = generateUUID();

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('chat-model');
  const modelId = modelIdFromCookie?.value || DEFAULT_CHAT_MODEL;

  return (
    <HomeScreen
      id={id}
      userType={session.user.type}
      initialChatModel={modelId}
    />
  );
}
