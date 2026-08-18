import {
  Copy,
  MoreHorizontal,
  PencilIcon,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { memo } from 'react';
import { flushSync } from 'react-dom';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import { deleteTrailingMessages } from '@/app/(chat)/actions';
import { toast } from 'sonner';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

const ACTION_BUTTON_CLASSES = 'min-h-0 min-w-0 p-0 text-muted-foreground';

export function PureMessageActions({
  message,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  setMode,
}: {
  message: ChatMessage;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  setMode?: (mode: 'view' | 'edit') => void;
}) {
  if (isLoading || isReadonly) return null;

  const isUser = message.role === 'user';

  const copyText = () => {
    const text = (message.parts ?? [])
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('\n\n');
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Failed to copy text.'),
    );
  };

  const regenerateFromHere = async () => {
    try {
      await deleteTrailingMessages({ id: message.id });

      flushSync(() => {
        setMessages((messages) => {
          const index = messages.findIndex((m) => m.id === message.id);
          return index >= 0 ? messages.slice(0, index) : messages;
        });
      });

      regenerate();

      toast.success('Regenerating reply...');
    } catch {
      toast.error('Failed to regenerate from this point.');
    }
  };

  const deleteFromHere = async () => {
    try {
      await deleteTrailingMessages({ id: message.id });

      flushSync(() => {
        setMessages((messages) => {
          const index = messages.findIndex((m) => m.id === message.id);
          return index >= 0 ? messages.slice(0, index) : messages;
        });
      });

      toast.success('Deleted this reply and everything after it.');
    } catch {
      toast.error('Failed to delete from this point.');
    }
  };

  // User messages: a single overflow menu keeps the row uncluttered.
  if (isUser) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            className={ACTION_BUTTON_CLASSES}
            variant="ghost"
          >
            <MoreHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem onSelect={() => setMode?.('edit')}>
            <PencilIcon className="mr-2 size-4" />
            Edit message
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={regenerateFromHere}>
            <RotateCcw className="mr-2 size-4" />
            Regenerate reply
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={copyText}>
            <Copy className="mr-2 size-4" />
            Copy text
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Assistant replies: inline actions, no edit (we don't rewrite/steer replies).
  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-row items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              className={ACTION_BUTTON_CLASSES}
              variant="ghost"
              onClick={regenerateFromHere}
            >
              <RotateCcw size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Retry from here</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              className={ACTION_BUTTON_CLASSES}
              variant="ghost"
              onClick={copyText}
            >
              <Copy size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy text</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-xs"
              className={ACTION_BUTTON_CLASSES}
              variant="ghost"
              onClick={deleteFromHere}
            >
              <Trash2 size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete from here</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) =>
    prevProps.message.id === nextProps.message.id &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.isReadonly === nextProps.isReadonly,
);
