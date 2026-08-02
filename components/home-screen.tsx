'use client';

import { Chat } from '@/components/chat';
import type { UserType } from '@/app/(auth)/auth';

export function HomeScreen({
  id,
  userType,
  initialChatModel,
}: {
  id: string;
  userType: UserType;
  initialChatModel: string;
}) {
  return (
    <Chat
      key={id}
      id={id}
      initialMessages={[]}
      initialChatModel={initialChatModel}
      initialVisibilityType="private"
      isReadonly={false}
      userType={userType}
      autoResume={false}
    />
  );
}
