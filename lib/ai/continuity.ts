import { generateObject } from 'ai';
import { z } from 'zod';
import type { ActiveState } from './active-state';
import type { StructuredMemory } from './summarizer';
import { myProvider } from './providers';
import { logAIError } from './error-log';

const CONTINUITY_MAX_OUTPUT_TOKENS = Number(
  process.env.CONTINUITY_MAX_OUTPUT_TOKENS ?? 700,
);

// ─── Actuality Taxonomy ───────────────────────────────────────────────────────
// Distinguishes real-world actuality from roleplay-world actuality.
//
// REAL_WORLD_FACT       – true in the real world (user's stated real-life facts).
// RP_CANON_EVENT        – narrated action that HAPPENED inside the roleplay world.
//                         Fictional in the real world, but persistable canon.
// RP_CHARACTER_CLAIM    – a character describing something; not proof it happened.
// RP_CHARACTER_LIE      – a character claiming something false (in-world lie).
// RP_HYPOTHETICAL       – "what if" scenario inside the roleplay, not enacted.
// OOC_INSTRUCTION       – out-of-character user scene direction; can be canon.
// NON_CANON_FANTASY     – dream/fantasy/hypothetical that does not become canon.
// SPOKEN_INTENTION      – an intention/plan stated in-scene, not yet performed.
// SPOKEN_THREAT         – a threat uttered in-scene, may not have happened.
// Plus legacy values for backward compatibility.
export const actualityEnum = z.enum([
  'ACTUAL_EVENT',
  'SPOKEN_THREAT',
  'FANTASY_CONTENT',
  'PERFORMATIVE_SPEECH',
  'INTERPRETATION',
  'RELATIONAL_TRUTH',
  'CHARACTER_REFRAME',
  'POWER_REFRAME',
  'TEMPORARY_SCENE_AFFECT',
  'UNCLASSIFIED',
  'DERIVED_INSIGHT',
  'REAL_WORLD_FACT',
  'RP_CANON_EVENT',
  'RP_CHARACTER_CLAIM',
  'RP_CHARACTER_LIE',
  'RP_HYPOTHETICAL',
  'OOC_INSTRUCTION',
  'NON_CANON_FANTASY',
  'SPOKEN_INTENTION',
]);

export type Actuality = z.infer<typeof actualityEnum>;

export const currentArcEnum = z.enum([
  'playful_flirtation',
  'erotic_escalation',
  'emotional_confession',
  'secret_revealed',
  'betrayal',
  'rupture',
  'danger_revealed',
  'character_reframe',
  'power_reframe',
  'guilt_and_accountability',
  'repair',
  'trust_rebuilding',
  'stable_bond_changed_by_past_event',
  'unresolved_tension',
  'ordinary_life_after_major_event',
]);

export type CurrentArc = z.infer<typeof currentArcEnum>;

const continuityEventTypeSchema = z.enum([
  'major_event',
  'emotional_turn',
  'promise',
  'conflict',
  'repair',
  'new_person',
  'boundary_shift',
  'scene_change',
  'reveal',
  'plan',
  'character_reframe',
  'power_reframe',
]);

const truthStatusSchema = z.enum([
  'confirmed',
  'claimed',
  'hidden',
  'fantasy',
  'uncertain',
]);

export const characterReframeSchema = z.object({
  character_reframed: z.string(),
  target_character: z.string(),
  before_perception: z.string(),
  after_perception: z.string(),
  trigger_event: z.string(),
  emotional_effect: z.array(z.string()).max(8),
  relationship_effect: z.string(),
  future_behavior_guidance: z.array(z.string()).max(5),
  do_not_interpret_as: z.array(z.string()).max(5),
});

export type CharacterReframe = z.infer<typeof characterReframeSchema>;

export const powerReframeSchema = z.object({
  power_holder: z.string(),
  affected_character: z.string(),
  old_power_assumption: z.string(),
  new_power_understanding: z.string(),
  type_of_power: z.array(z.string()).max(6),
  emotional_effect: z.array(z.string()).max(8),
  future_behavior_guidance: z.array(z.string()).max(5),
  do_not_interpret_as: z.array(z.string()).max(5),
});

export type PowerReframe = z.infer<typeof powerReframeSchema>;

export const continuityEventSchema = z.object({
  chatId: z.string(),
  id: z.string().optional(),
  turnStart: z.number().int().min(0),
  turnEnd: z.number().int().min(0),
  type: continuityEventTypeSchema,
  summary: z.string(),
  participants: z.array(z.string()).max(8),
  entities: z.array(z.string()).max(10),
  truthStatus: truthStatusSchema,
  actuality: actualityEnum.default('UNCLASSIFIED'),
  emotionalImpact: z.union([z.string(), z.array(z.string())]),
  relationshipImpact: z.string(),
  importance: z.number().int().min(0).max(100),
  unresolved: z.boolean(),
  persist: z.boolean().default(true),
  createdAt: z.string(),
  initiator_actor_id: z.string().optional(),
  target_actor_id: z.string().optional(),
  affects_primary_relationship: z.boolean().default(true),
  future_behavior_guidance: z.array(z.string()).max(5).optional(),
  do_not_interpret_as: z.array(z.string()).max(5).optional(),
  character_reframe: characterReframeSchema.optional(),
  power_reframe: powerReframeSchema.optional(),
  objective_record: z.string().optional(),
  perspectives: z.array(z.object({
    actor_id: z.string(),
    meaning: z.string(),
  })).max(8).optional(),
  responsibility: z.array(z.object({
    actor_id: z.string(),
    account: z.string(),
  })).max(8).optional(),
  consequences: z.array(z.string()).max(8).optional(),
  source_message_ids: z.array(z.string()).max(20).optional(),
  scene_id: z.string().optional(),
});

export type ContinuityEvent = z.infer<typeof continuityEventSchema>;

export const relationshipDynamicsSchema = z.object({
  emotionalIntimacy: z.number().int().min(0).max(100),
  romanticAttachment: z.number().int().min(0).max(100),
  trust: z.number().int().min(0).max(100),
  affection: z.number().int().min(0).max(100),
  attraction: z.number().int().min(0).max(100),
  conflict: z.number().int().min(0).max(100),
  jealousy: z.number().int().min(0).max(100),
  insecurity: z.number().int().min(0).max(100),
  playfulness: z.number().int().min(0).max(100),
  vulnerability: z.number().int().min(0).max(100),
  reassuranceNeed: z.number().int().min(0).max(100),
  commitmentOrientation: z.number().int().min(0).max(100),
});

export type RelationshipDynamics = z.infer<typeof relationshipDynamicsSchema>;

export const relationalGuidanceSchema = z.object({
  core_relationship_direction: z.string(),
  user_desired_direction: z.string(),
  allowed_resistance_styles: z.array(z.string()).max(5),
  disallowed_drift: z.array(z.string()).max(6),
  dominant_tension: z.string(),
  supportive_arc_pressure: z.string(),
  reason: z.string(),
});

export type RelationalGuidance = z.infer<typeof relationalGuidanceSchema>;

export const relationshipDynamicsDeltaSchema = z.object({
  emotionalIntimacy: z.number().int().min(-20).max(20).default(0),
  romanticAttachment: z.number().int().min(-20).max(20).default(0),
  trust: z.number().int().min(-20).max(20).default(0),
  affection: z.number().int().min(-20).max(20).default(0),
  attraction: z.number().int().min(-20).max(20).default(0),
  conflict: z.number().int().min(-20).max(20).default(0),
  jealousy: z.number().int().min(-20).max(20).default(0),
  insecurity: z.number().int().min(-20).max(20).default(0),
  playfulness: z.number().int().min(-20).max(20).default(0),
  vulnerability: z.number().int().min(-20).max(20).default(0),
  reassuranceNeed: z.number().int().min(-20).max(20).default(0),
  commitmentOrientation: z.number().int().min(-20).max(20).default(0),
  reason: z.string().optional().default(''),
});

export type RelationshipDynamicsDelta = z.infer<typeof relationshipDynamicsDeltaSchema>;

export const relationshipDeltaSchema = z.object({
  pair: z.enum(['user_ai', 'npc_ai', 'npc_user', 'scene']),
  actor_ids: z.array(z.string()).max(4).optional(),
  dynamicsDelta: relationshipDynamicsDeltaSchema,
});

export type RelationshipDelta = z.infer<typeof relationshipDeltaSchema>;

// ─── Ontology Types ───────────────────────────────────────────────────────────
// Every continuity item has explicit scope, perspective, lifecycle, and evidence.

export type ItemScope = 'scene' | 'arc' | 'relationship' | 'durable';
export type Perspective = 'objective' | 'character';
export type ItemStatus = 'active' | 'superseded' | 'resolved' | 'provisional';
export type ItemOperation = 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'RESOLVE' | 'EXPIRE' | 'REVOKE' | 'UPDATE_PERSON';

// Where a durable item's evidence originally came from.
export type SourceType =
  | 'USER_NARRATION'
  | 'USER_DIALOGUE'
  | 'ASSISTANT_NARRATION'
  | 'ASSISTANT_DIALOGUE'
  | 'OOC_INSTRUCTION'
  | 'EXISTING_CANON'
  | 'INFERRED'
  | 'USER_CONFIRMED';

export interface OntologyItem {
  id?: string;
  type: 'fact' | 'interpretation' | 'emotional_state' | 'relationship_dimension' | 'open_loop' | 'scene_frame' | 'trajectory' | 'failed_strategy' | 'agreement' | 'boundary' | 'rule' | 'commitment';
  statement: string;
  scope: ItemScope;
  perspective: Perspective;
  status: ItemStatus;
  confidence: number;
  evidence: string[];
  supersedes?: string[];
  superseded_by?: string[];
  created_turn: number;
  last_updated_turn: number;
  event_family?: string;
  significance?: 'high' | 'medium' | 'low';
  weight?: 'ordinary' | 'important' | 'identity-changing' | 'irreversible';
  // ── Where the event occurred vs. how long its consequences persist ──────
  occurred_in_scene?: string;
  persistence_scope?: ItemScope;
  current_relevance?: 'high' | 'medium' | 'low';
  // ── Provenance: prevents assistant-authored hallucination from canonising ─
  source_role?: 'user' | 'assistant' | 'system' | 'extractor';
  source_type?: SourceType;
  source_message_ids?: string[];
  created_by?: SourceType;
  // ── Revocation / supersession records ─────────────────────────────────────
  revoked_at_turn?: number;
  revocation_reason?: string;
}

