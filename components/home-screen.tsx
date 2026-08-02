'use client';

import { useState, useEffect } from 'react';
import { Chat } from '@/components/chat';
import { CharacterSelector } from '@/components/character-selector';
import { type Character, getCharacterById } from '@/lib/ai/characters';
import { useSearchParams } from 'next/navigation';
import { generateUUID } from '@/lib/utils';
import type { UserType } from '@/app/(auth)/auth';

export function HomeScreen({
  id,
  userType,
  initialChatModel,
  nextSceneDirective,
  continueSceneDirective,
}: {
  id: string;
  userType: UserType;
  initialChatModel: string;
  nextSceneDirective: string;
  continueSceneDirective: string;
}) {
  const searchParams = useSearchParams();
  const characterIdParam = searchParams.get('characterId');

  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(
    null,
  );
  const [chatId, setChatId] = useState<string>(id);
  const selectedCharacterId = selectedCharacter?.id;

  useEffect(() => {
    if (characterIdParam) {
      const character = getCharacterById(characterIdParam);
      if (character) {
        setSelectedCharacter(character);
      }
    }
  }, [characterIdParam]);

  useEffect(() => {
    if (selectedCharacterId) {
      setChatId(generateUUID());
    }
  }, [selectedCharacterId]);

  if (!selectedCharacter) {
    return <CharacterSelector onSelect={setSelectedCharacter} />;
  }

  return (
    <Chat
      key={`${chatId}:${selectedCharacter.id}`}
      id={chatId}
      initialMessages={[]}
      initialChatModel={initialChatModel}
      initialVisibilityType="private"
      isReadonly={false}
      userType={userType}
      autoResume={false}
      characterId={selectedCharacter.id}
      nextSceneDirective={nextSceneDirective}
      continueSceneDirective={continueSceneDirective}
    />
  );
}
