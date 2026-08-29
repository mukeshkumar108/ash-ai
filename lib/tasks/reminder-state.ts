/**
 * Pure commitment/reminder state semantics. Mirrors the Cortex packet
 * compiler exactly: overdue > reminder_due > upcoming, evaluated against the
 * canonical due date and explicit reminder windows — never a fixed
 * approaching-deadline rule.
 */

export type ReminderWindowLike = {
  startAt: Date;
  endAt: Date | null;
  label?: string | null;
};

export type CommitmentState = 'upcoming' | 'reminder_due' | 'overdue';

export type CommitmentEvaluation<WindowType> = {
  state: CommitmentState;
  activeReminder: WindowType | null;
  nextReminder: WindowType | null;
};

export function evaluateCommitment<WindowType extends ReminderWindowLike>(
  input: {
    dueAt: Date | null;
    reminders: WindowType[];
  },
  now: Date,
): CommitmentEvaluation<WindowType> {
  let activeReminder: WindowType | null = null;
  let nextReminder: WindowType | null = null;
  for (const window of input.reminders) {
    if (
      window.startAt <= now &&
      (window.endAt == null || window.endAt >= now)
    ) {
      if (activeReminder == null) activeReminder = window;
    } else if (window.startAt > now) {
      if (nextReminder == null || window.startAt < nextReminder.startAt) {
        nextReminder = window;
      }
    }
  }
  const overdue = input.dueAt != null && now > input.dueAt;
  const state: CommitmentState = overdue
    ? 'overdue'
    : activeReminder != null
      ? 'reminder_due'
      : 'upcoming';
  return { state, activeReminder, nextReminder };
}