export interface RelationshipDimensions {
  durable_bond?: {
    attachment?: number;
    affection?: number;
    commitment_orientation?: number;
    relational_centrality?: number;
  };
  volatile_state?: {
    felt_safety?: number;
    hurt?: number;
    jealousy?: number;
    reassurance_need?: number;
    openness?: number;
  };
  trust_components?: {
    honesty_trust?: number;
    reliability_trust?: number;
    emotional_safety?: number;
    romantic_security?: number;
    surrender_trust?: number;
  };
}

export interface PersonModel {
  person_id?: string;
  name: string;
  aliases?: string[];
  role: string;
  known_behaviours: string[];
  evaluation: {
    respect: number;
    trust: number;
    safety: number;
    attraction: number;
  };
  trajectory: string;
  first_seen_turn?: number;
  last_updated_turn: number;
  evidence?: string[];
  linked_event_ids?: string[];
  current_status?: string;
}

export interface ExtractorOperation {
  operation: ItemOperation;
  target_id?: string;
  item?: OntologyItem;
  resolution?: string;
  fields?: Record<string, { value: number; trend?: 'improving' | 'stable' | 'declining' }>;
  person_model?: {
    name: string;
    aliases?: string[];
    role: string;
    behaviour: string;
    evaluation_delta?: Partial<PersonModel['evaluation']>;
    trajectory?: string;
    current_status?: string;
    linked_event_ids?: string[];
  };
  evidence?: string[];
  source_role?: 'user' | 'assistant' | 'system' | 'extractor';
  source_type?: SourceType;
}

export interface UnifiedContinuityUpdate {
  operations: ExtractorOperation[];
  event_families: { family: string; root_fact: string; developments: { turn: number; detail: string }[]; current_status: string }[];
  scene_frame: { location: string; activity: string; participants: string[] } | null;
  relationship: Partial<RelationshipDimensions>;
}

const SAFE_CONTINUITY_ID = /^[A-Za-z0-9:_-]{1,96}$/;

function compactIdHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function repairOntologyItemIds(items: OntologyItem[]): OntologyItem[] {
  const replacements = new Map<string, string>();
  const used = new Set<string>();

  const repaired = items.map((item, index) => {
    const oldId = item.id;
    let nextId = oldId && SAFE_CONTINUITY_ID.test(oldId)
      ? oldId
      : `${item.type}-${item.created_turn}-${compactIdHash(`${oldId ?? ''}|${item.statement}`)}`;
    while (used.has(nextId)) nextId = `${nextId}-${index}`;
    used.add(nextId);
    if (oldId && oldId !== nextId) replacements.set(oldId, nextId);
    return {
      ...item,
      id: nextId,
      evidence: [...(item.evidence || [])],
      supersedes: [...(item.supersedes || [])],
      superseded_by: [...(item.superseded_by || [])],
    };
  });

  return repaired.map(item => ({
    ...item,
    supersedes: item.supersedes?.map(id => replacements.get(id) ?? id),
    superseded_by: item.superseded_by?.map(id => replacements.get(id) ?? id),
  }));
}

// ─── Consequential-Event Scope Normalization ─────────────────────────────────
// An event can occur inside a scene without being scene-local. Consequential
// events must default to arc/relationship/durable so a scene change never
// expires them. Scene expiration only removes ephemeral scene details.

const CONSEQUENTIAL_PATTERNS = [
  /\bbetray(?:ed|al)?\b/i,
  /\bexpos(?:ed|e|ure)\b/i,
  /\bdisclos(?:ed|ure)\b/i,
  /\bleft\b/i,
  /\bleave\b/i,
  /\bwalk(?:ed)? away\b/i,
  /\bdrove?\s+off\b/i,
  /\bdrove?\s+away\b/i,
  /\bseparat(?:ed|ion)\b/i,
  /\bpromise(?:d)?\b/i,
  /\bagreement\b/i,
  /\bagreed\b/i,
  /\bviolat(?:ed|ion)\b/i,
  /\bboundary\b/i,
  /\bengage(?:d|ment)?\b/i,
  /\bfianc(?:é|e)\b/i,
  /\bpropos(?:ed|al)\b/i,
  /\bmarried?\b/i,
  /\bmarriage\b/i,
  /\bpregnant\b/i,
  /\bpregnan(?:cy|t)\b/i,
  /\bwedding\b/i,
  /\bbing\b/i,
  /\bcheat(?:ed|ing)?\b/i,
  /\baffair\b/i,
  /\bconfess(?:ed|ion)?\b/i,
  /\bhid(?:e|den)\b/i,
  /\bconceal(?:ed)?\b/i,
  /\blie[ds]?\b/i,
  /\blying\b/i,
  /\bdied\b/i,
  /\bdeath\b/i,
  /\binjur(?:y|ed)\b/i,
  /\bhospital\b/i,
  /\bpolice\b/i,
  /\bquit\b/i,
  /\bfired\b/i,
  /\bevicted\b/i,
  /\brepossession\b/i,
  /\bbankrupt\b/i,
  /\blost the (?:job|house|apartment|home)\b/i,
  /\brevealed\b/i,
  /\brevelation\b/i,
  /\bidentity\b/i,
  /\bremoved?\s+the\s+ring\b/i,
  /\bfirst\s+time\b/i,
  /\bnever\s+did\s+(?:this|that)\b/i,
  /\bsaw\s+him\b/i,
  /\bcalled\s+her\b/i,
  /\bconfront(?:ed|ation)?\b/i,
  /\bthreaten(?:ed)?\b/i,
  /\bblackmail\b/i,
  /\bsecret\b/i,
  /\buncovered\b/i,
  /\bdiscover(?:ed|y)?\b/i,
  /\bwitnessed\b/i,
  /\bsent\s+a\s+video\b/i,
  /\bshow(?:ed)?\s+him\s+(?:the\s+)?video\b/i,
];

export function isConsequentialStatement(statement: string): boolean {
  return CONSEQUENTIAL_PATTERNS.some((pattern) => pattern.test(statement));
}

export function normalizeItemScope(item: {
  statement?: string;
  scope?: ItemScope;
  type?: string;
  significance?: string;
  weight?: string;
}): ItemScope {
  if (!item.statement) return item.scope ?? 'scene';
  // Scene frames are always scene-local.
  if (item.type === 'scene_frame') return 'scene';
  // The extractor's own signal should win when it already chose a durable tier.
  if (item.scope === 'durable' || item.scope === 'relationship') return item.scope;
  if (item.scope === 'arc') return 'arc';
  // Consequential events must not default to scene scope.
  if (isConsequentialStatement(item.statement)) return 'durable';
  if (item.significance === 'high') return 'arc';
  if (item.weight === 'irreversible' || item.weight === 'identity-changing') {
    return 'durable';
  }
  if (item.weight === 'important') return 'arc';
  return item.scope ?? 'scene';
}

// ─── Contradiction Detection ─────────────────────────────────────────────────

const NAMED_ENTITY_PATTERN = /\b[A-Z][a-zA-Z]{2,}\b/g;

// Common capitalized non-proper-noun words. Keeps name extraction from treating
// ordinary sentence-starting words as entity identities.
const NON_NAME_WORDS = new Set([
  'The','A','An','And','But','Or','So','For','Yet','Nor','Not','No','Yes',
  'One','Two','Three','Four','Five','When','What','Where','Why','How','Who',
  'Whom','Which','That','This','These','Those','There','Here','Then','Now',
  'She','Her','Him','His','He','They','Their','You','Your','We','Our','I','It',
  'Its','Again','Still','Even','Just','Only','Because','Before','After',
  'During','While','Since','Until','About','From','With','Without','Into',
  'Over','Under','Through','Between','Against','Among','Along','Beyond',
  'Inside','Outside','Afterwards','Suddenly','Finally','Later','Earlier',
  'Today','Yesterday','Tomorrow','Never','Always','Maybe','Perhaps','Somehow',
]);

export function extractNamesFromStatement(statement: string): string[] {
  const matches = statement.match(NAMED_ENTITY_PATTERN) ?? [];
  return [...new Set(matches.filter(name => !NON_NAME_WORDS.has(name)))];
}

const RELATIONSHIP_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bboyfriend\b/i, label: 'partner' },
  { pattern: /\bgirlfriend\b/i, label: 'partner' },
  { pattern: /\bfianc(?:é|e)\b/i, label: 'partner' },
  { pattern: /\bhusband\b/i, label: 'partner' },
  { pattern: /\bwife\b/i, label: 'partner' },
  { pattern: /\bspouse\b/i, label: 'partner' },
  { pattern: /\bbest friend\b/i, label: 'friend' },
  { pattern: /\bstranger\b/i, label: 'stranger' },
  { pattern: /\bacqaintance\b/i, label: 'stranger' },
  { pattern: /\bacquaintance\b/i, label: 'stranger' },
  { pattern: /\bex-?\s?(?:boyfriend|girlfriend)\b/i, label: 'ex' },
];

function relationshipLabel(statement: string): string[] {
  const labels: string[] = [];
  for (const { pattern, label } of RELATIONSHIP_CLAIM_PATTERNS) {
    if (pattern.test(statement)) labels.push(label);
  }
  return labels;
}

/**
 * Deterministic, conservative contradiction check. Two statements contradict
 * when they both name the same person AND attach incompatible relationship
 * labels (e.g. "boyfriend" vs "stranger"), or when one asserts an identity the
 * other explicitly negates, or one asserts death while the other asserts the
 * person is alive.
 */
