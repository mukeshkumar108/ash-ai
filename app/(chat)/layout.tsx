import { cookies } from 'next/headers';

import { AppSidebar } from '@/components/app-sidebar';
import { ChatMobileShell } from '@/components/chat-mobile-shell';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isCollapsed = cookieStore.get('sidebar:state')?.value !== 'true';

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <AppSidebar />
      <SidebarInset className="pb-20 md:pb-0">
        {children}
        <ChatMobileShell />
      </SidebarInset>
    </SidebarProvider>
  );
}
