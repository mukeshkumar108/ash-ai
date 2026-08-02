import { PencilIcon, RotateCcw, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { flushSync } from 'react-dom';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import { deleteTrailingMessages } from '@/app/(chat)/actions';
import { toast } from 'sonner';
import { Button } from './ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

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
  if (isLoading || isReadonly || message.role === 'user') return null;

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex flex-row gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-7 px-2 py-1 text-muted-foreground [&_svg]:size-3.5"
              variant="outline"
              onClick={async () => {
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
              }}
            >
              <RotateCcw size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Retry from here</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-7 px-2 py-1 text-muted-foreground [&_svg]:size-3.5"
              variant="outline"
              onClick={() => {
                setMode?.('edit');
              }}
            >
              <PencilIcon size={14} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit and retry</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              className="h-7 px-2 py-1 text-muted-foreground [&_svg]:size-3.5"
              variant="outline"
              onClick={async () => {
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
              }}
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