export function statementsContradict(a: string, b: string): boolean {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  // Explicit negation of the same claim.
  const negations = [
    /\bnot\s+(?:his|her|\w+'s|their)\s+(?:boyfriend|girlfriend|fianc(?:é|e)|husband|wife)\b/,
    /\bnever\s+(?:met|saw|knew)\b/,
    /\bdidn'?t\s+(?:know|meet)\b/,
    /\bnot\s+(?:actually|really)\s+their\s+(?:boyfriend|girlfriend)\b/,
  ];
  for (const neg of negations) {
    const negInA = neg.test(aLower);
    const negInB = neg.test(bLower);
    if (negInA !== negInB) {
      // Only conflict if both concern a shared person.
      const aNames = extractNamesFromStatement(a);
      const bNames = extractNamesFromStatement(b);
      if (aNames.some((name) => bNames.includes(name))) return true;
    }
  }

  // Death vs. alive: generic life-state contradiction.
  const deathPattern = /\b(?:died|is dead|was dead|passed away|deceased|killed)\b/i;
  const alivePattern = /\b(?:is alive|still alive|isn'?t dead|survived|alive and well)\b/i;
  const deathInA = deathPattern.test(aLower);
  const aliveInA = alivePattern.test(aLower);
  const deathInB = deathPattern.test(bLower);
  const aliveInB = alivePattern.test(bLower);
  if ((deathInA && aliveInB) || (aliveInA && deathInB)) {
    const aNames = extractNamesFromStatement(a);
    const bNames = extractNamesFromStatement(b);
    if (aNames.some((name) => bNames.includes(name))) return true;
  }

  const aLabels = relationshipLabel(aLower);
  const bLabels = relationshipLabel(bLower);
  if (aLabels.length === 0 || bLabels.length === 0) return false;

  const aNames = extractNamesFromStatement(a);
  const bNames = extractNamesFromStatement(b);
  if (!aNames.some((name) => bNames.includes(name))) return false;

  const incompatiblePairs: [string, string][] = [
    ['partner', 'stranger'],
    ['partner', 'ex'],
    ['friend', 'stranger'],
  ];
  for (const [left, right] of incompatiblePairs) {
    if (aLabels.includes(left) && bLabels.includes(right)) return true;
    if (aLabels.includes(right) && bLabels.includes(left)) return true;
  }
  return false;
}

export function findContradictingCanon(
  item: Pick<OntologyItem, 'statement' | 'type'>,
  existing: OntologyItem[],
): OntologyItem[] {
  if (!item.statement) return [];
  const itemNames = extractNamesFromStatement(item.statement);
  if (itemNames.length === 0) return [];
  return existing.filter((candidate) => {
    if (candidate.status !== 'active') return false;
    if (candidate.type !== 'fact') return false;
    const candidateNames = extractNamesFromStatement(candidate.statement);
    if (!candidateNames.some((name) => itemNames.includes(name))) return false;
    return statementsContradict(candidate.statement, item.statement);
  });
}

// ─── Provenance Guard ─────────────────────────────────────────────────────────
// An assistant-authored historical claim must not become durable canon unless it
// is supported by existing canon, supported by prior user narration, introduced
// as a present-tense event, explicitly confirmed by the user, or explicitly
// marked as assistant-created narrative continuation that does not contradict
// canon.

const PAST_TENSE_PATTERNS = [
  /\b(?:was|were|had|did|went|kissed|met|saw|happened)\b/i,
  /\b(?:years?|months?|weeks?|before|ago)\b/i,
  /\b(?:back in|when she|used to)\b/i,
];

export function isHistoricalClaimStatement(statement: string): boolean {
  return PAST_TENSE_PATTERNS.some((pattern) => pattern.test(statement));
}

/**
 * Decide whether an extracted item may be persisted, and at what status.
 *
 * Provenance is the primary protection; contradiction detection is secondary.
 * Decisions are generic — they apply identically to any character or NPC name:
 *
 *   - supported historical claim                → may become active
 *   - unsupported assistant historical claim    → provisional (never active)
 *   - contradicting assistant claim             → rejected
 *   - new present-tense assistant narration     → may become a canonical event
 *     when it is valid roleplay continuation and does not contradict canon
 */
export function guardProvenance(
  item: OntologyItem,
  existing: OntologyItem[],
  sourceRole?: 'user' | 'assistant' | 'system' | 'extractor',
  sourceType?: SourceType,
): { item: OntologyItem | null; reason: string } {
  const role = item.source_role ?? sourceRole;
  const type = item.source_type ?? sourceType;

  const assistantOnly =
    (role === 'assistant' || type === 'ASSISTANT_NARRATION' || type === 'ASSISTANT_DIALOGUE') &&
    type !== 'USER_CONFIRMED';

  if (!assistantOnly) {
    const next: OntologyItem = {
      ...item,
      source_role: role ?? 'extractor',
      source_type: type ?? 'INFERRED',
    };
    return { item: next, reason: 'ok' };
  }

  // Assistant-authored claim. Reject any claim that directly contradicts
  // established canon, whether it is historical or present-tense.
  const contradictions = findContradictingCanon(item, existing);
  if (contradictions.length > 0) {
    return {
      item: null,
      reason: `contradicts-existing-canon:${contradictions.map((c) => c.statement).join(' | ')}`,
    };
  }

  // New present-tense assistant narration is a valid roleplay continuation and
  // may become a canonical event.
  const isPresentTenseEvent = !isHistoricalClaimStatement(item.statement);
  if (isPresentTenseEvent) {
    const next: OntologyItem = {
      ...item,
      source_role: 'assistant',
      source_type: 'ASSISTANT_NARRATION',
    };
    return { item: next, reason: 'assistant-present-tense' };
  }

  // Historical claim. Promote to active only when semantically supported by
  // existing canon (strong statement overlap — never merely sharing a name).
  // The threshold is conservative: a claim that merely shares an entity or a
  // location with established canon is NOT "supported" and stays provisional.
  const statementWords = new Set(
    item.statement.toLowerCase().split(/\s+/).filter(w => w.length > 4),
  );
  const supportedByCanon = existing.some((candidate) => {
    if (candidate.status !== 'active') return false;
    if (candidate.type !== 'fact' && candidate.type !== 'agreement' && candidate.type !== 'rule' && candidate.type !== 'boundary') return false;
    const candidateWords = candidate.statement.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    if (candidateWords.length === 0 || statementWords.size === 0) return false;
    const overlap = [...statementWords].filter(w => candidateWords.includes(w)).length;
    const similar = overlap / Math.max(statementWords.size, candidateWords.length) > 0.5;
    if (similar) return true;
    // The exact claim already recorded.
    return candidate.statement.toLowerCase() === item.statement.toLowerCase();
  });

  if (supportedByCanon) {
    const next: OntologyItem = {
      ...item,
      source_role: 'assistant',
      source_type: 'ASSISTANT_NARRATION',
    };
    return { item: next, reason: 'assistant-narration-supported' };
  }

  // Unsupported historical claim: keep provisional so it can be promoted later,
  // but never persist as confirmed durable canon.
  if (item.scope === 'scene' || item.scope === 'arc') {
    return { item: null, reason: 'unsupported-assistant-historical-claim' };
  }

  return {
    item: {
      ...item,
      status: 'provisional',
      confidence: Math.min(item.confidence, 0.4),
      source_role: 'assistant',
      source_type: 'ASSISTANT_NARRATION',
      created_by: 'ASSISTANT_NARRATION',
    },
    reason: 'provisional-assistant-historical-claim',
  };
}

// ─── Ontology Formatting (Runtime Selection) ─────────────────────────────────

export function selectActiveOntologyItems(items: OntologyItem[]): OntologyItem[] {
  return items.filter(i => i.status === 'active');
}

function factScore(item: OntologyItem, queryTerms: string[] = []): number {
  const weightScore = {
    irreversible: 400,
    'identity-changing': 300,
    important: 200,
    ordinary: 0,
  };
  const significanceScore = { high: 120, medium: 60, low: 0 };
  const scopeScore = { durable: 80, relationship: 60, arc: 30, scene: 0 };
  const statementLower = item.statement.toLowerCase();
  const exactMatch = queryTerms.some((term) =>
    term.length > 1 && statementLower.includes(term),
  ) ? 500 : 0;
  return (
    (item.weight ? weightScore[item.weight] : 0) +
    (item.significance ? significanceScore[item.significance] : 0) +
    scopeScore[item.scope] +
    Math.min(item.last_updated_turn, 100) +
    exactMatch
  );
}

/**
 * Category-aware fact selection. Reserved slots so a burst of recent trivial
 * observations cannot crowd out foundational relationship history.
 */
export function selectContinuityFactsForPrompt(
  items: OntologyItem[],
  limit = 6,
  userText = '',
): OntologyItem[] {
  const facts = items.filter(
    (item) => item.type === 'fact' && item.status === 'active' && item.scope !== 'scene',
  );
  const queryTerms = (userText || '').toLowerCase().split(/\W+/).filter((word) => word.length > 2);

  // Budget: ~half of the slots reserved for consequential / durable history,
  // the rest for recent development, boosted by exact entity references.
  const kernelBudget = Math.max(2, Math.ceil(limit / 2));
  const recentBudget = Math.max(2, limit - kernelBudget);

  const consequential = facts.filter((f) => f.scope === 'durable' || f.scope === 'relationship' || f.weight === 'irreversible' || f.weight === 'identity-changing');
  const arc = facts.filter((f) => !consequential.includes(f) && f.scope === 'arc');
  const recent = facts.filter((f) => !consequential.includes(f) && !arc.includes(f));

  const selected: OntologyItem[] = [];
  const seen = new Set<string>();
  const push = (item: OntologyItem) => {
    const key = item.id ?? item.statement;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(item);
  };

  // 1. Consequential durable history, boosted by exact mentions.
  const referencedDurable = consequential
    .filter((f) => factScore(f, queryTerms) > 0)
    .sort((a, b) => factScore(b, queryTerms) - factScore(a, queryTerms));
  for (const f of referencedDurable) push(f);

  const durable = [...consequential]
    .sort((a, b) => factScore(b, queryTerms) - factScore(a, queryTerms));
  for (const f of durable) {
    if (selected.length >= kernelBudget) break;
    push(f);
  }

  // 2. Arc-level development.
  for (const f of [...arc].sort((a, b) => factScore(b, queryTerms) - factScore(a, queryTerms))) {
    if (selected.length >= kernelBudget + 1) break;
    push(f);
  }

  // 3. Recent scene facts (never beyond the remaining budget).
  const remaining = limit - selected.length;
  for (const f of [...recent]
    .sort((a, b) => factScore(b, queryTerms) - factScore(a, queryTerms))) {
    if (selected.length >= limit) break;
    push(f);
  }

  return selected.slice(0, limit);
}

export function selectAgreementsForPrompt(items: OntologyItem[], limit = 3): OntologyItem[] {
  const agreements = items.filter(
    (item) =>
      (item.type === 'agreement' || item.type === 'rule' || item.type === 'boundary' || item.type === 'commitment') &&
      item.status === 'active',
  );
  return [...agreements]
    .sort((a, b) => {
      const scopeScore = { durable: 80, relationship: 60, arc: 30, scene: 0 } as Record<string, number>;
      return (scopeScore[b.scope] ?? 0) - (scopeScore[a.scope] ?? 0);
    })
    .slice(0, limit);
}

export function selectInterpretationsForPrompt(items: OntologyItem[], limit = 1): OntologyItem[] {
  return items
    .filter((item) => item.type === 'interpretation' && item.status === 'active')
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, limit);
}

/**
 * Exact-entity retrieval: when the user names a known person, pull their person
 * model plus the key shared facts and unresolved threads involving that person.
 */
export function selectEntityPacket(
  items: OntologyItem[],
  people: PersonModel[],
  userText = '',
): { people: PersonModel[]; facts: OntologyItem[]; threads: OntologyItem[]; mentions: string[] } {
  const query = (userText || '').toLowerCase();
  const mentions: string[] = [];

  for (const person of people) {
    const names = [person.name, ...(person.aliases || [])].filter((name) => name.length > 1);
    if (names.some((name) => query.includes(name.toLowerCase()))) {
      mentions.push(person.name);
    }
  }

  const mentionedPeople = mentions.length > 0
    ? people.filter((p) => mentions.some((m) => p.name === m || (p.aliases || []).includes(m)))
    : [];

  const relatedFactIds = new Set<string>();
  for (const person of mentionedPeople) {
    for (const id of person.linked_event_ids || []) relatedFactIds.add(id);
  }

  const facts = items.filter(
    (item) =>
      item.status === 'active' &&
      (item.type === 'fact' || item.type === 'agreement' || item.type === 'rule' || item.type === 'boundary') &&
      (mentions.length === 0 || mentions.some((m) => item.statement.toLowerCase().includes(m.toLowerCase())) || relatedFactIds.has(item.id ?? '')),
  );

  const threads = items.filter(
    (item) =>
      item.status === 'active' &&
      item.type === 'open_loop' &&
      (mentions.length === 0 || mentions.some((m) => item.statement.toLowerCase().includes(m.toLowerCase()))),
  );

  return {
    people: mentionedPeople.length > 0 ? mentionedPeople : people.slice(0, 3),
    facts: facts.slice(0, 6),
    threads: threads.slice(0, 3),
    mentions,
  };
}

export function formatOntologyForPrompt(items: OntologyItem[], limit = 8): string[] {
  const blocks: string[] = [];

  const facts = selectContinuityFactsForPrompt(items, Math.min(limit, 6));
  const agreements = selectAgreementsForPrompt(items, 3);
  const interpretations = selectInterpretationsForPrompt(items, 1);
  const emotional = items.filter(i => i.type === 'emotional_state' && i.status === 'active');
  const openLoops = items.filter(i => i.type === 'open_loop' && i.status === 'active');
  const relationships = items.filter(i => i.type === 'relationship_dimension' && i.status === 'active');
  const trajectories = items.filter(i => i.type === 'trajectory' && i.status === 'active');

  if (agreements.length > 0) {
    blocks.push(`[RELATIONSHIP CONSTITUTION]\n${agreements.map(f => `• ${f.statement}`).join('\n')}`);
  }
  if (facts.length > 0) {
    blocks.push(`[ESTABLISHED FACTS]\n${facts.map(f => `• ${f.statement}`).join('\n')}`);
  }
  if (openLoops.length > 0) {
    blocks.push(`[OPEN LOOPS]\n${openLoops.slice(-2).map(o => `• ${o.statement}`).join('\n')}`);
  }
  if (interpretations.length > 0) {
    blocks.push(`[CURRENT INTERPRETATIONS (provisional)]\n${interpretations.map(i => `• ${i.statement}`).join('\n')}`);
  }
  if (emotional.length > 0) {
    blocks.push(`[EMOTIONAL STATE]\n${emotional.slice(-2).map(e => `• ${e.statement}`).join('\n')}`);
  }
  if (trajectories.length > 0) {
    blocks.push(`[TRAJECTORIES]\n${trajectories.slice(-2).map(t => `• ${t.statement}`).join('\n')}`);
  }

  return blocks;
}

export function formatRelationshipDimensionsForPrompt(dims: Partial<RelationshipDimensions>): string {
  const parts: string[] = [];
  if (dims.durable_bond) {
    parts.push(`Bond: Attachment=${dims.durable_bond.attachment} Affection=${dims.durable_bond.affection} Commitment=${dims.durable_bond.commitment_orientation}`);
  }
  if (dims.volatile_state) {
    parts.push(`Current: Safety=${dims.volatile_state.felt_safety} Hurt=${dims.volatile_state.hurt} Jealousy=${dims.volatile_state.jealousy}`);
  }
  if (dims.trust_components) {
    parts.push(`Trust: Honesty=${dims.trust_components.honesty_trust} Emotional=${dims.trust_components.emotional_safety} Security=${dims.trust_components.romantic_security}`);
  }
  return parts.join(' | ');
}

export function selectPeopleForPrompt(
  people: PersonModel[],
  userText = '',
  limit = 6,
): PersonModel[] {
  const query = userText.toLowerCase();
  return [...people]
    .sort((a, b) => {
      const mentioned = (person: PersonModel) =>
        [person.name, ...(person.aliases || [])]
          .some(name => name.length > 1 && query.includes(name.toLowerCase()))
          ? 1000
          : 0;
      const connected = (person: PersonModel) =>
        Math.min((person.linked_event_ids || []).length, 10) * 10;
      return (
        mentioned(b) + connected(b) + b.last_updated_turn -
        (mentioned(a) + connected(a) + a.last_updated_turn)
      );
    })
    .slice(0, limit);
}

// ─── Operation Application ───────────────────────────────────────────────────
// Applies extractor operations to an existing set of OntologyItems.

export function applyOntologyOperations(
  existing: OntologyItem[],
  operations: ExtractorOperation[],
  currentTurn: number,
  existingPersonModels: PersonModel[] = [],
): { items: OntologyItem[]; relationshipUpdate: Partial<RelationshipDimensions> | null; personModels: PersonModel[]; rejected: { reason: string; statement: string }[] } {
  const items = repairOntologyItemIds(existing);
  let relationshipUpdate: Partial<RelationshipDimensions> | null = null;
  const rejected: { reason: string; statement: string }[] = [];
  const personModels: PersonModel[] = existingPersonModels.map(person => ({
    ...person,
    aliases: [...(person.aliases || [])],
    known_behaviours: [...person.known_behaviours],
    evaluation: { ...person.evaluation },
    evidence: [...(person.evidence || [])],
    linked_event_ids: [...(person.linked_event_ids || [])],
  }));

  for (const op of operations) {
    switch (op.operation) {
      case 'ADD':
        if (op.item) {
          const normalizedScope = normalizeItemScope(op.item);
          const guarded = guardProvenance(
            {
              ...op.item,
              scope: normalizedScope,
            },
            items,
            op.source_role,
            op.source_type,
          );
          if (!guarded.item) {
            rejected.push({ reason: guarded.reason, statement: op.item.statement });
            break;
          }
          const newItem: OntologyItem = {
            ...guarded.item,
            id: `${op.item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            created_turn: currentTurn,
            last_updated_turn: currentTurn,
            supersedes: op.item.supersedes || [],
            persistence_scope: guarded.item.persistence_scope ?? normalizedScope,
          };
          // Check for event_family dedup
          if (newItem.event_family) {
            const existingFamily = items.find(i => i.event_family === newItem.event_family);
            if (existingFamily) {
              // Update existing instead of adding
              const idx = items.indexOf(existingFamily);
              items[idx] = { ...existingFamily, ...newItem, id: existingFamily.id, last_updated_turn: currentTurn };
              break;
            }
          }
          items.push(newItem);
        }
        break;

      case 'UPDATE':
        // Relational dimension update — accumulate
        if (op.fields) {
          relationshipUpdate = relationshipUpdate || {};
          if (op.fields['durable_bond_attachment'] || op.fields['durable_bond_affection'] || op.fields['durable_bond_commitment']) {
            relationshipUpdate.durable_bond = {
              attachment: op.fields['durable_bond_attachment']?.value ?? 50,
              affection: op.fields['durable_bond_affection']?.value ?? 50,
              commitment_orientation: op.fields['durable_bond_commitment']?.value ?? 50,
              relational_centrality: op.fields['durable_bond_centrality']?.value ?? 50,
            };
          }
          if (op.fields['volatile_felt_safety'] || op.fields['volatile_hurt']) {
            relationshipUpdate.volatile_state = {
              felt_safety: op.fields['volatile_felt_safety']?.value ?? 50,
              hurt: op.fields['volatile_hurt']?.value ?? 10,
              jealousy: op.fields['volatile_jealousy']?.value ?? 10,
              reassurance_need: op.fields['volatile_reassurance']?.value ?? 20,
              openness: op.fields['volatile_openness']?.value ?? 50,
            };
          }
          if (op.fields['trust_honesty'] || op.fields['trust_emotional_safety']) {
            relationshipUpdate.trust_components = {
              honesty_trust: op.fields['trust_honesty']?.value ?? 50,
              reliability_trust: op.fields['trust_reliability']?.value ?? 50,
              emotional_safety: op.fields['trust_emotional_safety']?.value ?? 50,
              romantic_security: op.fields['trust_romantic_security']?.value ?? 50,
              surrender_trust: op.fields['trust_surrender']?.value ?? 50,
            };
          }
        }
        break;

      case 'SUPERSEDE':
        if (op.target_id) {
          const target = items.find(i => i.id === op.target_id);
          if (target) {
            target.status = 'superseded';
            target.superseded_by = target.superseded_by || [];
            target.superseded_by.push(op.item?.id || 'unknown');
          }
        }
        if (op.item) {
          const guarded = guardProvenance(
            { ...op.item, scope: normalizeItemScope(op.item) },
            items,
            op.source_role,
            op.source_type,
          );
          if (!guarded.item) {
            rejected.push({ reason: guarded.reason, statement: op.item.statement });
            break;
          }
          const newItem: OntologyItem = {
            ...guarded.item,
            id: `superseding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            created_turn: currentTurn,
            last_updated_turn: currentTurn,
            status: 'active',
            supersedes: op.target_id ? [op.target_id] : [],
          };
          items.push(newItem);
        }
        break;

      case 'RESOLVE':
        if (op.target_id) {
          const target = items.find(i => i.id === op.target_id);
          if (target) target.status = 'resolved';
        }
        break;

      case 'REVOKE':
        // Explicit revocation of an agreement/boundary/rule/commitment.
        if (op.target_id) {
          const target = items.find(i => i.id === op.target_id);
          if (target) {
            target.status = 'resolved';
            target.revoked_at_turn = currentTurn;
            target.revocation_reason = op.resolution ?? '';
          }
        } else if (op.item?.statement) {
          const target = items.find(i =>
            i.status === 'active' &&
            i.statement.toLowerCase() === op.item!.statement.toLowerCase(),
          );
          if (target) {
            target.status = 'resolved';
            target.revoked_at_turn = currentTurn;
            target.revocation_reason = op.resolution ?? '';
          }
        }
        break;

      case 'EXPIRE':
        if (op.target_id) {
          const target = items.find(i => i.id === op.target_id);
          if (target && target.scope === 'scene') target.status = 'resolved';
        }
        break;

      case 'UPDATE_PERSON':
        if (op.person_model) {
          const pm = op.person_model;
          const candidateNames = new Set(
            [pm.name, ...(pm.aliases || [])].map(name => name.trim().toLowerCase()),
          );
          let existing = personModels.find(p =>
            [p.name, ...(p.aliases || [])]
              .some(name => candidateNames.has(name.trim().toLowerCase())),
          );
          if (!existing) {
            existing = {
              person_id: `person-${compactIdHash(pm.name.trim().toLowerCase())}`,
              name: pm.name,
              aliases: [...new Set(pm.aliases || [])],
              role: pm.role,
              known_behaviours: [],
              evaluation: { respect: 50, trust: 50, safety: 50, attraction: 0 },
              trajectory: 'neutral',
              first_seen_turn: currentTurn,
              last_updated_turn: currentTurn,
              evidence: [],
              linked_event_ids: [],
            };
            personModels.push(existing);
          }
          existing.aliases = [...new Set([
            ...(existing.aliases || []),
            ...(pm.aliases || []),
            ...(existing.name.toLowerCase() !== pm.name.toLowerCase() ? [pm.name] : []),
          ])];
          if (pm.role && existing.role === 'unknown') existing.role = pm.role;
          if (pm.behaviour && !existing.known_behaviours.includes(pm.behaviour)) {
            existing.known_behaviours.push(pm.behaviour);
          }
          existing.evidence = [...new Set([
            ...(existing.evidence || []),
            ...(op.evidence || []),
          ])].slice(-20);
          existing.linked_event_ids = [...new Set([
            ...(existing.linked_event_ids || []),
            ...(pm.linked_event_ids || []),
          ])].slice(-20);
          if (pm.evaluation_delta) {
            const d = pm.evaluation_delta;
            if (d.respect != null) existing.evaluation.respect = Math.max(0, Math.min(100, existing.evaluation.respect + d.respect));
            if (d.trust != null) existing.evaluation.trust = Math.max(0, Math.min(100, existing.evaluation.trust + d.trust));
            if (d.safety != null) existing.evaluation.safety = Math.max(0, Math.min(100, existing.evaluation.safety + d.safety));
            if (d.attraction != null) existing.evaluation.attraction = Math.max(0, Math.min(100, existing.evaluation.attraction + d.attraction));
          }
          if (pm.trajectory) existing.trajectory = pm.trajectory;
          if (pm.current_status) existing.current_status = pm.current_status;
          existing.last_updated_turn = currentTurn;
        }
        break;
    }
  }

  return { items: pruneOntologyItems(items), relationshipUpdate, personModels, rejected };
}

/**
 * Bound the ontology size without dropping consequential durable state.
 * Scene/resolved/superseded items are pruned first; active durable, relationship,
 * and arc items are preserved even beyond the soft cap.
 */
export function pruneOntologyItems(items: OntologyItem[], softCap = 120): OntologyItem[] {
  if (items.length <= softCap) return items;

  // Keep order: consequential durable state first, scene ephemera / resolved /
  // provisional items are the first candidates for eviction.
  const priority = (item: OntologyItem): number => {
    if (item.scope === 'durable' || item.scope === 'relationship') return 0;
    if (item.scope === 'arc') return 1;
    if (item.status === 'active') return 2;
    return 3;
  };

  const kept = [...items]
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, softCap);

  const keptIds = new Set(kept.map(i => i.id));
  return kept.map(item => ({
    ...item,
    supersedes: item.supersedes?.filter(id => keptIds.has(id)),
    superseded_by: item.superseded_by?.filter(id => keptIds.has(id)),
  }));
}

