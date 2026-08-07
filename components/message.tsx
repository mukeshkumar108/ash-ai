'use client';
import cx from 'classnames';
import { AnimatePresence, motion } from 'framer-motion';
import { memo, useState, useEffect } from 'react';
import type { Vote } from '@/lib/db/schema';
import { PencilEditIcon, SparklesIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { MessageEditor } from './message-editor';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage } from '@/lib/types';
import {
  getThinkingMessage,
  type ThinkingStage,
} from '@/lib/constants/thinking-messages';
import { AnimatedText } from './animated-text';
import { MessageContent } from './message-content';
import { MessageActions } from './message-actions';
import { ResearchTraceView } from './research-trace';

const PurePreviewMessage = ({
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === 'file',
  );

  return (
    <AnimatePresence>
      <motion.div
        data-testid={`message-${message.role}`}
        className="w-full mx-auto max-w-3xl px-2 md:px-4 group/message"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role={message.role}
      >
        <div
          className={cn(
            'flex gap-2 md:gap-4 w-full group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl',
            {
              'w-full': mode === 'edit',
              'group-data-[role=user]/message:w-fit': mode !== 'edit',
            },
          )}
        >
          {message.role === 'assistant' && (
            <div className="hidden md:flex size-8 items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background">
              <div className="translate-y-px">
                <SparklesIcon size={14} />
              </div>
            </div>
          )}

          <div
            className={cn('flex flex-col gap-3 md:gap-4 w-full', {
              'min-h-40 md:min-h-96':
                message.role === 'assistant' && requiresScrollPadding,
            })}
          >
            {attachmentsFromMessage.length > 0 && (
              <div
                data-testid={`message-attachments`}
                className="flex flex-row justify-end gap-2"
              >
                {attachmentsFromMessage.map((attachment) => (
                  <PreviewAttachment
                    key={attachment.url}
                    attachment={{
                      name: attachment.filename ?? 'file',
                      contentType: attachment.mediaType,
                      url: attachment.url,
                    }}
                  />
                ))}
              </div>
            )}

            {message.parts?.map((part, index) => {
              const { type } = part;
              const key = `message-${message.id}-part-${index}`;

              if (type === 'reasoning' && part.text?.trim().length > 0) {
                /* Hide reasoning from users - only used for internal processing */
                return null;
              }

              if (type === 'data-research') {
                return <ResearchTraceView key={key} trace={part.data} />;
              }

              if (type === 'text') {
                if (mode === 'view') {
                  return (
                    <div
                      key={key}
                      className="flex flex-row gap-2 items-start text-message-part"
                    >
                      {message.role === 'user' && !isReadonly && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              data-testid="message-edit-button"
                              variant="ghost"
                              className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                              onClick={() => {
                                setMode('edit');
                              }}
                            >
                              <PencilEditIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit message</TooltipContent>
                        </Tooltip>
                      )}

                      {message.role === 'assistant' && !isReadonly && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              className="px-2 h-fit rounded-full text-muted-foreground opacity-0 group-hover/message:opacity-100"
                              onClick={() => {
                                setMode('edit');
                              }}
                            >
                              <PencilEditIcon />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit reply</TooltipContent>
                        </Tooltip>
                      )}

                      <div
                        data-testid="message-content"
                        className="flex flex-col gap-4 w-full"
                      >
                        <MessageContent
                          text={sanitizeText(part.text)}
                          role={message.role as 'user' | 'assistant'}
                        />
                        {message.role === 'assistant' && (
                          <div className="pl-1">
                            <MessageActions
                              message={message}
                              isLoading={isLoading}
                              setMessages={setMessages}
                              regenerate={regenerate}
                              isReadonly={isReadonly}
                              setMode={setMode}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                if (mode === 'edit') {
                  return (
                    <div key={key} className="flex flex-row gap-2 items-start">
                      {message.role === 'assistant' && (
                        <div className="hidden md:block size-8" />
                      )}

                      <MessageEditor
                        key={message.id}
                        message={message}
                        chatId={chatId}
                        setMode={setMode}
                        setMessages={setMessages}
                        regenerate={regenerate}
                      />
                    </div>
                  );
                }
              }

              return null;
            })}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (!equal(prevProps.vote, nextProps.vote)) return false;
    if (prevProps.message.role !== nextProps.message.role) return false;
    if (prevProps.isReadonly !== nextProps.isReadonly) return false;

    return true;
  },
);

export const ThinkingMessage = () => {
  const [currentStage, setCurrentStage] = useState<ThinkingStage>('thinking');
  const [messageIndex, setMessageIndex] = useState(0);
  const role = 'assistant';

  // Cycle through stages: thinking → processing → generating
  useEffect(() => {
    const stages: ThinkingStage[] = ['thinking', 'processing', 'generating'];
    let stageIndex = 0;

    const stageInterval = setInterval(() => {
      setCurrentStage(stages[stageIndex % stages.length]);
      setMessageIndex((prev) => (prev + 1) % 12); // Rotate through messages
      stageIndex++;
    }, 4000); // Change every 4 seconds

    return () => clearInterval(stageInterval);
  }, []);

  const currentMessage = getThinkingMessage(currentStage, messageIndex);

  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full mx-auto max-w-3xl px-2 md:px-4 group/message min-h-40 md:min-h-96"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 0.5 } }}
      data-role={role}
    >
      <div
        className={cx(
          'flex gap-4 group-data-[role=user]/message:px-3 w-full group-data-[role=user]/message:w-fit group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl group-data-[role=user]/message:py-2 rounded-xl',
          {
            'group-data-[role=user]/message:bg-muted': true,
          },
        )}
      >
        <div className="hidden md:flex size-8 items-center rounded-full justify-center ring-1 shrink-0 ring-border bg-background animate-bounce">
          <div className="translate-y-px text-primary">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 text-muted-foreground">
            <div className="content-scroll-container">
              <AnimatedText
                text={currentMessage}
                speed={40}
                className="text-sm font-medium"
              />
            </div>
          </div>

          {/* Animated progress dots */}
          <div className="flex space-x-1 mt-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-2 h-2 bg-primary rounded-full"
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Number.POSITIVE_INFINITY,
                  delay: i * 0.2,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
