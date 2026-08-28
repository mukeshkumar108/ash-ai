import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';

import { getLanguageModel } from '@/lib/ai/providers';

/**
 * Real-time commitment interpreter (the fast path).
 *
 * Handles ONLY explicit evidence classes — commands, acceptances, resolutions,
 * modifications — from the current turn, with a hard verbatim-evidence
 * requirement. Ambiguous or implicit material is deliberately refused here:
 * it belongs to the background/session pipeline (Synapse-Cortex watcher),
 * which notices implicit commitments, open loops and cross-session semantics.
 *
 * Guarantees enforced deterministically after the model call:
 * - at most MAX_ACTIONS_PER_TURN bounded actions, each independently gated;
 * - every action's evidence_verbatim must be located in the raw user text;
 * - destructive/update actions must bind to exactly one roster task — zero or
 *   multiple plausible targets refuse to bind and become structured
 *   uncertainty instead of a guess;
 * - a failed/slow model call changes nothing: the visible reply is never
 *   delayed or altered, and the background path still sees the turn.
 */

export const MAX_ACTIONS_PER_TURN = 3;
export const MAX_CLARIFICATIONS_PER_TURN = 2;

const EXPLICIT_EVIDENCE_CLASSES = [
  'explicit_command',
  'explicit_acceptance',
  'explicit_resolution',
  'explicit_modification',
] as const;

const interpreterActionSchema = z.object({
  action: z.enum(['create_task', 'complete_task', 'cancel_task', 'snooze_task', 'reschedule_task']),
  evidence_class: z.enum(EXPLICIT_EVIDENCE_CLASSES),
  // Verbatim excerpt from the user's message supporting this action.
  evidence_verbatim: z.string().trim().min(3).max(500),
  target_task_id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(280).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  due_iso: z.string().datetime({ offset: true }).nullable(),
  reminder_windows: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        start_iso: z.string().datetime({ offset: true }),
        end_iso: z.string().datetime({ offset: true }).nullable(),
      }),
    )
    .max(3),
  snooze_minutes: z.number().int().min(1).max(60 * 24 * 30).nullable(),
});

const interpreterClarificationSchema = z.object({
  intent: z.enum(['ambiguous_target', 'uncertain_commitment', 'uncertain_resolution']),
  about: z.string().trim().min(1).max(280),
});

const interpreterOutputSchema = z.object({
  actions: z.array(interpreterActionSchema).max(MAX_ACTIONS_PER_TURN),
  clarifications: z.array(interpreterClarificationSchema).max(MAX_CLARIFICATIONS_PER_TURN),
});

export type InterpreterAction = z.infer<typeof interpreterActionSchema>;
export type InterpreterClarification = z.infer<typeof interpreterClarificationSchema>;

export type InterpreterRosterEntry = { taskId: string; title: string; dueAt: Date | null };

export type CommittedFastAction = {
  action: InterpreterAction['action'];
  taskId: string | null;
  title: string;
  /** Human-facing chip line, e.g. "Reminder set — Friday 09:00". */
  chip: string;
  /** Undo affordance for the chip, where meaningful. */
  undo?: { taskId: string; action: 'cancel' };
};

/** Whitespace/typography-tolerant verbatim matcher (Cortex watcher standard). */
export function locateEvidenceVerbatim(
  userText: string,
  evidence: string,
): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[’‘]/gu, "'")
      .replace(/[“”]/gu, '"')
      .replace(/\s+/gu, ' ')
      .trim();
  const haystack = normalize(userText);
  const needle = normalize(evidence);
  return needle.length >= 3 && haystack.includes(needle);
}

