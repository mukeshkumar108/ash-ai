import 'server-only';

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import type { Character } from './characters';
import type { ActiveState } from './active-state';
import type { RelationshipDynamics } from './continuity';
import type { StructuredMemory } from './summarizer';
import {
  characterPromptDomainBaselines,
  defaultPromptDomainBaseline,
} from './characters/domain-baselines';

const DOMAINS_DIR = path.join(process.cwd(), 'lib', 'ai', 'characters', 'domains');

export const promptDomainKeys = [
  'horniness',
  'boldness',
  'filth',
  'intensity',
  'comfort',
  'promiscuity',
] as const;

export type PromptDomainKey = (typeof promptDomainKeys)[number];

export type PromptDomainLevels = Record<PromptDomainKey, 1 | 2 | 3 | 4 | 5>;

export interface PromptDomainState {
  baseline: PromptDomainLevels;
  current: PromptDomainLevels;
  reasons: string[];
}

function clampDomainLevel(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

function readDomainModule(
  domain: PromptDomainKey,
  level: 1 | 2 | 3 | 4 | 5,
  characterId?: string,
) {
  if (characterId) {
    const overridePath = path.join(
      process.cwd(),
      'lib',
      'ai',
      'characters',
      characterId,
      'domains',
      domain,
      `${level}.md`,
    );

    if (existsSync(overridePath)) {
      return readFileSync(overridePath, 'utf8').trim();
    }
  }

  return readFileSync(
    path.join(DOMAINS_DIR, domain, `${level}.md`),
    'utf8',
  ).trim();
}

function hasMatchingKeyword(values: string[], pattern: RegExp) {
  return values.some((value) => pattern.test(value.toLowerCase()));
}

function buildPromptDomainReasons({
  memory,
  activeState,
  relationshipDynamics,
}: {
  memory?: StructuredMemory | null;
  activeState?: ActiveState | null;
  relationshipDynamics?: RelationshipDynamics | null;
}) {
  const reasons: string[] = [];

  if (activeState?.scene_mode === 'intimate') {
    reasons.push('Current scene mode is intimate.');
  }

  if (activeState?.scene_mode === 'aftercare') {
    reasons.push('Current scene mode is aftercare.');
  }

  if ((relationshipDynamics?.trust ?? 0) >= 65) {
    reasons.push('Trust is elevated.');
  }

  if ((relationshipDynamics?.attraction ?? 0) >= 70) {
    reasons.push('Attraction is elevated.');
  }

  if ((relationshipDynamics?.conflict ?? 0) >= 50) {
    reasons.push('Conflict is elevated.');
  }

  if ((memory?.relationship_rules?.length ?? 0) > 0) {
    reasons.push('Relationship rules are established.');
  }

  if ((memory?.agreements?.length ?? 0) > 0) {
    reasons.push('Standing agreements are established.');
  }

  return reasons;
}

export function derivePromptDomainState({
  character,
  memory,
  activeState,
  relationshipDynamics,
}: {
  character: Character;
  memory?: StructuredMemory | null;
  activeState?: ActiveState | null;
  relationshipDynamics?: RelationshipDynamics | null;
}): PromptDomainState {
  const baseline =
    characterPromptDomainBaselines[character.id] ??
    defaultPromptDomainBaseline;

  const current: PromptDomainLevels = { ...baseline };
  const desires = memory?.active_desires ?? [];
  const themes = memory?.fantasy_themes ?? [];
  const rules = memory?.relationship_rules ?? [];
  const agreements = memory?.agreements ?? [];
  const boundaries = memory?.boundaries ?? [];
  const mustNotForget = memory?.must_not_forget ?? [];

  const exclusivitySignals = [
    ...rules,
    ...agreements,
    ...boundaries,
    ...mustNotForget,
  ];
  const openSignals = [
    ...themes,
    ...desires,
    ...agreements,
    ...boundaries,
  ];

  const isExclusive = hasMatchingKeyword(
    exclusivitySignals,
    /\b(exclusive|monogam|only you|no one else|faithful|just us|loyal|fianc[eé]|wife|girlfriend)\b/,
  );
  const isOpenOrShared = hasMatchingKeyword(
    openSignals,
    /\b(open|sharing|shared|threesome|group|other men|other women|watching|public|strangers|multiple)\b/,
  );

  const trust = relationshipDynamics?.trust ?? 85;
  const affection = relationshipDynamics?.affection ?? 85;
  const attraction = relationshipDynamics?.attraction ?? 85;
  const intimacy = relationshipDynamics?.emotionalIntimacy ?? 85;
  const vulnerability = relationshipDynamics?.vulnerability ?? 50;
  const playfulness = relationshipDynamics?.playfulness ?? 50;
  const conflict = relationshipDynamics?.conflict ?? 10;
  const jealousy = relationshipDynamics?.jealousy ?? 12;

  current.comfort = clampDomainLevel(
    baseline.comfort +
      (trust >= 80 ? 1 : 0) +
      (intimacy >= 75 ? 1 : 0) -
      (conflict >= 60 ? 1 : 0),
  );

  current.intensity = clampDomainLevel(
    baseline.intensity +
      (intimacy >= 75 ? 1 : 0) +
      (vulnerability >= 70 ? 1 : 0) +
      (activeState?.scene_mode === 'intimate' ? 1 : 0),
  );

  current.horniness = clampDomainLevel(
    baseline.horniness +
      (attraction >= 85 ? 1 : 0) +
      (activeState?.scene_mode === 'intimate' ? 1 : 0) +
      (hasMatchingKeyword(desires, /\b(sex|fuck|need|want|wet|hard|touch|inside|cum|orgasm)\b/) ? 1 : 0),
  );

  current.boldness = clampDomainLevel(
    baseline.boldness +
      ((activeState?.directness_level ?? 5) >= 8 ? 1 : 0) +
      (playfulness >= 80 ? 1 : 0) +
      (current.comfort >= 4 ? 1 : 0),
  );

  current.filth = clampDomainLevel(
    baseline.filth +
      (current.horniness >= 5 ? 1 : 0) +
      (current.boldness >= 5 ? 1 : 0) +
      (hasMatchingKeyword(themes, /\b(dirty|filthy|slut|whore|breed|cum|oral|degrade|nasty)\b/) ? 1 : 0),
  );

  const isThirdPartyActive =
    activeState?.third_party_mode && activeState.third_party_mode !== 'closed';

  current.promiscuity = clampDomainLevel(
    baseline.promiscuity +
      (isOpenOrShared ? 1 : 0) +
      ((memory?.corruption_level ?? 0) >= 8 ? 1 : 0) -
      (isExclusive && !isThirdPartyActive ? 1 : 0) -
      (jealousy >= 70 ? 1 : 0) -
      (activeState?.third_party_mode === 'closed' ? 1 : 0),
  );

  // Apply Domain Guard overrides/caps
  if (activeState?.domain_guard) {
    const { mode, explicitnessCeiling, initiativeCeiling } = activeState.domain_guard;
    if (mode === 'block') {
      current.horniness = 1;
      current.filth = 1;
      current.boldness = 1;
    } else if (mode === 'cap') {
      const expCeil = explicitnessCeiling ?? 2;
      const initCeil = initiativeCeiling ?? 2;
      current.horniness = clampDomainLevel(Math.min(current.horniness, expCeil));
      current.filth = clampDomainLevel(Math.min(current.filth, expCeil));
      current.boldness = clampDomainLevel(Math.min(current.boldness, initCeil));
    }
  }

  return {
    baseline,
    current,
    reasons: buildPromptDomainReasons({
      memory,
      activeState,
      relationshipDynamics,
    }),
  };
}

export function formatPromptDomainStateForPrompt({
  characterId,
  state,
}: {
  characterId: string;
  state: PromptDomainState;
}) {
  const sections = [
    '[EXPRESSION DOMAINS]',
    'These are additive expression modules. They tune behavior and style without overriding the character kernel.',
  ];

  // Compact one-line summary of all current levels
  const levelLine = promptDomainKeys.map(d => `${d}=${state.current[d]}`).join(' ');
  sections.push(`\nCurrent levels: ${levelLine}`);

  // Deltas from baseline
  const deltas = promptDomainKeys
    .filter(d => state.current[d] !== state.baseline[d])
    .map(d => `${d}: baseline ${state.baseline[d]} → ${state.current[d]}`);
  if (deltas.length > 0) {
    sections.push(`Deltas from baseline: ${deltas.join(', ')}`);
  }

  // Only load full module content for domains that crossed a boundary (changed level)
  // Otherwise the compact level line + delta is sufficient
  for (const domain of promptDomainKeys) {
    const level = state.current[domain];
    const changed = state.current[domain] !== state.baseline[domain];
    if (changed) {
      const content = readDomainModule(domain, level, characterId);
      sections.push(`\n[${domain.toUpperCase()} ${level}/5]`);
      sections.push(content);
    }
  }

  return sections.join('\n');
}

export function createPromptDomainBrief(state?: PromptDomainState | null) {
  if (!state) {
    return '';
  }

  return promptDomainKeys
    .map((domain) => `${domain}=${state.current[domain]}`)
    .join('. ');
}
