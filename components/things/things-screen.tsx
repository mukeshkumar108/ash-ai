'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlarmClockPlus,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  ListChecks,
  Pencil,
  Sparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ReminderShape = {
  id: string;
  label: string | null;
  startAt: string | null;
  endAt: string | null;
  status: string;
};

type ThingsTask = {
  id: string;
  title: string;
  notes: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  dueAt: string | null;
  source: string;
  sourceMessageId: string | null;
  chatId: string | null;
  reminders: ReminderShape[];
};

type FilterKey = 'all' | 'pending' | 'completed' | 'cancelled';

type CandidateShape = {
  key: string;
  title: string;
  notes: string | null;
  evidence: string | null;
  authority: 'act' | 'ask';
  createdAt: string | null;
};

const dateTimeInputValue = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

const dueLabel = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

const reminderLabel = (reminder: ReminderShape): string | null => {
  if (reminder.status !== 'scheduled' || !reminder.startAt) return null;
  const start = dueLabel(reminder.startAt);
  return reminder.label ? `${reminder.label} · ${start}` : start;
};

const sourceLabel = (task: ThingsTask): string => {
  if (task.source === 'manual') return 'Manual';
  if (task.source === 'sophie_accepted') return 'Accepted';
  if (task.source === 'system') return 'System';
  if (task.source === 'conversation') return 'From chat';
  return 'API';
};

