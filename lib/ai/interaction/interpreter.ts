import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';

import { getLanguageModel } from '@/lib/ai/providers';
import { normalizeDueFromTemporalBasis } from './temporal-basis';

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
  action: z.enum([
    'create_task',
    'complete_task',
    'cancel_task',
    'snooze_task',
    'reschedule_task',
  ]),
  evidence_class: z.enum(EXPLICIT_EVIDENCE_CLASSES),
  // Verbatim excerpt from the user's message supporting this action.
  evidence_verbatim: z.string().trim().min(3).max(500),
  target_task_id: z.string().uuid().nullable(),
  // Deterministic safety contract (REQUIRED for destructive/update actions):
  // - target_resolution: "explicit" when the user's own words name the task,
  //   "referential" when resolved from conversational grounding. Code rejects
  //   referential picks that are not positively named by the USER text, the
  //   visible reply, or are not the only possible task.
  // - requires_clarification: set true when the visible reply asks a clarifying
  //   question or the turn is ambiguous — code then refuses to mutate at all.
  target_resolution: z.enum(['explicit', 'referential']).nullable(),
  requires_clarification: z.boolean(),
  title: z.string().trim().min(1).max(280).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  due_iso: z.string().datetime({ offset: true }).nullable(),
  // A due date is never accepted on model arithmetic alone. The model must
  // point to the user's exact temporal words and classify their scope so code
  // can validate (and, for "today/tonight", own) the calendar date.
  temporal_evidence_verbatim: z.string().trim().min(1).max(240).nullable().optional(),
  temporal_scope: z.enum(['current_day', 'future_explicit', 'none']).optional(),
  reminder_windows: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        start_iso: z.string().datetime({ offset: true }),
        end_iso: z.string().datetime({ offset: true }).nullable(),
      }),
    )
    .max(3),
  snooze_minutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .nullable(),
});

const interpreterClarificationSchema = z.object({
  intent: z.enum([
    'ambiguous_target',
    'uncertain_commitment',
    'uncertain_resolution',
  ]),
  about: z.string().trim().min(1).max(280),
});

const interpreterOutputSchema = z.object({
  actions: z.array(interpreterActionSchema).max(MAX_ACTIONS_PER_TURN),
  clarifications: z
    .array(interpreterClarificationSchema)
    .max(MAX_CLARIFICATIONS_PER_TURN),
});

export type InterpreterAction = z.infer<typeof interpreterActionSchema>;
export type InterpreterClarification = z.infer<
  typeof interpreterClarificationSchema
>;

export type InterpreterRosterEntry = {
  taskId: string;
  title: string;
  dueAt: Date | null;
};

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

function normalizeLexicon(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[^a-z0-9' ]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const TITLE_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'for',
  'my',
  'your',
  'our',
  'at',
  'on',
  'in',
  'today',
  'tomorrow',
  'friday',
  'monday',
  'weekend',
  'next',
  'this',
  'that',
  'it',
  'me',
  'i',
  'do',
  'did',
  'done',
  'now',
  'then',
  'about',
]);

function distinctiveTitleWords(title: string): string[] {
  return normalizeLexicon(title)
    .split(' ')
    .filter((word) => word.length >= 4 && !TITLE_STOP_WORDS.has(word));
}

/**
 * How strongly `text` lexically refers to a roster task title: a full normalized
 * title match (10) or +2 per distinctive title word present in `text`.
 */
export function titleReferenceSignal(text: string, title: string): number {
  const hay = normalizeLexicon(text);
  const normTitle = normalizeLexicon(title);
  if (normTitle.length >= 4 && hay.includes(normTitle)) return 10;
  let signal = 0;
  for (const word of distinctiveTitleWords(title)) {
    if (hay.includes(word)) signal += 2;
  }
  return signal;
}

export type DestructiveBindingVerdict =
  | { ok: true }
  | { ok: false; reason: 'ambiguous_target' | 'unresolved_target_binding' };