type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

const canonAuditSchema = z.object({
  summary: z.string(),
  relationship_state: z.string(),
  emotional_state: z.string(),
  open_emotional_threads: z.array(z.string()).max(8),
  resolved_threads: z.array(z.string()).max(8),
  recent_scene_recap: z.string(),
  relationship_rules: z.array(z.string()).max(10),
  agreements: z.array(z.string()).max(10),
  boundaries: z.array(z.string()).max(10),
  must_not_forget: z.array(z.string()).max(14),
  reason: z.string(),
});

type CanonAuditResult = z.infer<typeof canonAuditSchema>;

const CORE_ATTACHMENT_FIELDS = new Set([
  'emotionalIntimacy',
  'romanticAttachment',
  'trust',
  'affection',
  'attraction',
  'commitmentOrientation',
]);

export const defaultRelationshipDynamics: RelationshipDynamics = {
  emotionalIntimacy: 85,
  romanticAttachment: 85,
  trust: 85,
  affection: 85,
  attraction: 85,
  conflict: 0,
  jealousy: 12,
  insecurity: 20,
  playfulness: 50,
  vulnerability: 50,
  reassuranceNeed: 24,
  commitmentOrientation: 85,
};

function formatConversationWindow(convo: ConversationTurn[]) {
  return convo
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

function formatMemoryContext(memory?: StructuredMemory) {
  if (!memory) {
    return 'No structured memory available.';
  }

  return [
    `Summary: ${memory.summary}`,
    `Core Facts: ${memory.core_facts.join('; ') || 'None'}`,
    `Major Events: ${memory.major_events.join('; ') || 'None'}`,
    `Emotional Turns: ${memory.emotional_turns.join('; ') || 'None'}`,
    `Promises: ${memory.promises_and_commitments.join('; ') || 'None'}`,
    `Decisions: ${(memory.decisions_and_commitments || []).join('; ') || 'None'}`,
    `People Registry: ${(memory.people_registry || []).join('; ') || 'None'}`,
    `Active Desires: ${(memory.active_desires || []).join('; ') || 'None'}`,
    `Fantasy Themes: ${(memory.fantasy_themes || []).join('; ') || 'None'}`,
    `Relationship State: ${memory.relationship_state}`,
    `Emotional State: ${memory.emotional_state}`,
    `Open Threads: ${memory.open_emotional_threads.join('; ') || 'None'}`,
    `Recent Scene: ${memory.recent_scene_recap || 'None'}`,
  ].join('\n');
}

function formatActiveStateContext(activeState?: ActiveState) {
  if (!activeState) {
    return 'No active scene state available.';
  }

  return [
    `Scene Mode: ${activeState.scene_mode}`,
    `Location: ${activeState.location}`,
    `Activity: ${activeState.current_activity}`,
    `Primary Mood: ${activeState.primary_mood}`,
    `Emotional Direction: ${activeState.emotional_direction}`,
    `What They Want: ${activeState.what_they_want}`,
    `What They Avoid: ${activeState.what_they_are_avoiding}`,
    `Boundary: ${activeState.current_boundary}`,
  ].join('\n');
}

function clampStat(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Core attachment fields (emotionalIntimacy, romanticAttachment, trust, affection, attraction, commitmentOrientation)
// represent the character's durable bond with the user and must never drop below 50.
// The character always loves and trusts the user — events can shift these up, but never below baseline devotion.
// Situational fields (conflict, jealousy, insecurity, playfulness, vulnerability, reassuranceNeed) can swing freely.
const CORE_ATTACHMENT_FIELDS_SET = CORE_ATTACHMENT_FIELDS;

function clampCharacterStat(value: number, fieldName: string) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  if (CORE_ATTACHMENT_FIELDS_SET.has(fieldName)) {
    return Math.max(50, clamped);
  }
  return clamped;
}

export function applyRelationshipDynamicsDelta(
  current: RelationshipDynamics,
  delta: RelationshipDynamicsDelta,
) {
  return {
    emotionalIntimacy: clampCharacterStat(current.emotionalIntimacy + delta.emotionalIntimacy, 'emotionalIntimacy'),
    romanticAttachment: clampCharacterStat(current.romanticAttachment + delta.romanticAttachment, 'romanticAttachment'),
    trust: clampCharacterStat(current.trust + delta.trust, 'trust'),
    affection: clampCharacterStat(current.affection + delta.affection, 'affection'),
    attraction: clampCharacterStat(current.attraction + delta.attraction, 'attraction'),
    conflict: clampStat(current.conflict + delta.conflict),
    jealousy: clampStat(current.jealousy + delta.jealousy),
    insecurity: clampStat(current.insecurity + delta.insecurity),
    playfulness: clampStat(current.playfulness + delta.playfulness),
    vulnerability: clampStat(current.vulnerability + delta.vulnerability),
    reassuranceNeed: clampStat(current.reassuranceNeed + delta.reassuranceNeed),
    commitmentOrientation: clampCharacterStat(current.commitmentOrientation + delta.commitmentOrientation, 'commitmentOrientation'),
  };
}

export function formatRelationshipDynamicsToPrompt(
  dynamics: RelationshipDynamics,
) {
  return `[CHARACTER FEELINGS] Intimacy=${dynamics.emotionalIntimacy} Attachment=${dynamics.romanticAttachment} Trust=${dynamics.trust} Affection=${dynamics.affection} Attraction=${dynamics.attraction} Conflict=${dynamics.conflict} Jealousy=${dynamics.jealousy} Insecurity=${dynamics.insecurity} Playfulness=${dynamics.playfulness} Vulnerability=${dynamics.vulnerability} Reassurance=${dynamics.reassuranceNeed} Commitment=${dynamics.commitmentOrientation}`;
}

export function formatRelationalGuidanceToPrompt(
  guidance: RelationalGuidance,
) {
  return [
    '[RELATIONSHIP DIRECTION]',
    'Use this as hidden trajectory guidance. Keep the user able to steer. Allow only character-consistent resistance.',
    `Core Relationship Direction: ${guidance.core_relationship_direction}`,
    `User Desired Direction: ${guidance.user_desired_direction}`,
    `Dominant Tension: ${guidance.dominant_tension}`,
    `Supportive Arc Pressure: ${guidance.supportive_arc_pressure}`,
    `Allowed Resistance Styles: ${guidance.allowed_resistance_styles.join(', ') || 'None'}`,
    `Disallowed Drift: ${guidance.disallowed_drift.join('; ') || 'None'}`,
  ].join('\n');
}

export function createRelationalGuidanceBrief(
  guidance?: RelationalGuidance | null,
) {
  if (!guidance) {
    return '';
  }

  return [
    `Direction=${guidance.core_relationship_direction}`,
    `UserSteer=${guidance.user_desired_direction}`,
    `Tension=${guidance.dominant_tension}`,
    guidance.allowed_resistance_styles.length
      ? `Resistance=${guidance.allowed_resistance_styles.slice(0, 2).join('/')}`
      : '',
  ]
    .filter(Boolean)
    .join('. ');
}

export function createRelationshipDynamicsBrief(
  dynamics: RelationshipDynamics,
) {
  return [
    `Trust=${dynamics.trust}`,
    `Affection=${dynamics.affection}`,
    `Attraction=${dynamics.attraction}`,
    `Conflict=${dynamics.conflict}`,
    `Jealousy=${dynamics.jealousy}`,
    `Vulnerability=${dynamics.vulnerability}`,
    `Reassurance=${dynamics.reassuranceNeed}`,
  ].join('. ');
}

export function getTopContinuityEvents(
  events: ContinuityEvent[],
  limit = 5,
) {
  return [...events]
    .sort((a, b) => {
      if (a.unresolved !== b.unresolved) {
        return a.unresolved ? -1 : 1;
      }
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return b.turnEnd - a.turnEnd;
    })
    .slice(0, limit);
}

export function formatContinuityEventsToPrompt(
  events: ContinuityEvent[],
  limit = 3,
) {
  const topEvents = getTopContinuityEvents(events, limit);

  if (topEvents.length === 0) {
    return '';
  }

  return [
    '[CONTINUITY EVENTS]',
    'Key story events and the character\'s perception shifts. All reframes are from the character\'s point of view — they describe how she sees things, not objective truth about the user.',
    ...topEvents.map(
      (event) => {
        const actuality = event.actuality ? ` [${event.actuality}]` : '';
        const reframeInfo = event.type === 'character_reframe' && event.character_reframe
          ? ` — ${event.character_reframe.before_perception} → ${event.character_reframe.after_perception}`
          : event.type === 'power_reframe' && event.power_reframe
            ? ` — ${event.power_reframe.old_power_assumption} → ${event.power_reframe.new_power_understanding}`
            : '';
        return `• [${event.type}]${actuality} ${event.summary}${reframeInfo}`;
      },
    ),
  ].join('\n');
}

export function shouldPersistEvent(event: ContinuityEvent): boolean {
  switch (event.actuality || 'UNCLASSIFIED') {
    // Non-canon fantasy, performative speech, and unclassified content do not
    // become durable events on their own.
    case 'FANTASY_CONTENT':
    case 'NON_CANON_FANTASY':
    case 'PERFORMATIVE_SPEECH':
    case 'UNCLASSIFIED':
    case 'TEMPORARY_SCENE_AFFECT':
      return false;
    // A narrated event that happens inside the roleplay world is canon, even
    // though it is fictional in the real world. Content type is not actuality.
    case 'ACTUAL_EVENT':
    case 'RP_CANON_EVENT':
    case 'OOC_INSTRUCTION':
    case 'REAL_WORLD_FACT':
      return event.truthStatus !== 'fantasy';
    // Spoken intentions and threats persist only when confirmed or unresolved.
    case 'SPOKEN_THREAT':
    case 'SPOKEN_INTENTION':
    case 'RP_HYPOTHETICAL':
      return event.truthStatus === 'confirmed' || event.unresolved;
    // Character claims and lies are claims, not objective facts. Persist as
    // claims so later confirmation can promote them, but never as confirmed canon.
    case 'RP_CHARACTER_CLAIM':
    case 'RP_CHARACTER_LIE':
      return true;
    case 'INTERPRETATION':
      return event.truthStatus === 'confirmed' || event.unresolved;
    case 'RELATIONAL_TRUTH':
    case 'DERIVED_INSIGHT':
    case 'CHARACTER_REFRAME':
    case 'POWER_REFRAME':
      return event.persist !== false;
    default:
      return event.truthStatus !== 'fantasy';
  }
}

/**
 * Convert repeated non-factual events into DERIVED_INSIGHT entries.
 * If the same fantasy/desire/theme appears across multiple turns,
 * promote it to a typed insight (PREFERENCE, DESIRE, FEAR, THEME, EXPRESSION_STYLE).
 */
export function deriveInsightsFromPatterns(events: ContinuityEvent[]): ContinuityEvent[] {
  const nonFactualByTopic = new Map<string, ContinuityEvent[]>();

  for (const event of events) {
    if (event.actuality !== 'FANTASY_CONTENT' && event.actuality !== 'PERFORMATIVE_SPEECH') continue;
    // Group by summary keywords (first 3 significant words)
    const words = (event.summary || '').toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);
    if (words.length === 0) continue;
    const key = words.join('_');
    if (!nonFactualByTopic.has(key)) nonFactualByTopic.set(key, []);
    nonFactualByTopic.get(key)!.push(event);
  }

  const insights: ContinuityEvent[] = [];
  for (const [, group] of nonFactualByTopic) {
    if (group.length < 2) continue; // needs repetition to become insight
    const latest = group[group.length - 1];
    const insightSummary = `[INSIGHT] Repeated theme: ${latest.summary}`;
    // TODO: use LLM to classify as PREFERENCE | DESIRE | FEAR | THEME | EXPRESSION_STYLE
    insights.push({
      ...latest,
      id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'reveal',
      actuality: 'DERIVED_INSIGHT',
      summary: insightSummary,
      importance: Math.min(100, (latest.importance || 50) + 10),
      persist: true,
      truthStatus: 'confirmed',
    });
  }
  return insights;
}

