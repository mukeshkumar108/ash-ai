'use client';

import React, { memo, useLayoutEffect, useRef, useState } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';

interface MessageContentProps {
  text: string;
  role: 'user' | 'assistant';
}

// Collapse long user messages so the near-black bubble doesn't dominate the
// screen (a Claude/WhatsApp-style clamp). Beyond MAX_LINES the content is
// clamped with a faded edge and a "Show more" toggle appears; assistant
// replies are never truncated.
const MAX_LINES = 4;

const NonMemoizedMessageContent = ({ text, role }: MessageContentProps) => {
  const isUser = role === 'user';
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isUser || !innerRef.current) return;
    const el = innerRef.current;
    const lineHeight =
      Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    setClampable(el.scrollHeight > lineHeight * MAX_LINES + 2);
  }, [text, isUser]);

  if (!isUser) {
    return (
      <div className="font-serif text-[17px] leading-[1.4] tracking-[-0.01em] text-foreground/90 md:text-[18px]">
        <MessageResponse>{text}</MessageResponse>
      </div>
    );
  }

  return (
    <div className="w-fit max-w-[92%] rounded-2xl rounded-br-md border border-black/5 bg-white px-5 py-3.5 font-sans text-[16px] leading-[1.55] text-slate-700 shadow-sm dark:border-white/10 dark:bg-[#171310] dark:text-foreground/95 md:text-[17px]">
      <div className="relative text-foreground/95">
        <div
          ref={innerRef}
          className={cn(
            'relative overflow-hidden',
            !expanded && 'max-h-[calc(1.55em*4)]',
          )}
        >
          <MessageResponse>{text}</MessageResponse>
          {!expanded && clampable && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-[#171310] to-transparent" />
          )}
        </div>
        {clampable && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 block px-0 text-left text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
};

export const MessageContent = memo(NonMemoizedMessageContent);
