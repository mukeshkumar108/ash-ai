'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ImageIcon, MessagesSquare } from 'lucide-react';

import { PlusIcon } from '@/components/icons';
import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';

export function AppSidebar() {
  const router = useRouter();
  const { setOpenMobile, state, isMobile } = useSidebar();
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <Sidebar collapsible="icon" className="group-data-[side=left]:border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Chat">
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <MessagesSquare />
                <span>Chat</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Image Studio">
              <Link href="/image" onClick={() => setOpenMobile(false)}>
                <ImageIcon />
                <span>Image Studio</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="New chat"
              onClick={() => {
                setOpenMobile(false);
                router.push('/');
                router.refresh();
              }}
            >
              <PlusIcon />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarTrigger className="mt-2" />
      </SidebarHeader>
      <SidebarContent>
        {(isMobile || state === 'expanded') && <SidebarHistory user={user} />}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-2 p-2">
          {user && <SidebarUserNav user={user} />}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
