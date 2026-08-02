import React, { memo } from 'react';
import { Markdown } from './markdown';
import { cn } from '@/lib/utils';

interface RoleplayContentProps {
  text: string;
  role: 'user' | 'assistant';
}

const NonMemoizedRoleplayContent = ({ text, role }: RoleplayContentProps) => {
  const isUser = role === 'user';

  return (
    <div
      className={cn(
        'w-full max-w-[92%] rounded-2xl px-3 py-2 md:px-5 md:py-2.5 shadow-sm',
        isUser
          ? 'w-fit min-w-[56px] rounded-tr-none border border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-600 via-purple-600 to-violet-700 text-white mr-0.5 md:mr-2'
          : 'rounded-tl-none border border-rose-200/70 bg-gradient-to-br from-white via-rose-50 to-violet-50 text-slate-800 ml-0.5 md:ml-2 dark:border-violet-900/60 dark:from-zinc-900 dark:via-zinc-900 dark:to-violet-950/70 dark:text-zinc-100',
      )}
    >
      <div
        className={cn(
          'prose max-w-none text-[16px] font-medium leading-[1.34] md:text-base md:leading-[1.4]',
          'prose-p:my-0 prose-strong:font-semibold prose-em:italic',
          isUser
            ? 'prose-invert text-white'
            : 'text-slate-800 dark:text-zinc-100',
        )}
      >
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
};

export const RoleplayContent = memo(NonMemoizedRoleplayContent);