export async function runCommitmentInterpreter(input: {
  userText: string;
  assistantText: string;
  roster: InterpreterRosterEntry[];
  localTime: string;
  timeZone: string;
  signal?: AbortSignal;
  generate?: () => Promise<unknown>;
}): Promise<{
  actions: InterpreterAction[];
  clarifications: InterpreterClarification[];
}> {
  const raw = input.generate
    ? await input.generate()
    : (
        await generateObject({
          model: getLanguageModel(
            process.env.SOPHIE_TASK_CAPTURE_MODEL?.trim() ||
              'google/gemini-3.5-flash-lite',
          ),
          schema: interpreterOutputSchema,
          abortSignal:
            input.signal ??
            AbortSignal.timeout(
              Number(process.env.SOPHIE_COMMITMENT_INTERPRETER_TIMEOUT_MS ?? 8_000),
            ),
          system: `You are the real-time commitment interpreter for Sophie's chat. The user's CURRENT turn may contain explicit commitment actions. Extract at most ${MAX_ACTIONS_PER_TURN} actions, each backed by a VERBATIM excerpt from the user's message.

Allowed evidence classes (use exactly one per action):
- explicit_command: the user commands a reminder/task ("remind me to call mum tomorrow at 5", "add that I must book the dentist").
- explicit_acceptance: the user explicitly accepts a task Sophie proposed ("yes add that", "fuck, yes. Add that.").
- explicit_resolution: the user says an existing task is done ("I finished the tax return", "did it yesterday").
- explicit_modification: the user moves/cancels/snoozes an existing task ("actually make that Friday", "cancel the dentist", "push it an hour").

Rules:
- "create_task" needs a title. Resolve relative times ("tomorrow at 5", "Friday morning", "in 30 minutes") into ISO 8601 with UTC offset using the supplied local time and timezone. "Friday morning" = 07:00–12:00 local; "afternoon" = 12:00–18:00 local.
- complete_task/cancel_task/snooze_task/reschedule_task MUST set target_task_id to a task from the supplied roster. If zero plausible targets match, or two or more are plausible, DO NOT act: emit a clarification instead (intent "ambiguous_target" for binding trouble, "uncertain_resolution" when it is unclear whether something counts as done, "uncertain_commitment" when it is unclear whether something is a commitment at all).
- evidence_verbatim MUST be copied exactly from the user's message (never Sophie's text, never paraphrased). Anything implicit ("I should probably deal with insurance someday"), hypothetical, or merely discussed is NOT an action here — leave it out entirely; a separate background system handles it.
- Reminder windows are optional explicit windows ("the day before", "30 minutes before"). Never invent times for a reminder the user gave without one: set due_iso/reminder_windows to null.
- Return empty actions and empty clarifications when nothing explicit happened.`,
          prompt: `[LOCAL TIME]\n${input.localTime}\n\n[TIMEZONE]\n${input.timeZone}\n\n[TASK ROSTER — the only valid target_task_id values]\n${JSON.stringify(
            input.roster.map((entry) => ({
              task_id: entry.taskId,
              title: entry.title,
              due: entry.dueAt ? entry.dueAt.toISOString() : null,
            })),
          )}\n\n[USER MESSAGE]\n${input.userText.slice(-4_000)}\n\n[SOPHIE'S REPLY]\n${input.assistantText.slice(-2_000)}`,
        })
      ).object;
  const parsed = interpreterOutputSchema.parse(raw);
  return {
    actions: parsed.actions,
    clarifications: parsed.clarifications,
  };
}

export type InterpreterCommitted = {
  committed: CommittedFastAction[];
  clarifications: InterpreterClarification[];
  rejected: Array<{ action: InterpreterAction; reason: string }>;
};

