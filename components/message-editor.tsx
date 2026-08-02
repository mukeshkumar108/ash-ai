'use client';

import { Button } from './ui/button';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { Textarea } from './ui/textarea';
import { deleteTrailingMessages } from '@/app/(chat)/actions';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import { getTextFromMessage } from '@/lib/utils';
import { toast } from 'sonner';

export type MessageEditorProps = {
  message: ChatMessage;
  chatId?: string;
  setMode: Dispatch<SetStateAction<'view' | 'edit'>>;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
};

export function MessageEditor({
  message,
  chatId,
  setMode,
  setMessages,
  regenerate,
}: MessageEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const [draftContent, setDraftContent] = useState<string>(
    getTextFromMessage(message),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraftContent(event.target.value);
    adjustHeight();
  };

  const isAssistant = message.role === 'assistant';

  return (
    <div className="flex flex-col gap-2 w-full">
      <Textarea
        data-testid="message-editor"
        ref={textareaRef}
        className="bg-transparent outline-none overflow-hidden resize-none !text-base rounded-xl w-full"
        value={draftContent}
        onChange={handleInput}
      />

      <div className="flex flex-row gap-2 justify-end">
        <Button
          variant="outline"
          className="h-fit py-2 px-3"
          onClick={() => {
            setMode('view');
          }}
        >
          Cancel
        </Button>
        <Button
          data-testid="message-editor-send-button"
          variant="default"
          className="h-fit py-2 px-3"
          disabled={isSubmitting}
          onClick={async () => {
            setIsSubmitting(true);
            try {
              if (isAssistant) {
                // In-place edit: PATCH the message in DB, update local state, no regeneration
                const updatedParts = [
                  ...message.parts.filter(p => p.type !== 'text'),
                  { type: 'text' as const, text: draftContent },
                ];

                const res = await fetch('/api/chat/messages', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messageId: message.id,
                    chatId: chatId || '',
                    parts: updatedParts,
                  }),
                });

                if (!res.ok) {
                  throw new Error('Failed to save');
                }

                flushSync(() => {
                  setMessages((messages) => {
                    const index = messages.findIndex((m) => m.id === message.id);
                    if (index !== -1) {
                      const updatedMessage: ChatMessage = {
                        ...message,
                        parts: updatedParts,
                      };
                      return [...messages.slice(0, index), updatedMessage, ...messages.slice(index + 1)];
                    }
                    return messages;
                  });
                });

                setMode('view');
                toast.success('Message updated.');
              } else {
                // User message: delete + regenerate flow
                await deleteTrailingMessages({
                  id: message.id,
                });

                flushSync(() => {
                  setMessages((messages) => {
                    const index = messages.findIndex((m) => m.id === message.id);

                    if (index !== -1) {
                      const updatedMessage: ChatMessage = {
                        ...message,
                        parts: [{ type: 'text', text: draftContent }],
                      };

                      return [...messages.slice(0, index), updatedMessage];
                    }

                    return messages;
                  });
                });

                setMode('view');
                regenerate();
                toast.success('Updated message and regenerating reply...');
              }
            } catch {
              toast.error(isAssistant ? 'Failed to update message.' : 'Failed to resend from this message.');
            } finally {
              setIsSubmitting(false);
            }
          }}
        >
          {isSubmitting ? 'Saving...' : isAssistant ? 'Save' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
