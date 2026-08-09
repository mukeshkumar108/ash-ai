'use client';

import { DefaultChatTransport } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ChatHeader } from '@/components/chat-header';
import type { Vote } from '@/lib/db/schema';
import {
  fetcher,
  fetchWithErrorHandlers,
  generateUUID,
  mergePaginatedMessages,
} from '@/lib/utils';
import { MultimodalInput } from './multimodal-input';
import { Messages } from './messages';
import type { VisibilityType } from './visibility-selector';
import { unstable_serialize } from 'swr/infinite';
import { getChatHistoryPaginationKey } from './sidebar-history';
import { toast } from './toast';
import { useSearchParams } from 'next/navigation';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment, ChatMessage } from '@/lib/types';
import { saveChatModel } from '@/app/(chat)/actions';
import type { UserType } from '@/app/(auth)/auth';

const MESSAGE_PAGE_SIZE = 40;

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
  const [chatModel, setChatModel] = useState<string>(initialChatModel);
  const [hasOlderMessages, setHasOlderMessages] = useState(
    initialHasOlderMessages,
  );
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const voiceTurnPendingRef = useRef(false);
  const initiativeRequestRef = useRef<
    (trigger: 'post_turn' | 'active_idle', anchorMessageId: string) => void
  >(() => {});
  const initiativeTimerRef = useRef<number | null>(null);
  const turnTailTimerRef = useRef<number | null>(null);
  const [voiceReplyIds, setVoiceReplyIds] = useState<Set<string>>(
    () => new Set(),
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
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages.at(-1),
            selectedChatModel: chatModel,
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
      if (turnTailTimerRef.current) {
        window.clearTimeout(turnTailTimerRef.current);
      }
      turnTailTimerRef.current = window.setTimeout(() => {
        initiativeRequestRef.current('post_turn', message.id);
      }, 2800);
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
        'No model completed the reply. Your message is saved; retry it or choose another model.';
      setChatError(message);
      toast({
        type: 'error',
        description: message,
      });
    },
  });

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const initiativeInFlightRef = useRef(false);
  const requestInitiative = useCallback(
    async (trigger: 'post_turn' | 'active_idle', anchorMessageId: string) => {
      if (initiativeInFlightRef.current || status !== 'ready' || isReadonly) {
        return;
      }
      initiativeInFlightRef.current = true;
      try {
        const response = await fetch(`/api/chat/${id}/initiative`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger, anchorMessageId }),
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload.acted && payload.message) {
          setMessages((current) =>
            current.some((entry) => entry.id === payload.message.id)
              ? current
              : [...current, payload.message],
          );
          mutate(unstable_serialize(getChatHistoryPaginationKey));
        } else if (
          trigger === 'active_idle' &&
          typeof payload.retryAfterMs === 'number' &&
          payload.retryAfterMs > 0
        ) {
          initiativeTimerRef.current = window.setTimeout(() => {
            void initiativeRequestRef.current('active_idle', anchorMessageId);
          }, payload.retryAfterMs);
        }
      } catch (error) {
        console.warn('[chat] initiative request failed', error);
      } finally {
        initiativeInFlightRef.current = false;
      }
    },
    [id, isReadonly, mutate, setMessages, status],
  );
  initiativeRequestRef.current = requestInitiative;

  useEffect(
    () => () => {
      if (turnTailTimerRef.current) {
        window.clearTimeout(turnTailTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (initiativeTimerRef.current) {
      window.clearTimeout(initiativeTimerRef.current);
      initiativeTimerRef.current = null;
    }
    if (status !== 'ready' || isReadonly) return;
    const latest = messages.at(-1);
    if (!latest || latest.role !== 'assistant') return;
    const createdAt = latest.metadata?.createdAt
      ? new Date(latest.metadata.createdAt).getTime()
      : Date.now();
    const waitMs = Math.max(1_000, 5 * 60_000 - (Date.now() - createdAt));
    initiativeTimerRef.current = window.setTimeout(() => {
      void requestInitiative('active_idle', latest.id);
    }, waitMs);
    return () => {
      if (initiativeTimerRef.current)
        window.clearTimeout(initiativeTimerRef.current);
    };
  }, [isReadonly, messages, requestInitiative, status]);

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

  const searchParams = useSearchParams();
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

  const handleModelChange = useCallback(
    (newModelId: string) => {
      setChatModel(newModelId);
      void saveChatModel({ id, model: newModelId });
    },
    [id],
  );

  return (
    <>
      <div className="flex h-dvh min-w-0 flex-col bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,_rgba(232,121,249,0.16),_transparent_60%),radial-gradient(ellipse_60%_40%_at_85%_5%,_rgba(167,139,250,0.12),_transparent_60%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(253,248,255,0.98))] pb-[calc(env(safe-area-inset-bottom)+9rem)] dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,_rgba(217,70,239,0.22),_transparent_60%),radial-gradient(ellipse_60%_40%_at_85%_5%,_rgba(139,92,246,0.18),_transparent_60%),linear-gradient(180deg,_rgba(13,11,18,0.98),_rgba(19,15,27,0.98))] mobile-scroll md:pb-0">
        <ChatHeader
          chatId={id}
          selectedModelId={chatModel}
          selectedVisibilityType={initialVisibilityType}
          isReadonly={isReadonly}
          userType={userType}
          onModelChange={handleModelChange}
        />

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

        {chatError ? (
          <div
            className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-3xl items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm"
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

        <form className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-30 flex w-full gap-2 px-4 pb-4 pt-2 md:sticky md:bottom-0 md:mx-auto md:max-w-3xl md:pb-6">
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
              selectedVisibilityType={visibilityType}
              onVoiceTranscript={(transcript) => {
                setInput(transcript);
              }}
            />
          )}
        </form>
      </div>
    </>
  );
}
