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

export const interactionPhaseSchema = z.enum([
  'excavate',
  'witness',
  'curiosity',
]);

export const interactionActSchema = z.enum([
  'react',
  'riff',
  'tease',
  'challenge',
  'disclose_opine',
  'ask',
  'invite',
  'switch_topic',
  'play',
  'tell',
  'callback',
  'nudge',
  'hold',
  'close',
]);

export const interactionSteerSchema = z.object({
  posture: interactionPostureSchema,
  phase: interactionPhaseSchema.nullable().optional().default(null),
  objective: z.string().trim().min(1).max(280),
  strength: z.enum(['light', 'medium', 'strong']),
  turnsRemaining: z.number().int().min(1).max(4),
  initiativePermission: z.enum(['none', 'low', 'medium', 'high']),
  expressionShape: z.enum(['single', 'short_burst', 'expressive_burst']),
  reason: z.string().trim().min(1).max(240),
  lastTactic: z.string().trim().max(180).nullable().optional().default(null),
  act: interactionActSchema.nullable().optional(),
  actHistory: z.array(interactionActSchema).max(8).optional(),
});

export const interactionSteerGenerationSchema = z.object({
  posture: interactionPostureSchema,
  phase: interactionPhaseSchema.nullable(),
  objective: z.string().trim().min(1).max(280),
  strength: z.enum(['light', 'medium', 'strong']),
  turnsRemaining: z.number().int().min(1).max(4),
  initiativePermission: z.enum(['none', 'low', 'medium', 'high']),
  expressionShape: z.enum(['single', 'short_burst', 'expressive_burst']),
  reason: z.string().trim().min(1).max(240),
  lastTactic: z.string().trim().max(180).nullable(),
  act: interactionActSchema.nullable(),
  actHistory: z.array(interactionActSchema).max(8),
});

export const interactionJudgmentSchema = z.object({
  action: z.enum(['none', 'start', 'continue', 'adapt', 'stop', 'replace']),
  interpretation: z.string().trim().min(1).max(240),
  steer: interactionSteerSchema.nullable(),
});

export type InteractionSteer = z.infer<typeof interactionSteerSchema>;
export type InteractionJudgment = z.infer<typeof interactionJudgmentSchema>;
