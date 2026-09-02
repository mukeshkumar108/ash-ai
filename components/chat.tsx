'use client';

import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import type { Vote } from '@/lib/db/schema';
import { AnimatePresence, motion } from 'framer-motion';
import {
  cn,
  fetcher,
  fetchWithErrorHandlers,
  generateUUID,
  mergePaginatedMessages,
} from '@/lib/utils';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import { Greeting } from './greeting';
import { AnimatedBackground } from './animated-background';
import type { VisibilityType } from './visibility-selector';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import { useSearchParams } from 'next/navigation';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment, ChatMessage } from '@/lib/types';
import type { UserType } from '@/app/(auth)/auth';

const MESSAGE_PAGE_SIZE = 40;
const OPEN_CHAT_RECONCILE_INTERVAL_MS = 20_000;

export function Chat({
  id,
  initialMessages,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  userType,
  autoResume,
  initialHasOlderMessages = false,
}: {
  id: string;
  initialMessages: ChatMessage[];
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  userType: UserType;
  autoResume: boolean;
  initialHasOlderMessages?: boolean;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });

  const { mutate } = useSWRConfig();
  const reconcileInFlightRef = useRef(false);
  const missingReplyWatchdogRef = useRef<number | null>(null);
  const lastReconcileTimeRef = useRef(0);

  const [input, setInput] = useState<string>('');
  const [chatModel] = useState<string>(initialChatModel);
  const searchParams = useSearchParams();
  const developerModelOverride = searchParams.get('devModel') || undefined;
  const [hasOlderMessages, setHasOlderMessages] = useState(
    initialHasOlderMessages,
  );
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const voiceTurnPendingRef = useRef(false);
  const [voiceReplyIds, setVoiceReplyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const instrumentedChatFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const startedAt = performance.now();
      const response = await fetchWithErrorHandlers(input, init);
      if (!response.body) return response;
      let buffer = '';
      let reported = false;
      let turnId: string | null = null;
      if (typeof init?.body === 'string') {
        try {
          const body = JSON.parse(init.body) as {
            message?: { id?: unknown };
          };
          turnId =
            typeof body.message?.id === 'string' ? body.message.id : null;
        } catch {
          turnId = null;
        }
      }
      const decoder = new TextDecoder();
      const observed = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            if (!reported) {
              buffer =
                `${buffer}${decoder.decode(chunk, { stream: true })}`.slice(
                  -16_000,
                );
              if (buffer.includes('"type":"text-delta"')) {
                reported = true;
                const clientTtftMs = performance.now() - startedAt;
                const payload = JSON.stringify({
                  id,
                  turnId,
                  chatId: id,
                  clientTtftMs,
                });
                if (typeof navigator.sendBeacon === 'function') {
                  navigator.sendBeacon(
                    '/api/telemetry/chat',
                    new Blob([payload], { type: 'application/json' }),
                  );
                } else {
                  void fetch('/api/telemetry/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true,
                  });
                }
              }
            }
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(observed, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
    [id],
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: instrumentedChatFetch,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: chatModel,
            ...(developerModelOverride ? { developerModelOverride } : {}),
            selectedVisibilityType: visibilityType,
            ...body,
          },
        };
      },
    }),
    onFinish: ({ message }) => {
      setChatError(null);
      if (voiceTurnPendingRef.current) {
        voiceTurnPendingRef.current = false;
        setVoiceReplyIds((current) => new Set(current).add(message.id));
      }
      mutate(unstable_serialize(getChatHistoryPaginationKey));
      setTimeout(() => {
        void reconcileChatFromServer();
      }, 1500);
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        setChatError(error.message);
        toast({
          type: 'error',
          description: error.message,
        });
        return;
      }

      const message =
        'The reply could not be delivered. Your message is saved; please retry in a moment.';
      setChatError(message);
      toast({
        type: 'error',
        description: message,
      });
    },
  });

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const reconcileChatFromServer = useCallback(async () => {
    // Guard: prevent rapid re-reconciliation loops (3s cooldown)
    const now = Date.now();
    if (now - lastReconcileTimeRef.current < 3000) {
      return;
    }
    lastReconcileTimeRef.current = now;

    if (reconcileInFlightRef.current) {
      return;
    }

    reconcileInFlightRef.current = true;

    try {
      const response = await fetch(
        `/api/chat/${id}/messages?limit=${MESSAGE_PAGE_SIZE}`,
        {
          cache: 'no-store',
        },
      );

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const serverMessages = payload.messages;

      if (Array.isArray(serverMessages)) {
        const currentMessages = messagesRef.current;
        if (serverMessages.length <= currentMessages.length) {
          return;
        }
        const merged = mergePaginatedMessages(currentMessages, serverMessages);
        setMessages(merged);
        setHasOlderMessages(Boolean(payload.hasMore));
      }
    } catch (error) {
      console.error('[chat] failed to reconcile messages from server', error);
    } finally {
      reconcileInFlightRef.current = false;
    }
  }, [id, setMessages]);

  useEffect(() => {
    if (status !== 'ready' || isReadonly) return;
    const reconcileIfVisible = () => {
      if (document.visibilityState === 'visible') {
        void reconcileChatFromServer();
      }
    };
    const interval = window.setInterval(
      reconcileIfVisible,
      OPEN_CHAT_RECONCILE_INTERVAL_MS,
    );
    document.addEventListener('visibilitychange', reconcileIfVisible);
    window.addEventListener('focus', reconcileIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', reconcileIfVisible);
      window.removeEventListener('focus', reconcileIfVisible);
    };
  }, [isReadonly, reconcileChatFromServer, status]);

  const query = searchParams.get('query');

  const [hasAppendedQuery, setHasAppendedQuery] = useState(false);

  useEffect(() => {
    setHasAppendedQuery(false);
    setChatError(null);
  }, [id]);

  useEffect(() => {
    if (status === 'submitted' || status === 'streaming') {
      setChatError(null);
    }
  }, [status]);

  useEffect(() => {
    if (missingReplyWatchdogRef.current) {
      window.clearTimeout(missingReplyWatchdogRef.current);
      missingReplyWatchdogRef.current = null;
    }

    if (status !== 'ready') {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    const lastVisibleText =
      lastMessage?.parts
        ?.filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
        .trim() ?? '';

    const likelyMissingAssistantReply =
      messages.length > 0 && lastMessage?.role === 'user';

    const likelyTruncatedAssistantReply =
      lastMessage?.role === 'assistant' && lastVisibleText.length < 12;

    if (likelyMissingAssistantReply || likelyTruncatedAssistantReply) {
      missingReplyWatchdogRef.current = window.setTimeout(() => {
        void reconcileChatFromServer();
      }, 3000);
    }

    return () => {
      if (missingReplyWatchdogRef.current) {
        window.clearTimeout(missingReplyWatchdogRef.current);
        missingReplyWatchdogRef.current = null;
      }
    };
  }, [messages, reconcileChatFromServer, status]);

  useEffect(() => {
    if (query && !hasAppendedQuery) {
      sendMessage({
        role: 'user' as const,
        parts: [{ type: 'text', text: query }],
      });

      setHasAppendedQuery(true);
      window.history.replaceState({}, '', `/chat/${id}`);
    }
  }, [query, sendMessage, hasAppendedQuery, id]);

  const { data: votes } = useSWR<Array<Vote>>(
    messages.length >= 2 ? `/api/vote?chatId=${id}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    },
  );

  const [attachments, setAttachments] = useState<Array<Attachment>>([]);

  useAutoResume({
    autoResume,
    initialMessages,
    resumeStream,
  });

  const loadOlderMessages = useCallback(async () => {
    const oldestMessageId = messages[0]?.id;

    if (!oldestMessageId || isLoadingOlderMessages || !hasOlderMessages) {
      return;
    }

    setIsLoadingOlderMessages(true);

    try {
      const response = await fetch(
        `/api/chat/${id}/messages?before=${oldestMessageId}&limit=${MESSAGE_PAGE_SIZE}`,
        { cache: 'no-store' },
      );

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const olderMessages = payload.messages;

      if (Array.isArray(olderMessages) && olderMessages.length > 0) {
        setMessages((currentMessages) => [
          ...olderMessages,
          ...currentMessages,
        ]);
      }

      setHasOlderMessages(Boolean(payload.hasMore));
    } catch (error) {
      console.error('[chat] failed to load older messages', error);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [hasOlderMessages, id, isLoadingOlderMessages, messages, setMessages]);

  const isNewChat = messages.length === 0 && status === 'ready';

  const composerContent = (
    <>
      {!isReadonly && (
        <MultimodalInput
          chatId={id}
          input={input}
          setInput={setInput}
          status={status}
          stop={stop}
          attachments={attachments}
          setAttachments={setAttachments}
          messages={messages}
          setMessages={setMessages}
          sendMessage={sendMessage}
          userType={userType}
          onVoiceTranscript={(transcript) => {
            setInput(transcript);
          }}
        />
      )}
      <p className="hidden pt-1 text-center text-xs text-muted-foreground/70 md:block">
        Sophie may be inaccurate. Verify important information.
      </p>
    </>
  );

  return (
    <>
      <div
        className={cn(
          'relative flex h-dvh min-w-0 flex-col overflow-hidden bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,_rgba(224,126,170,0.08),_transparent_60%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(255,255,255,0.98))] mobile-scroll md:pb-0 dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,_rgba(215,102,150,0.12),_transparent_60%),radial-gradient(ellipse_55%_40%_at_88%_2%,_rgba(215,102,150,0.06),_transparent_60%),linear-gradient(180deg,_rgba(30,27,24,0.98),_rgba(27,24,22,0.98))]',
          !isNewChat ? 'pb-[calc(env(safe-area-inset-bottom)+9rem)]' : '',
        )}
      >
        <AnimatedBackground />
        <ChatHeader
          chatId={id}
          selectedModelId={chatModel}
          selectedVisibilityType={initialVisibilityType}
          isReadonly={isReadonly}
          userType={userType}
        />

        {!isNewChat && (
          <Messages
            chatId={id}
            status={status}
            votes={votes}
            messages={messages}
            setMessages={setMessages}
            regenerate={regenerate}
            isReadonly={isReadonly}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlderMessages={isLoadingOlderMessages}
            onLoadOlderMessages={loadOlderMessages}
            voiceReplyIds={voiceReplyIds}
          />
        )}

        {chatError ? (
          <div
            className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-4xl items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm"
            role="alert"
          >
            <span>{chatError}</span>
            <button
              type="button"
              className="shrink-0 rounded-xl border border-red-500/30 bg-background px-3 py-1.5 font-medium hover:bg-red-500/10"
              onClick={() => {
                setChatError(null);
                void regenerate();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        <motion.div
          initial={false}
          className={cn(
            'z-30 flex w-full flex-col gap-1.5 px-4 pb-4 pt-2',
            isNewChat
              ? 'flex-1 items-center justify-center overflow-y-auto pb-8 pt-4'
              : 'fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] md:sticky md:bottom-0 md:mx-auto md:max-w-4xl md:pb-6',
          )}
        >
          <motion.div
            key={isNewChat ? 'centered' : 'bottom'}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="relative w-full max-w-4xl"
          >
            <AnimatePresence mode="wait">
              {isNewChat && (
                <motion.div
                  key="empty-greeting"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                  className="pointer-events-none absolute inset-x-0 -top-36 flex justify-center"
                >
                  <Greeting />
                </motion.div>
              )}
            </AnimatePresence>
            <form className="w-full">{composerContent}</form>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
