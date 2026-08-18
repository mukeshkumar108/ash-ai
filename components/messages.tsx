import { PreviewMessage, ThinkingMessage } from './message';
import { memo } from 'react';
import type { Vote } from '@/lib/db/schema';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { motion } from 'framer-motion';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage } from '@/lib/types';
import { Button } from './ui/button';

interface MessagesProps {
  chatId: string;
  status: UseChatHelpers<ChatMessage>['status'];
  votes: Array<Vote> | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  voiceReplyIds: Set<string>;
}

function PureMessages({
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  hasOlderMessages,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  voiceReplyIds,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    onViewportEnter,
    onViewportLeave,
    hasSentMessage,
  } = useMessages({
    chatId,
    status,
  });

  const renderMessage = (message: ChatMessage, index: number) => {
    const isThreadLastMessage =
      message.id === messages[messages.length - 1]?.id;

    return (
      <PreviewMessage
        key={message.id}
        chatId={chatId}
        message={message}
        isLoading={status === 'streaming' && isThreadLastMessage}
        vote={
          votes
            ? votes.find((vote) => vote.messageId === message.id)
            : undefined
        }
        setMessages={setMessages}
        regenerate={regenerate}
        isReadonly={isReadonly}
        requiresScrollPadding={
          hasSentMessage && isThreadLastMessage && index === messages.length - 1
        }
        autoGenerateVoice={voiceReplyIds.has(message.id)}
      />
    );
  };

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll pt-4 relative"
    >
      {hasOlderMessages ? (
        <div className="w-full mx-auto max-w-4xl px-2 md:px-4">
          <div className="flex justify-center py-1">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl px-4 py-2 text-xs text-muted-foreground"
              onClick={onLoadOlderMessages}
              disabled={isLoadingOlderMessages}
            >
              {isLoadingOlderMessages
                ? 'Loading older messages...'
                : 'Load older messages'}
            </Button>
          </div>
        </div>
      ) : null}

      {messages.map(renderMessage)}

      {status === 'submitted' &&
        messages.length > 0 &&
        messages[messages.length - 1].role === 'user' && <ThinkingMessage />}

      <motion.div
        ref={messagesEndRef}
        className="shrink-0 min-w-[24px] min-h-[24px]"
        onViewportLeave={onViewportLeave}
        onViewportEnter={onViewportEnter}
      />
    </div>
  );
}

export const Messages = memo(PureMessages, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) return false;
  if (prevProps.messages.length !== nextProps.messages.length) return false;
  if (!equal(prevProps.messages, nextProps.messages)) return false;
  if (!equal(prevProps.votes, nextProps.votes)) return false;
  if (prevProps.chatId !== nextProps.chatId) return false;
  if (prevProps.isReadonly !== nextProps.isReadonly) return false;
  if (prevProps.hasOlderMessages !== nextProps.hasOlderMessages) return false;
  if (prevProps.isLoadingOlderMessages !== nextProps.isLoadingOlderMessages)
    return false;
  if (prevProps.voiceReplyIds !== nextProps.voiceReplyIds) return false;

  return true;
});
