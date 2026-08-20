import { z } from 'zod';

export const interactionPostureSchema = z.enum([
  'hold',
  'ask',
  'nudge',
  'steer',
  'deepen',
  'expand',
  'lighten',
  'challenge',
  'back_off',
  'repair',
]);

export const interactionSteerSchema = z.object({
  posture: interactionPostureSchema,
  objective: z.string().trim().min(1).max(280),
  strength: z.enum(['light', 'medium', 'strong']),
  turnsRemaining: z.number().int().min(1).max(4),
  initiativePermission: z.enum(['none', 'low', 'medium', 'high']),
  expressionShape: z.enum(['single', 'short_burst', 'expressive_burst']),
  reason: z.string().trim().min(1).max(240),
});

export const interactionJudgmentSchema = z.object({
  action: z.enum(['none', 'start', 'continue', 'stop']),
  interpretation: z.string().trim().min(1).max(240),
  steer: interactionSteerSchema.nullable(),
});

export type InteractionSteer = z.infer<typeof interactionSteerSchema>;
export type InteractionJudgment = z.infer<typeof interactionJudgmentSchema>;