/**
 * Deterministic target-safety guard for complete/cancel/snooze/reschedule.
 *
 * The model proposes a target and a resolution basis; this function decides
 * whether committing it is SAFE using only POSITIVE evidence the code can
 * check (no English-grammar heuristics):
 * 1. the bound target must exist in the roster;
 * 2. if the USER's own words positively name a task, the bound target must be
 *    that unique best match (a contradiction is consequential ambiguity);
 * 3. else if the VISIBLE Sophie reply positively names a task, the bound
 *    target must be that unique best match — this makes the visible reply and
 *    the committed action agree, and rejects reply-vs-target contradictions
 *    ("no, the other one") without parsing negation;
 * 4. else the only positive basis permitted is a SINGLE pending roster item
 *    (there is nothing else it could be);
 * 5. otherwise fail closed: consequential ambiguity -> clarify, never mutate.
 *
 * Recent-conversation mention ALONE is deliberately NOT sufficient evidence:
 * "this task appears somewhere in history" is not "this is the task the user
 * positively selected" (see the "no, the other one" counterexample).
 */
export function resolveDestructiveBinding(params: {
  userText: string;
  assistantText: string;
  roster: InterpreterRosterEntry[];
  modelTargetTaskId: string | null;
}): DestructiveBindingVerdict {
  const { roster } = params;
  if (!params.modelTargetTaskId) {
    return { ok: false, reason: 'unresolved_target_binding' };
  }
  const target = roster.find(
    (entry) => entry.taskId === params.modelTargetTaskId,
  );
  if (!target) return { ok: false, reason: 'unresolved_target_binding' };

  const uniqueBest = (text: string): string | null => {
    const signals = roster.map((entry) => ({
      id: entry.taskId,
      s: titleReferenceSignal(text, entry.title),
    }));
    const max = Math.max(0, ...signals.map((row) => row.s));
    if (max <= 0) return null;
    const best = signals.filter((row) => row.s === max);
    return best.length === 1 ? best[0].id : null;
  };

  const userBest = uniqueBest(params.userText);
  if (userBest !== null) {
    return userBest === target.taskId
      ? { ok: true }
      : { ok: false, reason: 'ambiguous_target' };
  }

  const replyBest = uniqueBest(params.assistantText);
  if (replyBest !== null) {
    return replyBest === target.taskId
      ? { ok: true }
      : { ok: false, reason: 'ambiguous_target' };
  }

  if (roster.length === 1) return { ok: true };

  return { ok: false, reason: 'ambiguous_target' };
}

/** Deterministic retry-safe key so the same fast create can never duplicate. */
export function fastCreateCandidateKey(params: {
  originMessageId: string;
  title: string;
  evidence: string;
}): string {
  const material = `${params.title}\n${params.evidence}`.toLowerCase();
  let hash = 0;
  for (let i = 0; i < material.length; i += 1) {
    hash = (hash * 31 + material.charCodeAt(i)) | 0;
  }
  const hex = (Math.abs(hash) >>> 0).toString(16).padStart(8, '0');
  return `fast:${params.originMessageId}:${hex}`;
}