export function filterPersistableEvents(events: ContinuityEvent[]): ContinuityEvent[] {
  return events.filter(shouldPersistEvent);
}

export function applyLaterReframe(
  existingEvents: ContinuityEvent[],
  newEvents: ContinuityEvent[],
): ContinuityEvent[] {
  // Handle v2 wrapper object — extract items if needed
  const events: ContinuityEvent[] = Array.isArray(existingEvents)
    ? existingEvents
    : (existingEvents as any)?.items || [];
  const merged = [...events];
  for (const newEvent of newEvents) {
    const matchKey = newEvent.character_reframe?.target_character?.toLowerCase()
      || newEvent.power_reframe?.power_holder?.toLowerCase()
      || (newEvent.participants || []).join(' ').toLowerCase()
      || '';
    const matchingIndex = merged.findIndex(
      e =>
        (newEvent.type === 'character_reframe' || newEvent.type === 'power_reframe') &&
        e.type === newEvent.type &&
        (
          matchKey
            ? e.summary.toLowerCase().includes(matchKey)
            : e.summary.toLowerCase().includes(
                newEvent.character_reframe?.target_character?.toLowerCase() || ''
              )
        )
    );
    if (matchingIndex >= 0 && newEvent.type === 'character_reframe') {
      const existing = merged[matchingIndex];
      if (existing.character_reframe) {
        // Update the existing reframe to reflect the new understanding
        merged[matchingIndex] = {
          ...existing,
          character_reframe: {
            ...existing.character_reframe,
            after_perception: newEvent.character_reframe?.after_perception || existing.character_reframe.after_perception,
            trigger_event: newEvent.character_reframe?.trigger_event || existing.character_reframe.trigger_event,
            relationship_effect: newEvent.character_reframe?.relationship_effect || existing.character_reframe.relationship_effect,
          },
          relationshipImpact: newEvent.relationshipImpact || existing.relationshipImpact,
          importance: Math.max(existing.importance, newEvent.importance),
        };
        continue;
      }
    }
    if (!existingEvents.some(e => e.id === newEvent.id)) {
      merged.push(newEvent);
    }
  }
  return merged.slice(-30);
}

