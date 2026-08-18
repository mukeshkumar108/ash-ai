'use client';

import { Clapperboard, Compass, Image as ImageIcon, MessagesSquare, UserRound } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

type MobileBottomNavProps = {
  onChatsPress?: () => void;
};

export function MobileBottomNav({ onChatsPress }: MobileBottomNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    {
      key: 'explore',
      label: 'Explore',
      icon: Compass,
      active: pathname === '/',
      onClick: () => router.push('/'),
    },
    {
      key: 'chats',
      label: 'Chats',
      icon: MessagesSquare,
      active: pathname.startsWith('/chat'),
      onClick: () => {
        if (onChatsPress) {
          onChatsPress();
          return;
        }

        router.push('/');
      },
    },
    {
      key: 'image',
      label: 'Images',
      icon: ImageIcon,
      active: pathname.startsWith('/image'),
      onClick: () => router.push('/image'),
    },
    {
      key: 'video',
      label: 'Video',
      icon: Clapperboard,
      active: pathname.startsWith('/video'),
      onClick: () => router.push('/video'),
    },
    {
      key: 'profile',
      label: 'Profile',
      icon: UserRound,
      active: pathname.startsWith('/profile') || pathname.startsWith('/settings'),
      onClick: () => router.push('/profile'),
    },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/50 bg-background/88 backdrop-blur-xl dark:border-white/10 dark:bg-background/88 md:hidden">
      <div
        className="mx-auto flex max-w-3xl items-center justify-around px-3 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2"
      >
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium transition-colors',
                item.active
                  ? 'text-primary'
                  : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-full',
                  item.active
                    ? 'bg-primary/12 text-primary'
                    : 'bg-transparent',
                )}
              >
                <Icon size={20} />
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
