import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/app/(auth)/auth';
import { Chat } from '@/components/chat';
import {
  getChatPageById,
  getMessagePageByChatId,
  withQueryContext,
} from '@/lib/db/queries';
import {
  getContinueSceneDirectivePrompt,
  getNextSceneDirectivePrompt,
} from '@/lib/ai/character-prompts';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { convertToUIMessages } from '@/lib/utils';

const INITIAL_MESSAGE_PAGE_SIZE = 40;

export default async function Page(props: { params: Promise<{ id: string }> }) {
  return withQueryContext('GET /chat/[id] page', async () => {
    const params = await props.params;
    const { id } = params;
    const chat = await getChatPageById({ id });

    if (!chat) {
      notFound();
    }

    const session = await auth();

    if (!session) {
      redirect('/login');
    }

    if (chat.visibility === 'private') {
      if (!session.user) {
        return notFound();
      }

      if (session.user.id !== chat.userId) {
        return notFound();
      }
    }

    const initialMessagePage = await getMessagePageByChatId({
      id,
      limit: INITIAL_MESSAGE_PAGE_SIZE,
    });

    const uiMessages = convertToUIMessages(initialMessagePage.messages);

    const cookieStore = await cookies();
    const chatModelFromCookie = cookieStore.get('chat-model');
    const nextSceneDirective = getNextSceneDirectivePrompt();
    const continueSceneDirective = getContinueSceneDirectivePrompt();

    const initialChatModel =
      chat.chatModel || chatModelFromCookie?.value || DEFAULT_CHAT_MODEL;

    return (
      <Chat
        key={chat.id}
        id={chat.id}
        initialMessages={uiMessages}
        initialChatModel={initialChatModel}
        initialVisibilityType={chat.visibility}
        isReadonly={session.user?.id !== chat.userId}
        userType={session.user.type}
        autoResume={false}
        initialHasOlderMessages={initialMessagePage.hasMore}
        characterId={chat.characterId}
        nextSceneDirective={nextSceneDirective}
        continueSceneDirective={continueSceneDirective}
      />
    );
  });
}