export function getReframeWarnings(events: ContinuityEvent[]): string[] {
  const warnings: string[] = [];
  for (const event of events) {
    if (event.do_not_interpret_as?.length) {
      warnings.push(...event.do_not_interpret_as);
    }
    if (event.character_reframe?.do_not_interpret_as?.length) {
      warnings.push(...event.character_reframe.do_not_interpret_as);
    }
    if (event.power_reframe?.do_not_interpret_as?.length) {
      warnings.push(...event.power_reframe.do_not_interpret_as);
    }
  }
  return [...new Set(warnings)];
}

// Paired interpretation guides: for each "do not interpret as X", provide a positive "instead interpret as Y".
// These pairs are defined per warning. Unpaired warnings use a generic positive frame.
const POSITIVE_INTERPRETATIONS: Record<string, string> = {
  'fear as lack of love': 'fear can coexist with love; caution is not rejection',
  'desire as lack of loyalty': 'desire and loyalty are not opposites; attraction to one does not diminish commitment to another',
  'softness as weakness': 'softness can be strength; gentleness is not passivity',
  'a spoken threat as confirmed action': 'words said in tension may not reflect intent or reality',
  'a temporary fantasy as long-term preference': 'exploration in imagination is not a permanent identity change',
  'one extreme scene as the entire personality': 'characters contain multitudes; a scene is a moment, not the full person',
  'a repaired rupture as still fully broken': 'repair is real; trust rebuilt is not pretending',
  'consent to a fantasy as consent to every escalation': 'consent is specific to the act described, not a blanket permission',
  'one character\'s shame as objective guilt': 'guilt is a feeling, not a verdict',
  'conflict as relationship failure': 'conflict can strengthen bonds when resolved',
};

