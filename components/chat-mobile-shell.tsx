'use client';

import { useSidebar } from '@/components/ui/sidebar';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';

export function ChatMobileShell() {
  const { setOpenMobile } = useSidebar();

  return <MobileBottomNav onChatsPress={() => setOpenMobile(true)} />;
}
