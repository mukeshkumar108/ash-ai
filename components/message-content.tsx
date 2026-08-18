import React, { memo } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';

interface MessageContentProps {
  text: string;
  role: 'user' | 'assistant';
}

const NonMemoizedMessageContent = ({ text, role }: MessageContentProps) => {
  const isUser = role === 'user';

  return (
    <div
      className={cn(
        'max-w-full',
        isUser
          ? 'w-fit rounded-2xl rounded-br-md border border-black/5 bg-white px-5 py-3.5 font-sans text-[16px] leading-[1.55] text-slate-700 shadow-sm dark:border-white/10 dark:bg-[#171310] dark:text-foreground/95 md:text-[17px]'
          : 'font-serif text-[17px] leading-[1.4] tracking-[-0.01em] text-foreground/90 md:text-[18px]',
      )}
    >
      <div
        className={cn(
          'text-[inherit] leading-[inherit]',
          isUser ? 'text-foreground/95' : 'text-foreground/90',
        )}
      >
        <MessageResponse>{text}</MessageResponse>
      </div>
    </div>
  );
};

export const MessageContent = memo(NonMemoizedMessageContent);
