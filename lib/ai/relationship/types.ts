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

export const conversationSignalSchema = z.enum([
  'open',
  'closing',
  'reopened',
  'paused',
  'busy',
  'seeking_company',
  'unclear',
]);

export const conversationOrientationSchema = z.enum([
  'task',
  'informational',
  'creative',
  'social',
  'emotional',
  'mixed',
  'unclear',
]);

export const relationalPostureSchema = z.enum(['hold', 'ask', 'nudge']);

export const relationalIntentSchema = z
  .object({
    kind: z.enum([
      'curiosity',
      'connection',
      'continuity',
      'challenge',
      'play',
      'presence',
    ]),
    guidance: z.string().max(500),
  })
  .nullable();

export const initiativeDecisionSchema = z.object({
  conversationState: z.object({
    signal: conversationSignalSchema,
    confidence: z.number().min(0).max(1),
    reason: z.string().max(180),
  }),
  orientation: conversationOrientationSchema,
  posture: relationalPostureSchema,
  postureConfidence: z.number().min(0).max(1),
  postureReason: z.string().max(180),
  nudgeJustification: z.string().max(240).nullable(),
  relationalIntent: relationalIntentSchema,
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
