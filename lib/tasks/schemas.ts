import { z } from 'zod';

export const reminderWindowSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date().nullish(),
  label: z.string().trim().max(120).nullish(),
});

export const createTaskSchema = z.object({
  chatId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(280),
  notes: z.string().trim().max(2000).nullish(),
  dueAt: z.coerce.date().nullish(),
  reminders: z.array(reminderWindowSchema).max(3).optional(),
  sourceMessageId: z.string().uuid().nullish(),
  source: z
    .enum(['conversation', 'manual', 'sophie_accepted', 'api', 'system'])
    .optional(),
  materializedCandidateKey: z.string().trim().max(160).nullish(),
});

export const mutateTaskSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('cancel') }),
  z.object({
    action: z.literal('edit'),
    title: z.string().trim().min(1).max(280).optional(),
    notes: z.string().trim().max(2000).nullish(),
  }),
  z.object({
    action: z.literal('snooze'),
    offsetMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 30)
      .optional(),
    until: z.coerce.date().optional(),
  }),
  z.object({
    action: z.literal('reschedule'),
    dueAt: z.coerce.date().nullish(),
    reminders: z.array(reminderWindowSchema).max(3).optional(),
  }),
]);

export type CreateTaskRequest = z.infer<typeof createTaskSchema>;
export type MutateTaskRequest = z.infer<typeof mutateTaskSchema>;
