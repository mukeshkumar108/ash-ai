# Personal Commitments & Calendar Awareness (V1)

Sophie can hold explicit personal commitments (tasks/reminders) and be aware
of Google Calendar events, reactively in conversation and — when the existing
initiative pipeline permits — proactively.

## Ownership (unchanged)

| Concern | Owner |
| --- | --- |
| Canonical task/reminder state | App Postgres (`Task`, `TaskReminder`) |
| Google Calendar objects | Google (via workspace-connect read adapter) |
| Derived lifecycle / attention / follow-ups | Synapse-Cortex (source-linked, non-canonical) |
| Visible reactive generation | Companion Runtime |
| Proactive outreach decision | Relationship initiative pipeline |

Cortex is not a task database and never stores provider objects: tasks and
events are referenced by the stable source-link contract —
`source_system` (`app_task` | `google_calendar`) + `source_object_id` +
integer `source_version`. Same-version re-delivery is a Cortex no-op; a
version bump supersedes prior state; completion/cancellation resolve
lifecycle and invalidate stale attention.

## Canonical schema (0024)

- `Task` — owner, chat anchor, title/notes, status
  (`pending|completed|cancelled`), optional `dueAt`, snooze count,
  provenance (`source`, `sourceMessageId`), Cortex projection bookkeeping
  (`cortexVersion`, `cortexDirty`, `cortexSyncedAt`).
- `TaskReminder` — explicit reminder windows ("Thursday afternoon",
  "30 minutes before"): `startAt`/`endAt`/`label`, status
  (`scheduled|fired|cancelled`). Reminder timing is never inferred from a
  fixed approaching-deadline rule.
- `CalendarEventSync` — minimal reconciliation index for the bounded sync
  window (identity, timing, status, content hash, revision, bounded
  follow-up window). Not a second canonical calendar.

## Runtime flow

Reactive (in conversation):

1. Post-turn capture (`lib/ai/interaction/task-capture.ts`, model-led,
   explicit-only, ≥0.75 confidence, ≤2 per turn) creates canonical tasks
   from the user's own request — never from Sophie's suggestions.
2. Every task mutation pushes deterministic object state to Cortex
   (`POST /v1/events/object`); failures leave the row dirty and the
   `/api/cron/object-sync` sweep re-pushes it (idempotent by version).
3. The Cortex attention packet gains `commitments` (reminder_due /
   overdue / upcoming), `events` (imminent / ongoing / upcoming), and
   bounded source-linked `sophie_attention` (post-event callbacks), all
   surfaced through the existing `continuity_context` block that both the
   Companion Runtime and the TS fallback already inject.

Calendar (through the existing Workspace Connect boundary only):

- `/api/cron/object-sync` (every minute) reconciles each connected user's
  primary calendar over a bounded window: discover, update reschedules,
  invalidate cancellations (list-miss → direct event GET → 404 ⇒ cancelled),
  and push exactly one `completed` projection per ended event, which creates
  a bounded post-event callback window in Cortex (default 6h).

Proactive (no new delivery system):

- The existing initiative scan gains two deterministic candidate sources:
  due `task_reminder` windows and open `calendar_followup` windows. A
  wake-up fires at most once (reminder marked fired / follow-up consumed
  before evaluation), the evaluator remains the authority on whether to
  speak, and per-trigger daily caps apply
  (`RELATIONSHIP_TASK_REMINDER_DAILY_LIMIT` default 6,
  `RELATIONSHIP_CALENDAR_FOLLOWUP_DAILY_LIMIT` default 2).

## API

- `GET /api/tasks?status=pending|completed|cancelled`
- `POST /api/tasks` — create (chat-anchored, validated with zod)
- `GET|PATCH /api/tasks/:id` — patch actions: `complete`, `cancel`,
  `snooze` (`offsetMinutes` | `until`), `reschedule` (`dueAt`, `reminders`)
- `GET /api/cron/object-sync` (CRON_SECRET) — projection + calendar sweep

## Env

| Variable | Default | Purpose |
| --- | --- | --- |
| `CALENDAR_SYNC_DAYS_AHEAD` | 2 | forward sync window |
| `CALENDAR_SYNC_LOOKBACK_HOURS` | 24 | reconciliation floor |
| `CALENDAR_FOLLOWUP_WINDOW_HOURS` | 6 | post-event callback window |
| `CALENDAR_SYNC_MAX_USERS` | 50 | per-sweep user bound |
| `SOPHIE_TASK_CAPTURE_MODEL` | `google/gemini-3.5-flash-lite` | capture model |
| `SOPHIE_TASK_CAPTURE_TIMEOUT_MS` | 10000 | capture bound |
| `RELATIONSHIP_TASK_REMINDER_DAILY_LIMIT` | 6 | proactive cap |
| `RELATIONSHIP_CALENDAR_FOLLOWUP_DAILY_LIMIT` | 2 | proactive cap |

## Verification

- Cortex: `pytest` (object lifecycle + packet + continuity coverage).
- App domain: `pnpm exec tsx scripts/tasks-capability-test.ts` (dev DB).
- End-to-end (local Cortex + dev DB):
  `SYNAPSE_CORTEX_URL=http://127.0.0.1:8010 pnpm exec tsx scripts/capability-e2e.ts`

## Known limitations (V1)

- In-conversation creation is post-turn capture; synchronous tool-driven
  creation inside the Companion Runtime (which owns generation) is a
  follow-up there.
- No recurrences (Cortex `recurring_intentions` already covers routines);
  no projects/tags/subtasks by design.
- Calendar sync covers the primary calendar and the bounded forward window;
  all-day events are indexed but only timed events drive imminent/ongoing
  attention.
- One evaluation per reminder wake-up: if the user is mid-conversation at
  the window, the reminder is consumed silently and stays visible only in
  the reactive packet.
