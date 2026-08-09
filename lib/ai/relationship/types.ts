import { z } from 'zod';

export const initiativeTriggerSchema = z.enum(['post_turn', 'active_idle']);
export type InitiativeTrigger = z.infer<typeof initiativeTriggerSchema>;

export const initiativeKindSchema = z.enum([
  'curiosity',
  'continue_thread',
  'random_question',
  'relationship_maintenance',
]);
export type InitiativeKind = z.infer<typeof initiativeKindSchema>;

export const initiativeDecisionSchema = z.object({
  act: z.boolean(),
  kind: initiativeKindSchema,
  reason: z.string().max(240),
  guidance: z.string().max(700).nullable(),
  evidence: z.array(z.string().max(300)).max(5),
  topicKey: z
    .string()
    .regex(/^[a-z0-9_-]+$/)
    .max(80),
  sensitive: z.boolean(),
});

export type InitiativeDecision = z.infer<typeof initiativeDecisionSchema>;

export const initiativeRequestSchema = z.object({
  trigger: initiativeTriggerSchema,
  anchorMessageId: z.string().uuid(),
});
