'use client';

import type { UIMessage } from 'ai';
import cx from 'classnames';
import type React from 'react';
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';

import { ArrowUpIcon, PlusIcon, StopIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { getBlobPathname } from '@/lib/blob';
import {
  FILE_ACCEPT_ATTR,
  ImageProcessingError,
  processImageFile,
  type ProcessedImage,
} from '@/lib/image-processing';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, Clapperboard, FileText, ImagePlus, X } from 'lucide-react';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import type { VisibilityType } from './visibility-selector';
import type { Attachment, ChatMessage } from '@/lib/types';
import { VoiceRecorder } from './voice-recorder';
import type { TranscriptReliability } from '@/lib/transcript-reliability';

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,video/x-m4v';
const DOCUMENT_ACCEPT =
  'application/pdf,text/plain,text/markdown,text/csv,application/json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html';

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  onVoiceTranscript,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>['status'];
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<UIMessage>;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  className?: string;
  selectedVisibilityType: VisibilityType;
  onVoiceTranscript?: (transcript: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

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

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = '98px';
    }
  };

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    `input:${chatId}`,
    '',
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustHeight();
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [fileAccept, setFileAccept] = useState(FILE_ACCEPT_ATTR);
  const [transcriptReliability, setTranscriptReliability] =
    useState<TranscriptReliability | null>(null);

  type PendingAttachment = {
    id: string;
    name: string;
    state: 'processing' | 'uploading' | 'failed';
    error?: string;
  };

  type TextAttachment = {
    id: string;
    name: string;
    content: string;
  };

  // Pasted text longer than this becomes an attached document instead of going
  // into the composer input. Matches the original server-side per-part limit.
  const TEXT_ATTACH_THRESHOLD = 2000;

  const [pending, setPending] = useState<Array<PendingAttachment>>([]);
  const [textAttachments, setTextAttachments] = useState<Array<TextAttachment>>(
    [],
  );
  const abortRefs = useRef(new Map<string, AbortController>());
  const cancelledRef = useRef(new Set<string>());

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const text = event.clipboardData.getData('text');
      if (!text || text.length <= TEXT_ATTACH_THRESHOLD) return;

      event.preventDefault();
      const trimmed = text.trim();
      if (!trimmed) return;

      const id = createId();
      const name = `pasted-text-${new Date().toISOString().slice(0, 10)}.txt`;
      setTextAttachments((current) => [
        ...current,
        { id, name, content: trimmed },
      ]);
      toast(
        `Pasted text attached as ${name} (${trimmed.length.toLocaleString()} chars)`,
      );
    },
    [],
  );

  const removeTextAttachment = useCallback((id: string) => {
    setTextAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const createId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const updatePending = useCallback(
    (id: string, patch: Partial<PendingAttachment>) => {
      setPending((current) =>
        current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const removePending = useCallback((id: string) => {
    setPending((current) => current.filter((item) => item.id !== id));
  }, []);

  const deleteBlob = useCallback(async (pathname: string) => {
    try {
      await fetch(`/api/files?pathname=${encodeURIComponent(pathname)}`, {
        method: 'DELETE',
      });
    } catch {
      // Best-effort cleanup of abandoned uploads.
    }
  }, []);

  const processAndUpload = useCallback(
    async (file: File, id: string) => {
      const controller = new AbortController();
      abortRefs.current.set(id, controller);

      try {
        let processed: ProcessedImage;
        if (file.type.startsWith('image/')) {
          try {
            processed = await processImageFile(file, controller.signal);
          } catch (error) {
            if (cancelledRef.current.has(id)) return;
            const message =
              error instanceof ImageProcessingError
                ? error.message
                : 'This image could not be processed.';
            updatePending(id, { state: 'failed', error: message });
            toast.error(message);
            return;
          }
        } else {
          processed = { file, sourceType: file.type, outputType: file.type };
        }

        if (cancelledRef.current.has(id)) return;

        updatePending(id, { state: 'uploading' });

        const formData = new FormData();
        formData.append('file', processed.file, processed.file.name);

        const response = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        if (cancelledRef.current.has(id)) {
          if (response.ok) {
            const data = await response.json().catch(() => null);
            if (data?.pathname) void deleteBlob(data.pathname);
          }
          return;
        }

        if (!response.ok) {
          const { error } = await response
            .json()
            .catch(() => ({ error: 'Upload failed' }));
          throw new Error(error || 'Upload failed');
        }

        const data = await response.json();

        if (cancelledRef.current.has(id)) {
          void deleteBlob(data.pathname);
          return;
        }

        removePending(id);
        setAttachments((currentAttachments) => [
          ...currentAttachments,
          {
            url: data.url,
            name: data.pathname,
            contentType: data.contentType,
            id,
          },
        ]);
      } catch (error) {
        if (cancelledRef.current.has(id)) return;
        const message =
          error instanceof Error ? error.message : 'Failed to upload file.';
        updatePending(id, { state: 'failed', error: message });
        toast.error(message);
      } finally {
        abortRefs.current.delete(id);
        cancelledRef.current.delete(id);
      }
    },
    [deleteBlob, removePending, setAttachments, updatePending],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      cancelledRef.current.add(id);
      abortRefs.current.get(id)?.abort();

      setAttachments((currentAttachments) => {
        const target = currentAttachments.find(
          (attachment) => attachment.id === id,
        );
        if (target?.url) void deleteBlob(getBlobPathname(target.url));
        return currentAttachments.filter((attachment) => attachment.id !== id);
      });

      setPending((current) => current.filter((item) => item.id !== id));
    },
    [deleteBlob],
  );

  const replaceAttachment = useCallback((id: string) => {
    replaceTargetRef.current = id;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';

      if (files.length === 0) return;

      const replaceTargetId = replaceTargetRef.current;
      if (replaceTargetId !== null) {
        replaceTargetRef.current = null;
        removeAttachment(replaceTargetId);
      }

      for (const file of files) {
        const id = createId();
        setPending((current) => [
          ...current,
          { id, name: file.name, state: 'processing' },
        ]);
        void processAndUpload(file, id);
      }
    },
    [processAndUpload, removeAttachment],
  );

  const uploadQueue = pending
    .filter((item) => item.state !== 'failed')
    .map((item) => item.name);

  const submitForm = useCallback(() => {
    window.history.replaceState({}, '', `/chat/${chatId}`);

    sendMessage({
      role: 'user',
      parts: [
        ...attachments.map((attachment) => ({
          type: 'file' as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        ...textAttachments.map((doc) => ({
          type: 'text' as const,
          text: `[Attached document: ${doc.name}]\n${doc.content}`,
        })),
        ...(transcriptReliability
          ? [
              {
                type: 'data-transcriptReliability' as const,
                data: transcriptReliability,
              },
            ]
          : []),
        {
          type: 'text',
          text: input,
        },
      ],
    });

    setAttachments([]);
    setTextAttachments([]);
    setLocalStorageInput('');
    resetHeight();
    setInput('');
    setTranscriptReliability(null);

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    textAttachments,
    transcriptReliability,
    sendMessage,
    setAttachments,
    setTextAttachments,
    setLocalStorageInput,
    width,
    chatId,
  ]);

  const { isAtBottom, scrollToBottom } = useScrollToBottom();

  useEffect(() => {
    if (status === 'submitted') {
      scrollToBottom();
    }
  }, [status, scrollToBottom]);

  return (
    <div ref={composerRef} className="relative w-full flex flex-col gap-4">
      <AnimatePresence>
        {!isAtBottom && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="absolute left-1/2 bottom-28 -translate-x-1/2 z-50"
          >
            <Button
              data-testid="scroll-to-bottom-button"
              className="rounded-full"
              size="icon"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                scrollToBottom();
              }}
            >
              <ArrowDown />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        type="file"
        accept={fileAccept}
        className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {(attachments.length > 0 ||
        pending.length > 0 ||
        textAttachments.length > 0) && (
        <div
          data-testid="attachments-preview"
          className="flex flex-row gap-2 overflow-x-scroll items-end"
        >
          {textAttachments.map((doc) => (
            <div
              key={doc.id}
              data-testid="text-attachment-preview"
              className="flex flex-col gap-1"
            >
              <div className="flex flex-row items-center gap-2 rounded-md border border-border/70 bg-muted/50 px-3 py-2 max-w-56">
                <FileText
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate">
                    {doc.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatBytes(new Blob([doc.content]).size)}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="remove-text-attachment-button"
                  aria-label="Remove attached text"
                  onClick={() => removeTextAttachment(doc.id)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}

          {attachments.map((attachment) => (
            <PreviewAttachment
              key={attachment.url}
              attachment={attachment}
              onRemove={
                attachment.id
                  ? () => removeAttachment(attachment.id as string)
                  : undefined
              }
              onReplace={
                attachment.id
                  ? () => replaceAttachment(attachment.id as string)
                  : undefined
              }
            />
          ))}

          {pending.map((item) => (
            <PreviewAttachment
              key={item.id}
              pending={{
                name: item.name,
                state: item.state,
                error: item.error,
              }}
              onRemove={() => removeAttachment(item.id)}
            />
          ))}
        </div>
      )}

      <Textarea
        data-testid="multimodal-input"
        ref={textareaRef}
        placeholder="Send a message..."
        value={input}
        onChange={handleInput}
        onPaste={handlePaste}
        className={cx(
          'min-h-[24px] max-h-[calc(75dvh)] overflow-hidden resize-none rounded-2xl bg-muted pb-10 dark:border-zinc-700 chat-input input-typography',
          className,
        )}
        rows={2}
        autoFocus
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();

            if (status !== 'ready') {
              toast.error('Please wait for the model to finish its response!');
            } else {
              submitForm();
            }
          }
        }}
      />

      <div className="absolute bottom-0 left-0 p-2 w-fit flex flex-row items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="attachments-button"
              className="rounded-md rounded-bl-lg p-[7px] h-fit dark:border-zinc-700 hover:dark:bg-zinc-900 hover:bg-zinc-200"
              onClick={(event) => {
                event.preventDefault();
              }}
              disabled={status !== 'ready'}
              variant="ghost"
              aria-label="Attach files"
            >
              <PlusIcon size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuItem
              data-testid="attach-image-option"
              onSelect={() => {
                setFileAccept(FILE_ACCEPT_ATTR);
                fileInputRef.current?.click();
              }}
            >
              <ImagePlus size={14} className="mr-2" />
              Attach image
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="attach-video-option"
              onSelect={() => {
                setFileAccept(VIDEO_ACCEPT);
                fileInputRef.current?.click();
              }}
            >
              <Clapperboard size={14} className="mr-2" />
              Attach video
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="attach-document-option"
              onSelect={() => {
                setFileAccept(DOCUMENT_ACCEPT);
                fileInputRef.current?.click();
              }}
            >
              <FileText size={14} className="mr-2" />
              Attach document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row items-center justify-end gap-1">
        {onVoiceTranscript ? (
          <VoiceRecorder
            chatId={chatId}
            disabled={status !== 'ready'}
            onTranscript={(result) => {
              setTranscriptReliability(result.reliability);
              onVoiceTranscript(result.transcript);
            }}
            containerRef={composerRef}
          />
        ) : null}
        {status === 'submitted' ? (
          <StopButton stop={stop} setMessages={setMessages} />
        ) : (
          <SendButton
            input={input}
            submitForm={submitForm}
            uploadQueue={uploadQueue}
            hasAttachments={textAttachments.length > 0}
          />
        )}
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.status !== nextProps.status) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType)
      return false;
    if (prevProps.onVoiceTranscript !== nextProps.onVoiceTranscript)
      return false;

    return true;
  },
);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
}) {
  return (
    <Button
      data-testid="stop-button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);

function PureSendButton({
  submitForm,
  input,
  uploadQueue,
  hasAttachments = false,
}: {
  submitForm: () => void;
  input: string;
  uploadQueue: Array<string>;
  hasAttachments?: boolean;
}) {
  return (
    <Button
      data-testid="send-button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={
        (input.length === 0 && !hasAttachments) || uploadQueue.length > 0
      }
    >
      <ArrowUpIcon size={14} />
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.uploadQueue.length !== nextProps.uploadQueue.length)
    return false;
  if (prevProps.input !== nextProps.input) return false;
  if (prevProps.hasAttachments !== nextProps.hasAttachments) return false;
  return true;
});
