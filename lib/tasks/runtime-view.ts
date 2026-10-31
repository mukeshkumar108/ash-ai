/** A read-only, compact view of the person's canonical tasks for the companion. Pure: no database, no side effects. */
export type RuntimeTaskInput = {
  id: string;
  title: string;
  status: string;
  dueAt: Date | null;
  snoozeCount?: number;
  source?: string;
};

export type RuntimeTaskView = {
  id: string;
  title: string;
  due_at: string | null;
  due_local: string | null;
  snoozed: number;
};

function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function localLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function validTimeZone(tz: string | null | undefined): string {
  try {
    if (tz) new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
}

export function bucketTasks(tasks: RuntimeTaskInput[], now: Date, timeZone: string, upcomingDays = 7) {
  const tz = validTimeZone(timeZone);
  const today = localDay(now, tz);
  const horizon = localDay(new Date(now.getTime() + upcomingDays * 86_400_000), tz);
  const view = (t: RuntimeTaskInput): RuntimeTaskView => ({
    id: t.id,
    title: t.title,
    due_at: t.dueAt ? t.dueAt.toISOString() : null,
    due_local: t.dueAt ? localLabel(t.dueAt, tz) : null,
    snoozed: t.snoozeCount ?? 0,
  });
  const out = { today: [] as RuntimeTaskView[], overdue: [] as RuntimeTaskView[], upcoming: [] as RuntimeTaskView[], undated: [] as RuntimeTaskView[] };
  for (const t of tasks) {
    if (t.status !== 'pending') continue;
    if (!t.dueAt) { out.undated.push(view(t)); continue; }
    const day = localDay(t.dueAt, tz);
    if (day === today) out.today.push(view(t));
    else if (day < today) out.overdue.push(view(t));
    else if (day <= horizon) out.upcoming.push(view(t));
  }
  return { as_of: now.toISOString(), time_zone: tz, ...out };
}