export async function runCommitmentInterpreter(input: {
  userText: string;
  assistantText: string;
  roster: InterpreterRosterEntry[];
  localTime: string;
  timeZone: string;
  recentContext?: string;
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
              Number(
                process.env.SOPHIE_COMMITMENT_INTERPRETER_TIMEOUT_MS ?? 8_000,
              ),
            ),
          system: `You are the real-time commitment interpreter for Sophie's chat. The user's CURRENT turn may contain explicit commitment actions. Extract at most ${MAX_ACTIONS_PER_TURN} actions, each backed by a VERBATIM excerpt from the user's message.

Allowed evidence classes (use exactly one per action):
- explicit_command: the user commands a reminder/task ("remind me to call mum tomorrow at 5", "add that I must book the dentist").
- explicit_acceptance: the user explicitly accepts a task Sophie proposed ("yes add that", "fuck, yes. Add that.").
- explicit_resolution: the user says an existing task is done ("I finished the tax return", "did it yesterday").
- explicit_modification: the user moves/cancels/snoozes an existing task ("actually make that Friday", "cancel the dentist", "push it an hour").

REQUIRED contract fields on every action:
- requires_clarification: MUST be true whenever the visible reply asks a clarifying question or the turn is genuinely ambiguous (zero plausible targets, two or more equally plausible targets, or an uncertain reference). When true, the action is a flagged non-commit; prefer also emitting a clarification.
- target_resolution: for complete/cancel/snooze/reschedule ONLY — "explicit" when the USER's own words name the target task ("cancel the dentist"), "referential" when you resolved it from the conversation ("cancel that"). For create_task set target_resolution to null.

Grounding rules (critical):
- The task roster below is the ONLY valid source of target_task_id values.
- Resolve pronouns and references ("it", "that", "this", "the dentist one") using the recent conversation context and Sophie's visible reply. PRONOUNS AND REFERENCES ARE RESOLVED ONLY FROM CONVERSATIONAL GROUNDING, never invented.
- If zero plausible targets match, OR two or more are equally plausible targets for a complete/cancel/snooze/reschedule, DO NOT act: set requires_clarification true and emit a clarification instead (intent "ambiguous_target" for binding trouble, "uncertain_resolution" when it is unclear whether something counts as done, "uncertain_commitment" when it is unclear whether something is a commitment at all).
- Sophie's visible reply is AUTHORITATIVE. When Sophie asks a clarifying question, declines, or shows uncertainty, set requires_clarification true and do NOT emit matching actions even if the user's words look like a command. When Sophie's reply names a specific task, your chosen target must agree with it.

Other rules:
- "create_task" needs a title. Resolve relative times ("tomorrow at 5", "Friday morning", "in 30 minutes") into ISO 8601 with UTC offset using the supplied local time and timezone. "Friday morning" = 07:00–12:00 local; "afternoon" = 12:00–18:00 local.
- Any non-null due_iso MUST include temporal_evidence_verbatim copied exactly from the user's message. Set temporal_scope=current_day for "today", "tonight", "this evening", "end the day", or equivalent; future_explicit for an explicit future date/relative time; none when there is no temporal evidence. Never infer "tomorrow" from a commitment made today.
- evidence_verbatim MUST be copied exactly from the user's message (never Sophie's text, never paraphrased). Anything implicit ("I should probably deal with insurance someday"), hypothetical, or merely discussed is NOT an action here — leave it out entirely; a separate background system handles it.
- Reminder windows are optional explicit windows ("the day before", "30 minutes before"). Never invent times for a reminder the user gave without one: set due_iso/reminder_windows to null.
- Return empty actions and empty clarifications when nothing explicit happened.`,
          prompt: `[LOCAL TIME]\n${input.localTime}\n\n[TIMEZONE]\n${input.timeZone}\n\n[RECENT CONVERSATION CONTEXT — used ONLY to resolve references]\n${(input.recentContext ?? '').slice(-3_000)}\n\n[TASK ROSTER — the only valid target_task_id values]\n${JSON.stringify(
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
  interpretation: {
    actions: InterpreterAction[];
    clarifications: InterpreterClarification[];
  };
  userText: string;
  assistantText: string;
  userId: string;
  chatId: string | null;
  timeZone: string;
  roster: InterpreterRosterEntry[];
  originMessageId: string | null;
  recentContext?: string;
  referenceTime?: Date;
}): Promise<InterpreterCommitted> {
  const { createTask, completeTask, cancelTask, snoozeTask, rescheduleTask } =
    await import('@/lib/tasks/domain');
  const { listTurnActionsForMessage } = await import(
    '@/lib/tasks/turn-actions'
  );

  const committed: CommittedFastAction[] = [];
  const pushCommitted = (entry: CommittedFastAction) => {
    // Duplicate proposals of the same (action, target) in one turn collapse
    // to a single chip — canonical state is already protected elsewhere.
    const duplicate = committed.some(
      (existing) =>
        existing.action === entry.action &&
        (existing.taskId ?? null) === (entry.taskId ?? null),
    );
    if (!duplicate) committed.push(entry);
  };
  const rejected: Array<{ action: InterpreterAction; reason: string }> = [];
  const clarifications = [...input.interpretation.clarifications];

  // Canonical idempotency identity: proposal action -> TurnAction ledger action.
  // This is the single mapping used for the pre-mutation claim check, so
  // replay/duplicate detection compares like for like (snooze/reschedule/edit
  // all materialize as 'updated').
  const ledgerActionForProposal: Record<
    InterpreterAction['action'],
    'created' | 'updated' | 'completed' | 'cancelled'
  > = {
    create_task: 'created',
    complete_task: 'completed',
    cancel_task: 'cancelled',
    snooze_task: 'updated',
    reschedule_task: 'updated',
  };

  // Message-scoped ledger claims: a retried/replayed turn must never re-commit,
  // and duplicate proposals within this same output must not double-mutate.
  // The set is seeded from the durable ledger (authoritative across
  // invocations) and extended after each successful commit (authoritative
  // within this loop).
  const claimedKeys = new Set<string>();
  if (input.originMessageId) {
    const rows = await listTurnActionsForMessage(
      input.userId,
      input.originMessageId,
    );
    for (const row of rows) {
      claimedKeys.add(`${row.action}:${row.taskId ?? ''}`);
    }
  }

  for (const action of input.interpretation.actions) {
    // Contract gate 0: a clarification situation can never commit canonical
    // state of ANY kind (create included) — never mutate behind a question.
    if (action.requires_clarification) {
      rejected.push({ action, reason: 'requires_clarification' });
      continue;
    }
    const provenance = {
      originMessageId: input.originMessageId,
      evidenceClass: action.evidence_class,
      evidenceText: action.evidence_verbatim,
    };
    const boundTarget = action.target_task_id
      ? (input.roster.find((entry) => entry.taskId === action.target_task_id) ??
        null)
      : null;

    // Gate 1: verbatim evidence must exist in the user's raw text.
    if (!locateEvidenceVerbatim(input.userText, action.evidence_verbatim)) {
      rejected.push({ action, reason: 'evidence_not_found_in_turn' });
      continue;
    }
    let effectiveDueIso = action.due_iso;
    if (effectiveDueIso) {
      const normalized = normalizeDueFromTemporalBasis({
        dueIso: effectiveDueIso,
        scope: action.temporal_scope,
        temporalEvidenceValid: Boolean(
          action.temporal_evidence_verbatim && locateEvidenceVerbatim(
          input.userText,
          action.temporal_evidence_verbatim,
          )),
        referenceTime: input.referenceTime ?? new Date(),
        timeZone: input.timeZone,
      });
      if (normalized.rejection || !normalized.dueIso) {
        rejected.push({ action, reason: normalized.rejection ?? 'invalid_due' });
        continue;
      }
      effectiveDueIso = normalized.dueIso;
    }
    // Gate 2: create must have a title.
    if (action.action === 'create_task') {
      if (!action.title) {
        rejected.push({ action, reason: 'create_without_title' });
        continue;
      }
      // Retry-safe: the same fast create via the same message can never
      // materialise a second canonical Task.
      const fastKey =
        input.originMessageId && action.title
          ? fastCreateCandidateKey({
              originMessageId: input.originMessageId,
              title: action.title,
              evidence: action.evidence_verbatim,
            })
          : null;
      const normalizeWindowIso = (iso: string) => {
        if (action.temporal_scope !== 'current_day') return iso;
        return normalizeDueFromTemporalBasis({
          dueIso: iso,
          scope: 'current_day',
          temporalEvidenceValid: true,
          referenceTime: input.referenceTime ?? new Date(),
          timeZone: input.timeZone,
        }).dueIso ?? iso;
      };
      const windows = action.reminder_windows.map((window) => ({
        startAt: new Date(normalizeWindowIso(window.start_iso)),
        endAt: window.end_iso
          ? new Date(normalizeWindowIso(window.end_iso))
          : null,
        label: window.label,
      }));
      try {
        const created = await createTask({
          userId: input.userId,
          chatId: input.chatId,
          title: action.title,
          notes: action.notes,
          dueAt: effectiveDueIso ? new Date(effectiveDueIso) : null,
          reminders: windows,
          source:
            action.evidence_class === 'explicit_acceptance'
              ? 'sophie_accepted'
              : 'conversation',
          originEvidence: action.evidence_verbatim,
          originMessageId: input.originMessageId,
          sourceMessageId: input.originMessageId,
          materializedCandidateKey: fastKey,
        });
        const createdKey = `created:${created.id}`;
        if (!claimedKeys.has(createdKey)) {
          claimedKeys.add(createdKey);
          pushCommitted({
            action: action.action,
            taskId: created.id,
            title: created.title,
            chip: chipForAction(action, created.title, created.dueAt),
            undo: { taskId: created.id, action: 'cancel' },
          });
        }
      } catch (error) {
        console.warn('[interpreter] create commit failed open', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        rejected.push({ action, reason: 'commit_failed' });
      }
      continue;
    }

    // Destructive/update action path.
    // Contract gate 0 already vetoed requires_clarification; destructive
    // actions additionally need a declared resolution basis.
    if (
      action.target_resolution !== 'explicit' &&
      action.target_resolution !== 'referential'
    ) {
      rejected.push({ action, reason: 'missing_target_resolution' });
      continue;
    }
    const binding = resolveDestructiveBinding({
      userText: input.userText,
      assistantText: input.assistantText,
      roster: input.roster,
      modelTargetTaskId: action.target_task_id,
    });
    if (!binding.ok) {
      rejected.push({ action, reason: binding.reason });
      if (binding.reason === 'ambiguous_target') {
        clarifications.push({
          intent: 'ambiguous_target',
          about:
            action.title ??
            boundTarget?.title ??
            action.evidence_verbatim.slice(0, 120),
        });
      }
      continue;
    }
    const targetId = input.roster.find(
      (entry) => entry.taskId === action.target_task_id,
    )?.taskId;
    if (!targetId) {
      rejected.push({ action, reason: 'unresolved_target_binding' });
      continue;
    }
    // Authoritative pre-mutation idempotency: the same canonical (message,
    // ledger action, task) claim must never mutate twice. Covers both a
    // replayed turn (seed set from the durable ledger) and duplicate proposals
    // earlier in this same output (extended after each successful commit).
    const claimKey = `${ledgerActionForProposal[action.action]}:${targetId}`;
    if (claimedKeys.has(claimKey)) {
      rejected.push({ action, reason: 'already_applied' });
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
      if (action.action === 'complete_task') {
        const outcome = await completeTask(input.userId, targetId, {
          timeZone: input.timeZone,
          provenance,
        });
        if (!outcome.ok) {
          rejected.push({
            action,
            reason: outcome.reason ?? 'mutation_failed',
          });
          continue;
        }
        claimedKeys.add(claimKey);
        pushCommitted({
          action: action.action,
          taskId: targetId,
          title: outcome.task?.title ?? title,
          chip: chipForAction(action, outcome.task?.title ?? title, null),
        });
        continue;
      }
      if (action.action === 'cancel_task') {
        const outcome = await cancelTask(input.userId, targetId, {
          timeZone: input.timeZone,
          provenance,
        });
        if (!outcome.ok) {
          rejected.push({
            action,
            reason: outcome.reason ?? 'mutation_failed',
          });
          continue;
        }
        claimedKeys.add(claimKey);
        pushCommitted({
          action: action.action,
          taskId: targetId,
          title: outcome.task?.title ?? title,
          chip: chipForAction(action, outcome.task?.title ?? title, null),
        });
        continue;
      }
      if (action.action === 'snooze_task') {
        const outcome = await snoozeTask(input.userId, targetId, {
          offsetMinutes: action.snooze_minutes ?? 60,
          timeZone: input.timeZone,
          provenance,
        });
        if (!outcome.ok) {
          rejected.push({
            action,
            reason: outcome.reason ?? 'mutation_failed',
          });
          continue;
        }
        claimedKeys.add(claimKey);
        pushCommitted({
          action: action.action,
          taskId: targetId,
          title: outcome.task?.title ?? title,
          chip: chipForAction(
            action,
            outcome.task?.title ?? title,
            outcome.task?.dueAt ?? null,
          ),
        });
        continue;
      }
      const outcome = await rescheduleTask(input.userId, targetId, {
        dueAt: action.due_iso ? new Date(action.due_iso) : undefined,
        reminders: windows.length ? windows : undefined,
        timeZone: input.timeZone,
        provenance,
      });
      if (!outcome.ok) {
        rejected.push({ action, reason: outcome.reason ?? 'mutation_failed' });
        continue;
      }
      claimedKeys.add(claimKey);
      pushCommitted({
        action: action.action,
        taskId: targetId,
        title: outcome.task?.title ?? title,
        chip: chipForAction(
          action,
          outcome.task?.title ?? title,
          outcome.task?.dueAt ?? null,
        ),
      });
    } catch (error) {
      // The domain aborts a message-scoped mutation whose ledger claim was
      // already taken (concurrent worker or a boundary case the pre-check
      // missed). Treat that as an already-applied action, not a failure to
      // retry destructively.
      if (
        error &&
        typeof error === 'object' &&
        (error as { code?: string }).code === 'TASK_ACTION_ALREADY_APPLIED'
      ) {
        rejected.push({ action, reason: 'already_applied' });
        continue;
      }
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