export function formatReframeWarningsToPrompt(warnings: string[]): string {
  if (warnings.length === 0) return '';
  const lines = warnings.map(w => {
    const clean = w.replace(/^do not interpret /i, '');
    const positive = POSITIVE_INTERPRETATIONS[clean.toLowerCase()]
      || 'this moment has more than one meaning; hold it lightly';
    return `- Do not interpret ${clean}; instead, ${positive}.`;
  });
  return '\n[INTERPRETATION GUARD]\n' + lines.join('\n');
}

export function createContinuityEventsBrief(
  events: ContinuityEvent[],
  limit = 3,
) {
  const topEvents = getTopContinuityEvents(events, limit);

  if (topEvents.length === 0) {
    return '';
  }

  return topEvents
    .map(
      (event) =>
        `${event.type}: ${event.summary} (${event.truthStatus}, impact ${event.importance}/100)`,
    )
    .join('. ');
}

function pushUnique(target: string[], value: string) {
  if (!value) {
    return;
  }

  const lower = value.toLowerCase();
  if (!target.some((item) => item.toLowerCase() === lower)) {
    target.push(value);
  }
}

export function deriveConstitutionFromOntology(
  memory: StructuredMemory,
  items: OntologyItem[],
): StructuredMemory {
  const activeOf = (type: string) =>
    items
      .filter(i => i.type === type && i.status === 'active')
      .map(i => i.statement);
  const revokedOf = (type: string) =>
    items
      .filter(i => i.type === type && (i.status === 'resolved' || i.status === 'superseded'))
      .map(i => i.statement.toLowerCase());

  const filterRevoked = (current: string[] = [], revoked: string[]) =>
    current.filter(item => !revoked.includes(item.toLowerCase()));

  const agreements = mergeUnique(activeOf('agreement'), filterRevoked(memory.agreements || [], revokedOf('agreement')));
  const rules = mergeUnique(activeOf('rule'), filterRevoked(memory.relationship_rules || [], revokedOf('rule')));
  const boundaries = mergeUnique(activeOf('boundary'), filterRevoked(memory.boundaries || [], revokedOf('boundary')));
  const commitments = mergeUnique(activeOf('commitment'), filterRevoked(memory.promises_and_commitments || [], revokedOf('commitment')));

  return {
    ...memory,
    agreements,
    relationship_rules: rules,
    boundaries,
    promises_and_commitments: commitments,
  };
}

export function reinforceMemoryWithContinuityEvents(
  memory: StructuredMemory,
  events: ContinuityEvent[],
) {
  if (!events.length) {
    return memory;
  }

  const topEvents = getTopContinuityEvents(events, 6).filter(
    (event) =>
      event.truthStatus !== 'fantasy' &&
      // Narrative interpretations (reframes, power readings) are provisional
      // and must not be promoted to durable canon or open-thread prose.
      event.type !== 'character_reframe' &&
      event.type !== 'power_reframe',
  );

  const next = {
    ...memory,
    major_events: [...memory.major_events],
    significant_incidents: [...memory.significant_incidents],
    decisions_and_commitments: [...(memory.decisions_and_commitments || [])],
    promises_and_commitments: [...memory.promises_and_commitments],
    relationship_rules: [...(memory.relationship_rules || [])],
    agreements: [...(memory.agreements || [])],
    boundaries: [...(memory.boundaries || [])],
    must_not_forget: [...(memory.must_not_forget || [])],
    people_registry: [...(memory.people_registry || [])],
    open_emotional_threads: [...memory.open_emotional_threads],
    resolved_threads: [...memory.resolved_threads],
  };

  for (const event of topEvents) {
    for (const participant of event.participants) {
      if (participant !== 'character' && participant !== 'user') {
        pushUnique(next.people_registry, participant);
      }
    }

    for (const entity of event.entities) {
      pushUnique(next.people_registry, entity);
    }

    switch (event.type) {
      case 'major_event':
      case 'emotional_turn':
      case 'reveal':
      case 'conflict':
      case 'repair':
      case 'boundary_shift':
        pushUnique(next.major_events, event.summary);
        pushUnique(next.significant_incidents, event.summary);
        if (event.type === 'boundary_shift') {
          pushUnique(next.boundaries, event.summary);
        }
        break;
      case 'plan':
      case 'promise':
        pushUnique(next.decisions_and_commitments, event.summary);
        pushUnique(next.promises_and_commitments, event.summary);
        pushUnique(next.agreements, event.summary);
        break;
      case 'new_person':
        pushUnique(next.people_registry, event.summary);
        break;
      case 'scene_change':
        pushUnique(next.significant_incidents, event.summary);
        break;
    }

    if (event.unresolved) {
      pushUnique(next.open_emotional_threads, event.summary);
    } else {
      pushUnique(next.resolved_threads, event.summary);
    }

    if (event.importance >= 85) {
      pushUnique(next.must_not_forget, event.summary);
    }
  }

  const recapSeed = topEvents
    .slice()
    .sort((a, b) => a.turnStart - b.turnStart)
    .slice(-3)
    .map((event) => event.summary);

  if (recapSeed.length > 0) {
    next.recent_scene_recap = recapSeed.join(' Then ');
  }

  return next;
}

export function buildRuntimeContinuityPacket({
    memory,
    activeState,
    relationshipDynamics,
    continuityEvents,
  }: {
  memory?: StructuredMemory | null;
  activeState?: ActiveState | null;
  relationshipDynamics?: RelationshipDynamics | null;
  continuityEvents?: ContinuityEvent[] | null;
}) {
  return {
    memory,
    activeState,
    relationshipDynamics,
    relationalGuidance: memory?.relational_guidance ?? null,
    topContinuityEvents: getTopContinuityEvents(readContinuityEvents(continuityEvents)),
  };
}

function mergeUnique(a: string[] = [], b: string[] = []) {
  const next: string[] = [];

  for (const item of [...a, ...b]) {
    const value = item.trim();
    if (!value) continue;
    if (!next.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      next.push(value);
    }
  }

  return next;
}

export function applyCanonAuditResult(
  memory: StructuredMemory,
  audit: CanonAuditResult,
) {
  return {
    ...memory,
    summary: audit.summary || memory.summary,
    relationship_state: audit.relationship_state || memory.relationship_state,
    emotional_state: audit.emotional_state || memory.emotional_state,
    open_emotional_threads:
      audit.open_emotional_threads.length > 0
        ? audit.open_emotional_threads
        : memory.open_emotional_threads,
    resolved_threads:
      audit.resolved_threads.length > 0
        ? mergeUnique(audit.resolved_threads, memory.resolved_threads)
        : memory.resolved_threads,
    recent_scene_recap: audit.recent_scene_recap || memory.recent_scene_recap,
    relationship_rules: mergeUnique(
      audit.relationship_rules,
      memory.relationship_rules || [],
    ),
    agreements: mergeUnique(audit.agreements, memory.agreements || []),
    boundaries: mergeUnique(audit.boundaries, memory.boundaries || []),
    must_not_forget: mergeUnique(
      audit.must_not_forget,
      memory.must_not_forget || [],
    ),
  };
}

