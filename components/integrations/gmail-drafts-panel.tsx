'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  parseRecipientList,
  writeErrorMessage,
  writeRequest,
  type GmailDraftDetail,
} from '@/lib/integrations';

type BusyAction = 'create' | 'get' | 'update' | 'delete' | null;

type Notice = { kind: 'success' | 'error'; text: string } | null;

export function GmailDraftsPanel() {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const [currentDraft, setCurrentDraft] = useState<GmailDraftDetail | null>(
    null,
  );
  const [busy, setBusy] = useState<BusyAction>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const draftUrl = currentDraft
    ? `/api/integrations/google/gmail/drafts/${encodeURIComponent(currentDraft.draftId)}`
    : null;

  const applyDraftToForm = (draft: GmailDraftDetail) => {
    setTo(draft.to.join(', '));
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setSubject(draft.subject);
    setBody(draft.plainTextBody ?? '');
  };

  const handleCreate = async () => {
    setBusy('create');
    setNotice(null);

    const result = await writeRequest<GmailDraftDetail>(
      '/api/integrations/google/gmail/drafts',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: parseRecipientList(to),
          cc: parseRecipientList(cc),
          bcc: parseRecipientList(bcc),
          subject,
          plainTextBody: body,
        }),
      },
    );

    setBusy(null);

    if (result.ok) {
      setCurrentDraft(result.data);
      applyDraftToForm(result.data);
      setNotice({ kind: 'success', text: 'Saved to Gmail Drafts' });
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const handleGet = async () => {
    if (!draftUrl) {
      setNotice({ kind: 'error', text: 'Create a draft first.' });
      return;
    }

    setBusy('get');
    setNotice(null);

    const result = await writeRequest<GmailDraftDetail>(draftUrl, {
      cache: 'no-store',
    });

    setBusy(null);

    if (result.ok) {
      setCurrentDraft(result.data);
      applyDraftToForm(result.data);
      setNotice({ kind: 'success', text: 'Draft retrieved.' });
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const handleUpdate = async () => {
    if (!draftUrl) {
      setNotice({ kind: 'error', text: 'Create a draft first.' });
      return;
    }

    setBusy('update');
    setNotice(null);

    const result = await writeRequest<GmailDraftDetail>(draftUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: parseRecipientList(to),
        cc: parseRecipientList(cc),
        bcc: parseRecipientList(bcc),
        subject,
        plainTextBody: body,
      }),
    });

    setBusy(null);

    if (result.ok) {
      setCurrentDraft(result.data);
      applyDraftToForm(result.data);
      setNotice({ kind: 'success', text: 'Draft updated.' });
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const handleDelete = async () => {
    if (!draftUrl) {
      return;
    }

    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setBusy('delete');
    setNotice(null);

    const result = await writeRequest<{ deleted: boolean }>(draftUrl, {
      method: 'DELETE',
    });

    setBusy(null);
    setConfirmingDelete(false);

    if (result.ok) {
      setCurrentDraft(null);
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setBody('');
      setNotice({ kind: 'success', text: 'Draft deleted.' });
    } else {
      setNotice({ kind: 'error', text: writeErrorMessage(result) });
    }
  };

  const inputClass = 'bg-muted text-md md:text-sm';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gmail Drafts</CardTitle>
        <CardDescription>
          Create and manage a draft. Nothing is ever sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label
                htmlFor="draft-to"
                className="text-zinc-600 dark:text-zinc-400"
              >
                To
              </Label>
              <Input
                id="draft-to"
                className={inputClass}
                placeholder="alice@example.com"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                disabled={busy !== null}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="draft-cc"
                className="text-zinc-600 dark:text-zinc-400"
              >
                CC
              </Label>
              <Input
                id="draft-cc"
                className={inputClass}
                placeholder="cc@example.com"
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                disabled={busy !== null}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="draft-bcc"
                className="text-zinc-600 dark:text-zinc-400"
              >
                BCC
              </Label>
              <Input
                id="draft-bcc"
                className={inputClass}
                placeholder="bcc@example.com"
                value={bcc}
                onChange={(event) => setBcc(event.target.value)}
                disabled={busy !== null}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="draft-subject"
              className="text-zinc-600 dark:text-zinc-400"
            >
              Subject
            </Label>
            <Input
              id="draft-subject"
              className={inputClass}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={busy !== null}
            />
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="draft-body"
              className="text-zinc-600 dark:text-zinc-400"
            >
              Plain-text body
            </Label>
            <Textarea
              id="draft-body"
              className="bg-muted text-md min-h-[120px] md:text-sm"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={busy !== null}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleCreate}
              disabled={busy !== null}
            >
              {busy === 'create' ? 'Creating...' : 'Create draft'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleGet}
              disabled={busy !== null || !currentDraft}
            >
              {busy === 'get' ? 'Retrieving...' : 'Retrieve current draft'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleUpdate}
              disabled={busy !== null || !currentDraft}
            >
              {busy === 'update' ? 'Updating...' : 'Update current draft'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={busy !== null || !currentDraft}
            >
              {busy === 'delete'
                ? 'Deleting...'
                : confirmingDelete
                  ? 'Confirm delete'
                  : 'Delete current draft'}
            </Button>
            {confirmingDelete && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy !== null}
              >
                Cancel
              </Button>
            )}
          </div>

          {notice && (
            <p
              data-testid="draft-notice"
              className={
                notice.kind === 'success'
                  ? 'text-sm text-green-600'
                  : 'text-sm text-red-600'
              }
            >
              {notice.text}
            </p>
          )}

          {currentDraft && (
            <div className="rounded-lg border bg-card p-4 text-sm">
              <p className="font-medium text-foreground">
                Draft {currentDraft.draftId}
              </p>
              <p className="mt-1 text-muted-foreground">
                Message ID: {currentDraft.messageId || '—'}
              </p>
              <p className="text-muted-foreground">
                Thread ID: {currentDraft.threadId || '—'}
              </p>
              <p className="text-muted-foreground">
                Subject: {currentDraft.subject || '(no subject)'}
              </p>
              <p className="text-muted-foreground">
                Recipients: {currentDraft.to.join(', ') || '—'}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