export function chipForAction(
  action: InterpreterAction,
  title: string,
  dueAt: Date | null,
): string {
  const dueLabel = dueAt
    ? new Intl.DateTimeFormat('en-GB', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(dueAt)
    : null;
  switch (action.action) {
    case 'create_task':
      return dueLabel ? `Reminder set — ${dueLabel}` : `Noted — ${title}`;
    case 'complete_task':
      return `Done — ${title}`;
    case 'cancel_task':
      return `Cancelled — ${title}`;
    case 'snooze_task':
      return `Snoozed — ${title}`;
    case 'reschedule_task':
      return dueLabel ? `Moved — ${dueLabel}` : `Rescheduled — ${title}`;
  }
}

/**
 * Deterministic gate + commit. The model proposes; this function disposes.
 * Never throws: any failure degrades to "no fast-path actions" and the
 * background pipeline still sees the turn.
 */
export async function commitInterpreterActions(input: {
  interpretation: { actions: InterpreterAction[]; clarifications: InterpreterClarification[] };
  userText: string;
  userId: string;
  chatId: string | null;
  timeZone: string;
  roster: InterpreterRosterEntry[];
  originMessageId: string | null;
}): Promise<InterpreterCommitted> {
  const { createTask, completeTask, cancelTask, snoozeTask, rescheduleTask } =
    await import('@/lib/tasks/domain');

  const committed: CommittedFastAction[] = [];
  const rejected: Array<{ action: InterpreterAction; reason: string }> = [];
  const clarifications = [...input.interpretation.clarifications];

  for (const action of input.interpretation.actions) {
    const provenance = {
      originMessageId: input.originMessageId,
      evidenceClass: action.evidence_class,
      evidenceText: action.evidence_verbatim,
    };
    const boundTarget = action.target_task_id
      ? input.roster.find((entry) => entry.taskId === action.target_task_id) ?? null
      : null;

    // Gate 1: verbatim evidence must exist in the user's raw text.
    if (!locateEvidenceVerbatim(input.userText, action.evidence_verbatim)) {
      rejected.push({ action, reason: 'evidence_not_found_in_turn' });
      continue;
    }
    // Gate 2: destructive/update actions must bind to exactly one roster task.
    if (action.action !== 'create_task') {
      if (!boundTarget) {
        rejected.push({ action, reason: 'unresolved_target_binding' });
        clarifications.push({
          intent: 'ambiguous_target',
          about:
            action.title ??
            input.roster.find((entry) => entry.taskId === action.target_task_id)?.title ??
            action.evidence_verbatim.slice(0, 120),
        });
        continue;
      }
    } else if (!action.title) {
      rejected.push({ action, reason: 'create_without_title' });
      continue;
    }

    const title =
      action.title ??
      boundTarget?.title ??
      action.evidence_verbatim.slice(0, 80);
    const windows = action.reminder_windows.map((window) => ({
      startAt: new Date(window.start_iso),
      endAt: window.end_iso ? new Date(window.end_iso) : null,
      label: window.label,
    }));

    try {
      if (action.action === 'create_task') {
        const created = await createTask({
          userId: input.userId,
          chatId: input.chatId,
          title: action.title!,
          notes: action.notes,
          dueAt: action.due_iso ? new Date(action.due_iso) : null,
          reminders: windows,
          source: action.evidence_class === 'explicit_acceptance' ? 'sophie_accepted' : 'conversation',
          originEvidence: action.evidence_verbatim,
        });
        committed.push({
          action: action.action,
          taskId: created.id,
          title: created.title,
          chip: chipForAction(action, created.title, created.dueAt),
          undo: { taskId: created.id, action: 'cancel' },
        });
        continue;
      }
      const target = boundTarget!.taskId;
      if (action.action === 'complete_task') {
        const outcome = await completeTask(input.userId, target, { timeZone: input.timeZone, provenance });
        if (!outcome.ok) {
          rejected.push({ action, reason: outcome.reason ?? 'mutation_failed' });
          continue;
        }
        committed.push({
          action: action.action,
          taskId: target,
          title: outcome.task?.title ?? title,
          chip: chipForAction(action, outcome.task?.title ?? title, null),
        });
        continue;
      }
      if (action.action === 'cancel_task') {
        const outcome = await cancelTask(input.userId, target, { timeZone: input.timeZone, provenance });
        if (!outcome.ok) {
          rejected.push({ action, reason: outcome.reason ?? 'mutation_failed' });
          continue;
        }
        committed.push({
          action: action.action,
          taskId: target,
          title: outcome.task?.title ?? title,
          chip: chipForAction(action, outcome.task?.title ?? title, null),
        });
        continue;
      }
      if (action.action === 'snooze_task') {
        const outcome = await snoozeTask(input.userId, target, {
          offsetMinutes: action.snooze_minutes ?? 60,
          timeZone: input.timeZone,
          provenance,
        });
        if (!outcome.ok) {
          rejected.push({ action, reason: outcome.reason ?? 'mutation_failed' });
          continue;
        }
        committed.push({
          action: action.action,
          taskId: target,
          title: outcome.task?.title ?? title,
          chip: chipForAction(action, outcome.task?.title ?? title, outcome.task?.dueAt ?? null),
        });
        continue;
      }
      const outcome = await rescheduleTask(input.userId, target, {
        dueAt: action.due_iso ? new Date(action.due_iso) : undefined,
        reminders: windows.length ? windows : undefined,
        timeZone: input.timeZone,
        provenance,
      });
      if (!outcome.ok) {
        rejected.push({ action, reason: outcome.reason ?? 'mutation_failed' });
        continue;
      }
      committed.push({
        action: action.action,
        taskId: target,
        title: outcome.task?.title ?? title,
        chip: chipForAction(action, outcome.task?.title ?? title, outcome.task?.dueAt ?? null),
      });
    } catch (error) {
      console.warn('[interpreter] action commit failed open', {
        action: action.action,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      rejected.push({ action, reason: 'commit_failed' });
    }
  }
  return {
    committed,
    clarifications: clarifications.slice(0, MAX_CLARIFICATIONS_PER_TURN),
    rejected,
  };
}