export class ContinuityManager {
  async auditCanonConsistency({
    recentConversation,
    memory,
    activeState,
    continuityEvents,
    characterName,
    ontologyItems,
    personModels,
  }: {
    recentConversation: ConversationTurn[];
    memory: StructuredMemory;
    activeState?: ActiveState;
    continuityEvents?: ContinuityEvent[];
    characterName?: string;
    ontologyItems?: OntologyItem[];
    personModels?: PersonModel[];
  }): Promise<CanonAuditResult | null> {
    if (recentConversation.length === 0) {
      return null;
    }

    const topEvents = getTopContinuityEvents(continuityEvents ?? [], 8);
    const activeOntology = (ontologyItems ?? []).filter(i => i.status === 'active');
    const activeAgreements = activeOntology.filter(i =>
      i.type === 'agreement' || i.type === 'rule' || i.type === 'boundary' || i.type === 'commitment',
    );
    const durableFacts = activeOntology
      .filter(i => i.type === 'fact' && (i.scope === 'durable' || i.scope === 'relationship' || i.scope === 'arc'))
      .slice(-20);

    const prompt = `
You are a canon auditor for a long-running relational RP chat.

Your job is NOT to invent new plot. Your job is to repair soft memory fields so they stay aligned with pinned canon and continuity events.

HARD CANON PRIORITY:
1. relationship_rules
2. agreements
3. boundaries
4. must_not_forget
5. continuity events
6. major events / incidents / decisions
7. only then summary and recent recap

CRITICAL RULES:
- Never let a recap or soft summary contradict pinned canon.
- Never let the character's identity drift. The canonical character name is ${characterName || 'the current selected character'}.
- If a recent assistant reply was confused, repair the summary and recap back toward the hard canon.
- Keep outputs concise, accurate, and grounded in what is already true.
- Do NOT regenerate agreements, rules, or boundaries from the recent window. Preserve the existing constitution below unless the recent window contains an explicit ADD, REVOKE, UPDATE, or SUPERSEDE.

CURRENT MEMORY:
${formatMemoryContext(memory)}

PINNED CANON (memory state):
- Relationship Rules: ${(memory.relationship_rules || []).join('; ') || 'None'}
- Agreements: ${(memory.agreements || []).join('; ') || 'None'}
- Boundaries: ${(memory.boundaries || []).join('; ') || 'None'}
- Must Not Forget: ${(memory.must_not_forget || []).join('; ') || 'None'}

STRUCTURED ONTOLOGY CANON (authoritative, durable first):
${activeAgreements.length > 0
  ? `- Constitution (agreements/rules/boundaries/commitments):\n${activeAgreements.map(i => `    • [${i.type}] ${i.statement}`).join('\n')}`
  : '- Constitution: None'}
${durableFacts.length > 0
  ? `- Durable facts:\n${durableFacts.map(i => `    • [${i.scope}] ${i.statement}`).join('\n')}`
  : '- Durable facts: None'}
${(personModels ?? []).length > 0
  ? `- People:\n${(personModels ?? []).map(p => `    • ${p.name} (${p.role}) | ${p.trajectory}`).join('\n')}`
  : ''}

ACTIVE STATE:
${formatActiveStateContext(activeState)}

TOP CONTINUITY EVENTS:
${topEvents
  .map(
    (event) =>
      `- [${event.type}] ${event.summary} | truth=${event.truthStatus} | unresolved=${event.unresolved ? 'yes' : 'no'}`,
  )
  .join('\n') || 'None'}

RECENT WIDER CONVERSATION WINDOW:
${formatConversationWindow(recentConversation)}
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: canonAuditSchema,
        temperature: 0,
        maxOutputTokens: CONTINUITY_MAX_OUTPUT_TOKENS,
        prompt,
      });

      return result.object;
    } catch (error) {
      logAIError('canon-audit', error);
      return null;
    }
  }

  async updateRelationalGuidance({
    recentConversation,
    memory,
    activeState,
    currentGuidance,
    relationshipDynamics,
    characterName,
  }: {
    recentConversation: ConversationTurn[];
    memory: StructuredMemory;
    activeState?: ActiveState;
    currentGuidance?: RelationalGuidance | null;
    relationshipDynamics?: RelationshipDynamics;
    characterName?: string;
  }): Promise<RelationalGuidance | null> {
    if (recentConversation.length === 0) {
      return currentGuidance ?? null;
    }

    const prompt = `
You are a hidden relationship-direction controller for a long-running relational RP chat.

Your job is to provide light guidance so the assistant does not randomly contradict:
- the character kernel
- established canon
- the relationship trajectory the user is building

You are NOT writing the reply.
You are describing the lane the reply should stay inside.

RULES:
- The canonical character name is ${characterName || 'the current selected character'}.
- Keep the user able to steer the relationship strongly.
- Allow resistance only when it fits the character and current canon.
- Do not invent abrupt rejection, coldness, or anti-user reversals unless strongly justified by canon.
- If the character loves the user and the relationship is deepening, hesitation should usually take the form of vulnerability, timing, caution, jealousy, guilt, or reassurance-seeking rather than random contradiction.
- Use disallowed_drift to name the specific kinds of derailments the reply should avoid right now.

CURRENT MEMORY CANON:
${formatMemoryContext(memory)}

ACTIVE STATE:
${formatActiveStateContext(activeState)}

RELATIONSHIP DYNAMICS:
${relationshipDynamics ? formatRelationshipDynamicsToPrompt(relationshipDynamics) : 'None'}

PREVIOUS GUIDANCE:
${currentGuidance ? formatRelationalGuidanceToPrompt(currentGuidance) : 'None'}

RECENT CONVERSATION:
${formatConversationWindow(recentConversation)}
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: relationalGuidanceSchema,
        temperature: 0,
        maxOutputTokens: CONTINUITY_MAX_OUTPUT_TOKENS,
        prompt,
      });

      return result.object;
    } catch (error) {
      logAIError('relational-guidance', error);
      return currentGuidance ?? null;
    }
  }

  async extractContinuityEvents({
    chatId,
    recentConversation,
    memory,
    activeState,
    currentEvents,
    turnCount,
  }: {
    chatId: string;
    recentConversation: ConversationTurn[];
    memory?: StructuredMemory;
    activeState?: ActiveState;
    currentEvents?: ContinuityEvent[];
    turnCount: number;
  }): Promise<ContinuityEvent[]> {
    if (recentConversation.length === 0) {
      return currentEvents ?? [];
    }

    const prompt = `
You extract continuity events for a relational girlfriend RP chat.

Output only events that materially affect continuity.
Do not output generic fluff.
At most 3 events.

Continuity events should capture:
- major happenings
- emotional turns
- promises/plans
- new people introduced
- important incidents with participants
- explicit decisions and agreements
- scene changes that matter
- reveals
- conflict/repair
- boundary shifts

IMPORTANT:
- Explicit sexual acts are continuity events when they materially happen in-scene.
- Record who did what to whom when possible.
- If a sexual act, first-time act, orgasm, penetration, oral act, restraint, exposure, cleanup, or aftercare occurred, do not skip it.
- If the conversation establishes a future plan, meeting, date, threat, agreement, or next-step scene, record it as a promise or plan.
- Do not sanitize or omit events just because they are adult.
- Prefer concrete event summaries over vague wording.

Use truthStatus carefully:
- confirmed
- claimed
- hidden
- fantasy
- uncertain

CURRENT MEMORY CANON:
${formatMemoryContext(memory)}

CURRENT ACTIVE STATE:
${formatActiveStateContext(activeState)}

EXISTING EVENTS:
${(currentEvents ?? [])
  .slice(-8)
  .map((event) => `- ${event.type}: ${event.summary}`)
  .join('\n') || 'None'}

RECENT CONVERSATION:
${formatConversationWindow(recentConversation)}
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('summarizer-model'),
        schema: z.object({
          events: z.array(
            continuityEventSchema.omit({
              chatId: true,
              createdAt: true,
            }),
          ).max(3),
        }),
        temperature: 0,
        maxOutputTokens: CONTINUITY_MAX_OUTPUT_TOKENS,
        prompt,
      });

      const extractedEvents = result.object.events.map((event) => ({
        ...event,
        chatId,
        createdAt: new Date().toISOString(),
      }));

      const merged = [...(currentEvents ?? [])];

      for (const event of extractedEvents) {
        const duplicate = merged.find(
          (existing) =>
            existing.type === event.type &&
            existing.summary.toLowerCase() === event.summary.toLowerCase(),
        );

        if (!duplicate) {
          merged.push(event);
        }
      }

      return merged.slice(-30);
    } catch (error) {
      logAIError('continuity-events', error);
      return currentEvents ?? [];
    }
  }

  async updateRelationshipDynamics({
    recentConversation,
    currentDynamics,
    memory,
    activeState,
  }: {
    recentConversation: ConversationTurn[];
    currentDynamics: RelationshipDynamics;
    memory?: StructuredMemory;
    activeState?: ActiveState;
  }): Promise<RelationshipDynamics> {
    if (recentConversation.length === 0) {
      return currentDynamics;
    }

    const prompt = `
You update relationship dynamics for a relational girlfriend RP chat.

Return only small deltas.
Avoid large jumps unless there was a major betrayal, confession, rupture, or repair.
Keep the emotional trajectory realistic and gradual.

CURRENT RELATIONSHIP DYNAMICS:
${JSON.stringify(currentDynamics, null, 2)}

CURRENT MEMORY CANON:
${formatMemoryContext(memory)}

CURRENT ACTIVE STATE:
${formatActiveStateContext(activeState)}

RECENT CONVERSATION:
${formatConversationWindow(recentConversation)}
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('active-state-model'),
        schema: relationshipDynamicsDeltaSchema,
        temperature: 0,
        maxOutputTokens: CONTINUITY_MAX_OUTPUT_TOKENS,
        prompt,
      });

      return applyRelationshipDynamicsDelta(currentDynamics, result.object);
    } catch (error) {
      logAIError('relationship-dynamics', error);
      return currentDynamics;
    }
  }
}

export function getContinuityManager() {
  return new ContinuityManager();
}

// ─── Ontology Helpers ────────────────────────────────────────────────────────
// Reads ontology items from the continuityEvents column, which may be:
// - v1: ContinuityEvent[] (old format, return empty)
// - v2: { _v: '2', items: OntologyItem[], relationship?: any }

export function extractOntologyFromColumn(
  continuityEvents: unknown,
): { items: OntologyItem[]; relationship: any; personModels: PersonModel[]; events: ContinuityEvent[]; schemaVersion: string | null } | null {
  if (!continuityEvents || Array.isArray(continuityEvents)) return null;
  if (typeof continuityEvents === 'object' && '_v' in (continuityEvents as any) && (continuityEvents as any)._v === '2') {
    const v = continuityEvents as any;
    return {
      items: (v.items || []) as OntologyItem[],
      relationship: v.relationship || {},
      personModels: v.personModels || [],
      events: v.events || [],
      schemaVersion: v._v ?? '2',
    };
  }
  return null;
}

/**
 * Normalise the continuityEvents column into an event array regardless of
 * whether it holds a v1 flat array or a v2 container. Returns an empty array
 * when the stored value is unreadable so callers never mistake a schema mismatch
 * for "no events".
 */
export function readContinuityEvents(continuityEvents: unknown): ContinuityEvent[] {
  if (Array.isArray(continuityEvents)) return continuityEvents as ContinuityEvent[];
  const ontology = extractOntologyFromColumn(continuityEvents);
  if (ontology) return ontology.events as ContinuityEvent[];
  return [];
}

/**
 * Read the refresh sequence from the v2 container when present.
 */
export function readRefreshSeq(continuityEvents: unknown): number {
  if (continuityEvents && typeof continuityEvents === 'object' && !Array.isArray(continuityEvents)) {
    const seq = (continuityEvents as any).refreshSeq;
    if (typeof seq === 'number' && Number.isFinite(seq)) return seq;
  }
  return 0;
}

export function buildOntologyPromptBlock(
  continuityEvents: unknown,
): { prompt: string; brief: string } | null {
  const ontology = extractOntologyFromColumn(continuityEvents);
  if (!ontology || ontology.items.length === 0) return null;

  const blocks = formatOntologyForPrompt(ontology.items);
  if (blocks.length === 0) return null;

  return {
    prompt: blocks.join('\n\n'),
    brief: ontology.items
      .filter(i => i.status === 'active')
      .slice(-3)
      .map(i => `${i.type}: ${i.statement.slice(0, 100)}`)
      .join('. '),
  };
}
