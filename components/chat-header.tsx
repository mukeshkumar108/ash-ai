'use client';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useWindowSize } from 'usehooks-ts';

import { ModelSelector } from '@/components/model-selector';
import { SidebarToggle } from '@/components/sidebar-toggle';
import { Button } from '@/components/ui/button';
import { PlusIcon, } from './icons';
import { useSidebar } from './ui/sidebar';
import { memo, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { type VisibilityType, VisibilitySelector } from './visibility-selector';

import { characters, getCharacterById } from '@/lib/ai/characters';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ChevronDownIcon } from 'lucide-react';
import type { UserType } from '@/app/(auth)/auth';

const ChatDebugPanel = dynamic(
  () => import('./chat-debug-panel').then((module) => module.ChatDebugPanel),
  { ssr: false },
);

function PureChatHeader({
  chatId,
  selectedModelId,
  selectedVisibilityType,
  isReadonly,
  userType,
  characterId = 'lila-harper',
  onModelChange,
}: {
  chatId: string;
  selectedModelId: string;
  selectedVisibilityType: VisibilityType;
  isReadonly: boolean;
  userType: UserType;
  characterId?: string;
  onModelChange?: (id: string) => void;
}) {
  const router = useRouter();
  const { open } = useSidebar();

  const { width: windowWidth } = useWindowSize();
  const character = getCharacterById(characterId);
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<Record<string, boolean>>(
    {},
  );
  const isCurrentAvatarBroken = Boolean(brokenAvatarIds[character.id]);

  const markAvatarBroken = (id: string) => {
    setBrokenAvatarIds((current) =>
      current[id] ? current : { ...current, [id]: true },
    );
  };

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/50 bg-background/80 px-2 py-1.5 backdrop-blur dark:border-white/5 dark:bg-zinc-950/70 md:px-2">
      <SidebarToggle />

      {(!open || windowWidth < 768) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              className="order-2 md:order-1 md:px-2 px-2 md:h-fit ml-auto md:ml-0"
              onClick={() => {
                router.push('/');
                router.refresh();
              }}
            >
              <PlusIcon />
              <span className="md:sr-only">New Chat</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Chat</TooltipContent>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 order-1 md:order-2 ml-2 md:ml-0 px-2 h-auto hover:bg-muted/50"
          >
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground overflow-hidden">
              {character.avatar && !isCurrentAvatarBroken ? (
                <img
                  src={character.avatar}
                  alt={character.name}
                  className="w-full h-full object-cover"
                  onError={() => markAvatarBroken(character.id)}
                />
              ) : (
                character.name[0]
              )}
            </div>
            <div className="flex flex-col items-start leading-none">
              <span className="font-semibold text-sm flex items-center gap-1">
                {character.name}
                <ChevronDownIcon size={12} className="text-muted-foreground" />
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                Partner
              </span>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {characters.map((c) => (
            <DropdownMenuItem
              key={c.id}
              className="flex items-center gap-3 py-2 cursor-pointer"
              onClick={() => {
                router.push(`/api/chat/jump?characterId=${c.id}`);
              }}
            >
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground overflow-hidden shrink-0">
                {c.avatar && !brokenAvatarIds[c.id] ? (
                  <img
                    src={c.avatar}
                    alt={c.name}
                    className="w-full h-full object-cover"
                    onError={() => markAvatarBroken(c.id)}
                  />
                ) : (
                  c.name[0]
                )}
              </div>
              <div className="flex flex-col">
                <span className="font-medium text-sm">{c.name}</span>
                <span className="text-xs text-muted-foreground line-clamp-1">{c.description}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {!isReadonly && (
        <ModelSelector
          userType={userType}
          selectedModelId={selectedModelId}
          onModelChange={onModelChange}
          className="order-1 md:order-3 ml-auto md:ml-0"
        />
      )}

      {!isReadonly && (
        <VisibilitySelector
          chatId={chatId}
          selectedVisibilityType={selectedVisibilityType}
          className="order-1 md:order-3 ml-auto md:ml-0"
        />
      )}

      {!isReadonly && <ChatDebugPanel chatId={chatId} />}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return prevProps.selectedModelId === nextProps.selectedModelId && prevProps.characterId === nextProps.characterId;
});