export function ThingsScreen({
  initialTasks,
  initialCandidates = [],
  candidatesAvailable = false,
}: {
  initialTasks: ThingsTask[];
  initialCandidates?: CandidateShape[];
  candidatesAvailable?: boolean;
}) {
  const [tasks, setTasks] = useState<ThingsTask[]>(initialTasks);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // "Sophie noticed" — uncertain commitment candidates from Cortex, kept
  // visibly separate from canonical Things.
  const [candidates, setCandidates] = useState<CandidateShape[]>(
    initialCandidates,
  );
  const [candidatesEnabled, setCandidatesEnabled] = useState(
    candidatesAvailable,
  );

  // Add form
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Inline editors keyed by task id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDue, setRescheduleDue] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch('/api/tasks', { cache: 'no-store' });
    if (!response.ok) throw new Error(`tasks fetch ${response.status}`);
    const body = (await response.json()) as {
      ok: boolean;
      data: ThingsTask[];
    };
    setTasks(body.data ?? []);
  }, []);

  const refreshCandidates = useCallback(async () => {
    const response = await fetch('/api/tasks/candidates', { cache: 'no-store' });
    if (!response.ok) return;
    const body = (await response.json()) as {
      ok: boolean;
      available?: boolean;
      data?: CandidateShape[];
    };
    setCandidatesEnabled(body.available ?? false);
    setCandidates(body.data ?? []);
  }, []);

  useEffect(() => {
    refresh().catch((reason) =>
      setError(reason instanceof Error ? reason.message : 'refresh failed'),
    );
    refreshCandidates().catch(() => undefined);
  }, [refresh, refreshCandidates]);

  const runMutation = useCallback(
    async (label: string, url: string, init: RequestInit) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch(url, init);
        const body = (await response.json()) as {
          ok: boolean;
          error?: string;
        };
        if (!response.ok || !body.ok) {
          setError(`${label}: ${body.error ?? response.status}`);
          return false;
        }
        await refresh();
        return true;
      } catch (reason) {
        setError(
          `${label}: ${reason instanceof Error ? reason.message : 'failed'}`,
        );
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const ok = await runMutation(
      'add',
      '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          notes: newNotes.trim() || null,
          dueAt: newDue ? new Date(newDue).toISOString() : null,
          source: 'manual',
        }),
      },
    );
    if (ok) {
      setNewTitle('');
      setNewNotes('');
      setNewDue('');
    }
  };

  const patchTask = (
    taskId: string,
    action: string,
    payload: Record<string, unknown>,
  ) =>
    runMutation(action, `/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });

  const candidateMutation = async (
    path: string,
    key: string,
    label: string,
  ) => {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        error?: string;
      };
      if (!response.ok || !body.ok) {
        setError(`${label}: ${body.error ?? response.status}`);
        return;
      }
      await Promise.all([refresh(), refreshCandidates()]);
    } catch (reason) {
      setError(
        `${label}: ${reason instanceof Error ? reason.message : 'failed'}`,
      );
    } finally {
      setBusy(null);
    }
  };

  const beginEdit = (task: ThingsTask) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditNotes(task.notes ?? '');
  };

  const saveEdit = async (taskId: string) => {
    if (!editTitle.trim()) return;
    await patchTask(taskId, 'edit', {
      title: editTitle.trim(),
      notes: editNotes.trim() || null,
    });
    setEditingId(null);
  };

  const visible = useMemo(() => {
    if (filter === 'all') return tasks;
    return tasks.filter((task) => task.status === filter);
  }, [tasks, filter]);

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;

  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
      <div className="mb-6 flex items-center gap-3">
        <ListChecks className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Things</h1>
          <p className="text-sm text-muted-foreground">
            {pendingCount} pending · everything is user-owned, cross-chat
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {candidatesEnabled || candidates.length > 0 ? (
        <Card className="mb-6 border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" />
              Sophie noticed
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Possible commitments from your conversation — not canonical Tasks
              yet. Promote the ones you mean.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing pending right now.
              </p>
            ) : null}
            {candidates.map((candidate) => (
              <div
                key={candidate.key}
                className="flex items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{candidate.title}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {candidate.authority === 'ask' ? 'ask first' : 'act'}
                    </span>
                  </div>
                  {candidate.evidence ? (
                    <p className="mt-1 text-sm italic text-muted-foreground">
                      “{candidate.evidence}”
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    disabled={busy !== null}
                    onClick={() =>
                      void candidateMutation(
                        '/api/tasks/candidates/promote',
                        candidate.key,
                        'promote',
                      )
                    }
                  >
                    Make it a task
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      void candidateMutation(
                        '/api/tasks/candidates/dismiss',
                        candidate.key,
                        'dismiss',
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add a task</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder="e.g. renew my passport"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addTask();
              }}
            />
            <Input
              type="datetime-local"
              aria-label="Due date"
              value={newDue}
              onChange={(event) => setNewDue(event.target.value)}
            />
            <Button onClick={() => void addTask()} disabled={busy !== null}>
              Add
            </Button>
          </div>
          <Textarea
            className="mt-3"
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(event) => setNewNotes(event.target.value)}
          />
        </CardContent>
      </Card>

      <div className="mb-4 flex items-center justify-between">
        <Select
          value={filter}
          onValueChange={(value) => setFilter(value as FilterKey)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {visible.length} shown
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : null}
        {visible.map((task) => (
          <Card key={task.id}>
            <CardContent className="p-4">
              {editingId === task.id ? (
                <div className="flex flex-col gap-2">
                  <Input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                  />
                  <Textarea
                    value={editNotes}
                    onChange={(event) => setEditNotes(event.target.value)}
                    placeholder="Notes"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void saveEdit(task.id)}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      {task.status === 'pending' ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Complete"
                          disabled={busy !== null}
                          onClick={() => void patchTask(task.id, 'complete', {})}
                        >
                          <Circle />
                        </Button>
                      ) : (
                        <CheckCircle2
                          className={
                            task.status === 'completed'
                              ? 'mt-1 text-primary'
                              : 'mt-1 text-muted-foreground'
                          }
                        />
                      )}
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              task.status === 'cancelled'
                                ? 'text-muted-foreground line-through'
                                : 'font-medium'
                            }
                          >
                            {task.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {sourceLabel(task)}
                          </span>
                        </div>
                        {task.notes ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {task.notes}
                          </p>
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {dueLabel(task.dueAt) ? (
                            <span className="inline-flex items-center gap-1">
                              <CalendarClock className="size-3" />
                              {dueLabel(task.dueAt)}
                            </span>
                          ) : null}
                          {task.reminders.map((reminder) => {
                            const label = reminderLabel(reminder);
                            return label ? (
                              <span
                                key={reminder.id}
                                className="inline-flex items-center gap-1"
                              >
                                <AlarmClockPlus className="size-3" />
                                {label}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </div>
                    </div>

                    {task.status === 'pending' ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => void patchTask(task.id, 'snooze', {
                            offsetMinutes: 60,
                          })}
                        >
                          Snooze +1h
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => {
                            setRescheduleId(
                              rescheduleId === task.id ? null : task.id,
                            );
                            setRescheduleDue(dateTimeInputValue(task.dueAt));
                          }}
                        >
                          Reschedule
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => beginEdit(task)}
                          aria-label="Edit"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() => void patchTask(task.id, 'cancel', {})}
                          aria-label="Cancel task"
                        >
                          <X />
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {rescheduleId === task.id ? (
                    <div className="flex items-center gap-2 border-t pt-2">
                      <Input
                        type="datetime-local"
                        aria-label="New due date"
                        value={rescheduleDue}
                        onChange={(event) => setRescheduleDue(event.target.value)}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          void patchTask(task.id, 'reschedule', {
                            dueAt: rescheduleDue
                              ? new Date(rescheduleDue).toISOString()
                              : null,
                          });
                          setRescheduleId(null);
                        }}
                      >
                        <Check />
                        Set
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRescheduleId(null)}
                      >
                        Close
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}