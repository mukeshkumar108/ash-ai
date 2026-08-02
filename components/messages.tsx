import { PreviewMessage, ThinkingMessage } from './message';
import { Greeting } from './greeting';
import { memo, useEffect, useMemo, useState } from 'react';
import type { Vote } from '@/lib/db/schema';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { motion } from 'framer-motion';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage } from '@/lib/types';
import { Button } from './ui/button';
import { sanitizeText } from '@/lib/utils';

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
  nextSceneDirective?: string;
  continueSceneDirective?: string;
}

const COLLAPSED_RECENT_MESSAGES = 36;
const MIN_VISIBLE_SCENES = 2;

type SceneChunk = {
  key: string;
  label: string;
  messages: ChatMessage[];
};

function getSceneDirectiveLabel(
  message: ChatMessage,
  nextSceneDirective?: string,
  continueSceneDirective?: string,
) {
  const text = sanitizeText(
    message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' '),
  ).trim();

  if (
    nextSceneDirective &&
    text === sanitizeText(nextSceneDirective).trim()
  ) {
    return 'Next Scene';
  }

  if (
    continueSceneDirective &&
    text === sanitizeText(continueSceneDirective).trim()
  ) {
    return 'Continue Scene';
  }

  return null;
}

function buildSceneChunks(
  messages: ChatMessage[],
  nextSceneDirective?: string,
  continueSceneDirective?: string,
) {
  const chunks: SceneChunk[] = [];
  let currentChunk: SceneChunk = {
    key: 'scene-0',
    label: 'Opening Scene',
    messages: [],
  };

  messages.forEach((message) => {
    const sceneLabel = getSceneDirectiveLabel(
      message,
      nextSceneDirective,
      continueSceneDirective,
    );

    if (sceneLabel && currentChunk.messages.length > 0) {
      chunks.push(currentChunk);
      currentChunk = {
        key: `${sceneLabel.toLowerCase().replace(/\s+/g, '-')}-${message.id}`,
        label: sceneLabel,
        messages: [message],
      };
      return;
    }

    currentChunk.messages.push(message);
  });

  if (currentChunk.messages.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
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
  nextSceneDirective,
  continueSceneDirective,
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
  const [expandedSceneKeys, setExpandedSceneKeys] = useState<string[]>([]);

  useEffect(() => {
    setExpandedSceneKeys([]);
  }, [chatId]);

  const sceneChunks = useMemo(
    () =>
      buildSceneChunks(messages, nextSceneDirective, continueSceneDirective),
    [messages, nextSceneDirective, continueSceneDirective],
  );

  const visibleSceneStartIndex = useMemo(() => {
    let visibleMessages = 0;
    let visibleScenes = 0;
    let startIndex = Math.max(sceneChunks.length - 1, 0);

    for (let index = sceneChunks.length - 1; index >= 0; index--) {
      visibleMessages += sceneChunks[index].messages.length;
      visibleScenes += 1;
      startIndex = index;

      if (
        visibleMessages >= COLLAPSED_RECENT_MESSAGES &&
        visibleScenes >= MIN_VISIBLE_SCENES
      ) {
        break;
      }
    }

    return startIndex;
  }, [sceneChunks]);

  const hiddenSceneChunks = sceneChunks.slice(0, visibleSceneStartIndex);
  const visibleSceneChunks = sceneChunks.slice(visibleSceneStartIndex);

  const renderSceneMessages = (scene: SceneChunk) =>
    scene.messages.map((message, index) => {
      const isThreadLastMessage = message.id === messages[messages.length - 1]?.id;

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
          nextSceneDirective={nextSceneDirective}
          continueSceneDirective={continueSceneDirective}
          requiresScrollPadding={
            hasSentMessage && isThreadLastMessage && index === scene.messages.length - 1
          }
        />
      );
    });

  const revealScene = (sceneKey: string) => {
    setExpandedSceneKeys((current) =>
      current.includes(sceneKey) ? current : [...current, sceneKey],
    );
  };

  return (
    <div
      ref={messagesContainerRef}
      className="flex flex-col min-w-0 gap-6 flex-1 overflow-y-scroll pt-4 relative"
    >
      {hasOlderMessages ? (
        <div className="w-full mx-auto max-w-3xl px-2 md:px-4">
          <div className="flex justify-center py-1">
            <Button
              type="button"
              variant="outline"
              className="rounded-2xl px-4 py-2 text-xs text-muted-foreground"
              onClick={onLoadOlderMessages}
              disabled={isLoadingOlderMessages}
            >
              {isLoadingOlderMessages ? 'Loading older messages...' : 'Load older messages'}
            </Button>
          </div>
        </div>
      ) : null}

      {messages.length === 0 && <Greeting />}

      {hiddenSceneChunks.map((scene, index) =>
        expandedSceneKeys.includes(scene.key) ? (
          <div key={scene.key} className="flex flex-col gap-6">
            <div className="w-full mx-auto max-w-3xl px-2 md:px-4">
              <div className="flex justify-center py-1">
                <div className="inline-flex items-center rounded-full border border-border/70 bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {scene.label}
                </div>
              </div>
            </div>
            {renderSceneMessages(scene)}
          </div>
        ) : (
          <div key={scene.key} className="w-full mx-auto max-w-3xl px-2 md:px-4">
            <div className="flex justify-center py-1">
              <Button
                type="button"
                variant="outline"
                className="h-auto rounded-2xl px-4 py-2 text-left text-xs text-muted-foreground"
                onClick={() => revealScene(scene.key)}
              >
                Scene {index + 1} · {scene.label} · {scene.messages.length} messages
              </Button>
            </div>
          </div>
        ),
      )}

      {visibleSceneChunks.flatMap(renderSceneMessages)}

      {status === 'submitted' &&
        messages.length > 0 &&
        messages[messages.length - 1].role === 'user' && (
          <ThinkingMessage />
        )}

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
  if (prevProps.nextSceneDirective !== nextProps.nextSceneDirective)
    return false;
  if (prevProps.continueSceneDirective !== nextProps.continueSceneDirective)
    return false;

  return true;
});
