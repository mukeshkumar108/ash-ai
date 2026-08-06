'use client';

import { useEffect, useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  describeIntegrationFailure,
  extractEmailAddress,
  getThreadMessagePlainText,
  replySubject,
  writeErrorMessage,
  writeRequest,
  type GmailDraftDetail,
  type GmailThreadDetail,
  type GmailThreadMessage,
  type IntegrationDataResponse,
  type IntegrationFailureReason,
} from '@/lib/integrations';

type ThreadState =
  | { state: 'loading' }
  | { state: 'ready'; thread: GmailThreadDetail }
  | { state: 'failure'; reason: IntegrationFailureReason };

type ReplyState =
  | { state: 'idle' }
  | { state: 'creating' }
  | { state: 'success'; draftId: string }
  | { state: 'error'; text: string };

function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes === null || sizeBytes < 0) {
    return '';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReplyDraftForm({
  message,
  threadId,
  onClose,
}: {
  message: GmailThreadMessage;
  threadId: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState(() => extractEmailAddress(message.sender) ?? '');
  const [subject, setSubject] = useState(() => replySubject(message.subject));
  const [body, setBody] = useState('');
  const [state, setState] = useState<ReplyState>({ state: 'idle' });

  const handleCreate = async () => {
    setState({ state: 'creating' });

    const result = await writeRequest<GmailDraftDetail>(
      '/api/integrations/google/gmail/drafts',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: to
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
          subject,
          plainTextBody: body,
          replyToMessageId: message.messageId,
          threadId,
        }),
      },
    );

    if (result.ok) {
      setState({ state: 'success', draftId: result.data.draftId });
    } else {
      setState({ state: 'error', text: writeErrorMessage(result) });
    }
  };

  if (state.state === 'success') {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm text-green-600">
          Saved to Gmail Drafts (draft {state.draftId})
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={onClose}
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm font-medium text-foreground">Draft reply</p>
      <div className="space-y-1">
        <Label htmlFor="reply-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="reply-to"
          className="bg-muted text-sm"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          disabled={state.state === 'creating'}
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor="reply-subject"
          className="text-xs text-muted-foreground"
        >
          Subject
        </Label>
        <Input
          id="reply-subject"
          className="bg-muted text-sm"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          disabled={state.state === 'creating'}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="reply-body" className="text-xs text-muted-foreground">
          Response
        </Label>
        <Textarea
          id="reply-body"
          className="bg-muted text-sm min-h-[100px]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={state.state === 'creating'}
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={handleCreate}
          disabled={state.state === 'creating'}
        >
          {state.state === 'creating' ? 'Creating...' : 'Create reply draft'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={state.state === 'creating'}
        >
          Cancel
        </Button>
      </div>
      {state.state === 'error' && (
        <p className="text-sm text-red-600">{state.text}</p>
      )}
    </div>
  );
}

export function GmailThreadDrawer({
  threadId,
  onClose,
}: {
  threadId: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<ThreadState>({ state: 'loading' });
  const [replyingToMessageId, setReplyingToMessageId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!threadId) {
      return;
    }

    let cancelled = false;
    setState({ state: 'loading' });

    fetch(
      `/api/integrations/google/gmail/threads/${encodeURIComponent(threadId)}`,
      { cache: 'no-store' },
    )
      .then((response) => response.json())
      .then((body: IntegrationDataResponse<{ thread: GmailThreadDetail }>) => {
        if (cancelled) {
          return;
        }

        if (body.ok) {
          setState({ state: 'ready', thread: body.data.thread });
        } else {
          setState({ state: 'failure', reason: body.reason });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ state: 'failure', reason: 'unavailable' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const subject =
    state.state === 'ready'
      ? (state.thread.messages[0]?.subject ?? '(no subject)')
      : '';

  return (
    <Sheet
      open={threadId !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {state.state === 'ready' ? subject : 'Thread'}
          </SheetTitle>
          <SheetDescription>
            {state.state === 'ready'
              ? `${state.thread.messages.length} message${
                  state.thread.messages.length === 1 ? '' : 's'
                }`
              : 'Gmail thread'}
          </SheetDescription>
        </SheetHeader>

        {state.state === 'loading' && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading thread...
          </p>
        )}

        {state.state === 'failure' && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {describeIntegrationFailure(state.reason)}
          </p>
        )}

        {state.state === 'ready' && (
          <div className="mt-4 space-y-6">
            {state.thread.messages.map((message) => (
              <article
                key={message.messageId}
                className="rounded-lg border bg-card p-4"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {message.sender || 'Unknown sender'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {message.date}
                  </p>
                </div>
                <p className="break-words text-sm text-foreground whitespace-pre-wrap">
                  {getThreadMessagePlainText(message)}
                </p>
                {message.attachments.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {message.attachments.map((attachment, index) => (
                      <li
                        key={`${message.messageId}-${attachment.attachmentId ?? index}`}
                        className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                      >
                        <span className="truncate">
                          {attachment.filename ?? 'attachment'}
                        </span>
                        <span className="shrink-0">
                          {formatBytes(attachment.sizeBytes)}
                          {attachment.sizeBytes !== null ? ' · ' : ''}
                          {attachment.mimeType ?? 'unknown type'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setReplyingToMessageId(message.messageId)}
                >
                  Draft reply
                </Button>
                {replyingToMessageId === message.messageId && (
                  <div className="mt-3">
                    <ReplyDraftForm
                      message={message}
                      threadId={state.thread.threadId}
                      onClose={() => setReplyingToMessageId(null)}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
