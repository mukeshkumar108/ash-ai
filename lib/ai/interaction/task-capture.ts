/**
 * SUPERSEDED — legacy post-turn explicit task capture.
 *
 * Kept for reference only. The fast-path semantic owner is now
 * lib/ai/interaction/commit-turn.ts (via interpreter.ts): it is anchored to
 * the visible reply, passes the pending roster and conversation context, and
 * commits through the deterministic binding gates + TurnAction ledger.
 * Do NOT call this function or re-wire it into the chat route: two active
 * semantic task systems must never both create canonical Tasks.
 */

import 'server-only';

import { generateObject } from 'ai';
import { z } from 'zod';

import { getLanguageModel } from '@/lib/ai/providers';

/**
 * Post-turn, model-led capture of EXPLICIT user task/reminder requests.
 *
 * This is canonical task capture for the app-owned Task table, not Cortex
 * expectation extraction: only requests the user actually made in this turn
 * ("remind me to…", "can you remind me…", "I need to remember to…") become
 * tasks. Implicit plans, Sophie's own suggestions, and assistant promises are
 * never captured. Runs after the visible reply (never blocks it) and is
 * bounded to two tasks per turn.
 */

const reminderWindowSchema = z.object({
  label: z.string().trim().min(1).max(120),
  // ISO 8601 with offset, resolved from the user's local time.
  startISO: z.string().datetime({ offset: true }),
  endISO: z.string().datetime({ offset: true }).nullable(),
});

const capturedTaskSchema = z.object({
  title: z.string().trim().min(1).max(280),
  notes: z.string().trim().max(2000).nullable(),
  dueISO: z.string().datetime({ offset: true }).nullable(),
  reminderWindows: z.array(reminderWindowSchema).max(3),
  confidence: z.number().min(0).max(1),
});

const taskCaptureSchema = z.object({
  tasks: z.array(capturedTaskSchema).max(2),
});

export type CapturedTask = z.infer<typeof capturedTaskSchema>;

export async function captureExplicitTasks(input: {
  userText: string;
  assistantText: string;
  localTime: string;
  timeZone: string;
  signal?: AbortSignal;
  generate?: () => Promise<unknown>;
}): Promise<CapturedTask[]> {
  const raw = input.generate
    ? await input.generate()
    : (
        await generateObject({
          model: getLanguageModel(
            process.env.SOPHIE_TASK_CAPTURE_MODEL?.trim() ||
              'google/gemini-3.5-flash-lite',
          ),
          schema: taskCaptureSchema,
          abortSignal:
            input.signal ??
            AbortSignal.timeout(
              Number(process.env.SOPHIE_TASK_CAPTURE_TIMEOUT_MS ?? 10_000),
            ),
          system: `You extract EXPLICIT task and reminder requests the user made in the current turn of a conversation with Sophie.

Capture only when the user clearly asks for a task, reminder, or to be reminded — for example "remind me to call mum tomorrow at 5", "can you remind me Thursday afternoon", "I need to remember to post the letter", "add that I must book the dentist". Resolve every relative time ("tomorrow afternoon", "Friday morning", "in 30 minutes", "Thursday afternoon") into concrete ISO 8601 datetimes with UTC offset using the supplied local time and timezone. "Thursday afternoon" means a window covering Thursday 12:00–18:00 local; "Friday morning" means 07:00–12:00 local; "30 minutes before" style windows must be computed relative to a known event or due time.

Do NOT capture: implicit plans or intentions the user merely mentioned, things Sophie suggested or offered, promises Sophie made, hopes, hypotheticals, tasks already done, or anything without an actionable title. If the user asks for a reminder without any time, create the task with dueISO=null and no reminder windows rather than inventing a time. When nothing explicit is requested, return an empty list. Prefer returning an empty list over guessing.`,
          prompt: `[LOCAL TIME]\n${input.localTime}\n\n[TIMEZONE]\n${input.timeZone}\n\n[USER MESSAGE]\n${input.userText.slice(-4_000)}\n\n[SOPHIE'S REPLY]\n${input.assistantText.slice(-2_000)}`,
        })
      ).object;
  const parsed = taskCaptureSchema.parse(raw);
  // Restraint: only high-confidence explicit requests become canonical state.
  return parsed.tasks.filter((task) => task.confidence >= 0.75);
}
