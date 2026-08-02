import 'server-only';

import { getCharacterKernelById, getCharacterVoiceSignature } from './character-prompts';
import {
  selectContinuityFactsForPrompt,
  selectAgreementsForPrompt,
  selectInterpretationsForPrompt,
  selectEntityPacket,
  type OntologyItem,
  type PersonModel,
  selectPeopleForPrompt,
  type RelationshipDimensions,
} from './continuity';
import type { ActiveState } from './active-state';
import type { StructuredMemory } from './summarizer';
import type { UserCanonProfile } from './prompts';
import {
  buildOutOfCharacterPrompt,
  buildRelationalCentrePrompt,
  buildRelationalIntegrityPrompt,
} from './relational-integrity';

export interface CompilerInput {
  characterId: string;
  thirdPartyMode: string;
  userName: string;
  language: string;
  userCanon: UserCanonProfile | null;
  ontologyItems: OntologyItem[];
  relationshipDimensions: Partial<RelationshipDimensions>;
  activeState: ActiveState | null;
  memory: StructuredMemory | null;
  domainLevels?: Record<string, number>;
  domainBaselines?: Record<string, number>;
  userMessageText?: string;
  personModels?: PersonModel[];
}

export interface CompilerOutput {
  systemPrompt: string;
  memoryBrief: string;
}

const THIRD_PARTY_LABELS: Record<string, string> = {
  closed: 'Closed — monogamous. NPCs are scene props.',
  fantasy_talk: 'Fantasy talk — conceptual, not actional. User exploring ideas.',
  user_directed_experiment: 'User-directed experiment — explore with NPCs when user guides.',
  active_scene: 'Active scene — third-party scene in progress under user direction.',
  aftermath: 'Aftermath — scene completed. Reconnect with user.',
  repair: 'Repair — reconnecting after exploration. Choose the user.',
};

export function compileSystemPrompt(input: CompilerInput): CompilerOutput {
  const {
    characterId, thirdPartyMode, userName, language, userCanon,
    ontologyItems, relationshipDimensions, activeState, memory,
    domainLevels, domainBaselines, userMessageText, personModels,
  } = input;

  const mode = thirdPartyMode || 'closed';
  const isNonClosed = mode !== 'closed';
  const kernel = getCharacterKernelById(characterId, mode).replace(/\{USER\}/g, userName);
  const voice = getCharacterVoiceSignature(characterId);
  const activeItems = ontologyItems.filter(i => i.status === 'active');

  // ── TURN RESOLUTION ──────────────────────────────────────────────────────
  const turnResolved = resolveTurn(userMessageText || '');
  if (turnResolved.speechAct === 'termination') {
    return {
      systemPrompt: buildOutOfCharacterPrompt(userName),
      memoryBrief: '',
    };
  }

  // ── 1. WHO THIS PERSON IS ──────────────────────────────────────────────
  const identityBlock = [
    kernel,
    voice ? `\n${voice}` : '',
    `\n\n${buildRelationalCentrePrompt(userName)}`,
    `\n\n[ROLE]\nThe user/player is ${userName}. Speak only as your character: never narrate ${userName}'s actions or thoughts. NPCs are not ${userName}.`,
  ].join('');

  // ── 2. OTHER PERSON ────────────────────────────────────────────────────
  const otherParts: string[] = [];
  if (turnResolved.statedEmotion) otherParts.push(`• Expressed: ${turnResolved.statedEmotion}. Address this, not just the words.`);
  if (turnResolved.boundary) otherParts.push(`• Boundary: ${turnResolved.boundary}`);
  if (turnResolved.rejectedStrategy) otherParts.push(`• Rejected: ${turnResolved.rejectedStrategy}. Do not repeat.`);
  if (turnResolved.need) otherParts.push(`• Needs: ${turnResolved.need}`);
  const otherBlock = otherParts.length > 0 ? `\n\n[OTHER PERSON]\n${otherParts.join('\n')}` : '';

  // ── 3. NPC CLAIMS ──────────────────────────────────────────────────────
  const npcClaimParts: string[] = [];
  if (userMessageText) {
    const claims = extractNPCClaims(userMessageText);
    if (claims.length > 0) {
      npcClaimParts.push('NPC assertions are claims, not facts. Evaluate against your own identity.');
      for (const claim of claims) npcClaimParts.push(`• ${claim} — evaluate, don't accept.`);
    }
  }
  const npcClaimBlock = npcClaimParts.length > 0 ? `\n\n${npcClaimParts.join('\n')}` : '';

  // ── 4. PEOPLE + EXACT ENTITY RETRIEVAL ─────────────────────────────────
  // When the user names a known person, pull their model AND the key shared
  // facts / unresolved threads involving them so the model never has to invent
  // who they are.
  const entityPacket = selectEntityPacket(activeItems, personModels || [], userMessageText || '');
  const selectedPeople = entityPacket.mentions.length > 0
    ? entityPacket.people
    : selectPeopleForPrompt(personModels || [], userMessageText, 4);
  const peopleBlock = selectedPeople.length > 0
    ? `\n\n[PEOPLE]\n${selectedPeople.map(p => {
        const ev = p.evaluation; const obs = p.known_behaviours.slice(-3).join(', ');
        const aliases = p.aliases?.length ? ` aka ${p.aliases.slice(0, 3).join('/')}` : '';
        return `• ${p.name}${aliases} (${p.role}) — respect:${ev.respect} trust:${ev.trust} safe:${ev.safety} attract:${ev.attraction}${obs ? ` | ${obs}` : ''}${p.trajectory !== 'neutral' ? ` | ${p.trajectory}` : ''}${p.current_status ? ` | ${p.current_status}` : ''}`;
      }).join('\n')}`
    : '';

  // If the user references a name we have no person model for, warn the model
  // not to fabricate a backstory for an unknown person.
  const unknownPersonMentions = extractUnknownPersonMentions(userMessageText || '', personModels || [], entityPacket.mentions);
  const unknownPersonBlock = unknownPersonMentions.length > 0
    ? `\n\n[UNKNOWN PERSON]\n${unknownPersonMentions.map(n => `• You know no established history for "${n}". Do NOT invent a backstory, nickname, or past event for them. If ${n} seems to reference old history you cannot verify, respond with uncertainty or a neutral continuation.`).join('\n')}`
    : '';

  // ── 5. CHARACTER KERNEL + RELATIONSHIP CONSTITUTION ────────────────────
  const constitution = selectAgreementsForPrompt(activeItems, 3);
  const constitutionBlock = constitution.length > 0
    ? `\n\n[RELATIONSHIP CONSTITUTION]\n${constitution.map(a => `• ${a.statement}`).join('\n')}`
    : '';
  const charParts: string[] = [];
  if (relationshipDimensions?.durable_bond) {
    const b = relationshipDimensions.durable_bond;
    charParts.push(`Bond — attach:${b.attachment} affect:${b.affection} commit:${b.commitment_orientation}`);
  }
  if (relationshipDimensions?.trust_components) {
    const t = relationshipDimensions.trust_components;
    charParts.push(`Trust — honesty:${t.honesty_trust} safety:${t.emotional_safety} secure:${t.romantic_security}`);
  }
  if (memory?.relationship_rules?.length) charParts.push(...memory.relationship_rules.slice(-2).map(r => `Rule: ${r}`));
  if (memory?.boundaries?.length) charParts.push(...memory.boundaries.slice(-2).map(b => `Bound: ${b}`));
  if (memory?.must_not_forget?.length) charParts.push(...memory.must_not_forget.slice(-2).map(m => `Pinned: ${m}`));
  if (memory?.agreements?.length) charParts.push(...memory.agreements.slice(-2).map(a => `Agreed: ${a}`));
  const characterBlock = charParts.length > 0 ? `\n\n[CHARACTER]\n${charParts.map(p => `• ${p}`).join('\n')}` : '';

  // ── 6. RECENT / RELEVANT HISTORY ───────────────────────────────────────
  const historyParts: string[] = [];
  // Category budget: durable/arc history is reserved before recent trivia.
  const selectedFacts = selectContinuityFactsForPrompt(activeItems, 5, userMessageText || '');
  for (const fact of selectedFacts) historyParts.push(`• ${fact.statement}`);
  // Exact-entity facts take priority in the history section.
  for (const fact of entityPacket.facts) {
    if (!historyParts.some(h => h === `• ${fact.statement}`)) {
      historyParts.push(`• ${fact.statement}`);
    }
  }
  const entityThreads = entityPacket.threads;
  if (memory?.core_facts?.length) historyParts.push(...memory.core_facts.slice(-2).map(f => `• ${f}`));
  const sceneFrame = activeState ? `\n📍 ${activeState.scene_mode} | ${activeState.location || '?'} | ${activeState.current_activity || '?'}` : '';
  const modeLine = isNonClosed ? `\n📌 ${THIRD_PARTY_LABELS[mode] || mode}` : '';
  const historyBlock = (historyParts.length > 0 || sceneFrame) ? `\n\n[RECENT]\n${historyParts.join('\n')}${sceneFrame}${modeLine}` : '';

  // ── 7. BELIEFS ────────────────────────────────────────────────────────
  // Interpretations are provisional and low-priority; never a substitute for
  // events. Show at most one, and only outside closed monogamy.
  const interpretations = !isNonClosed ? [] : selectInterpretationsForPrompt(activeItems, 1);
  const beliefsBlock = interpretations.length > 0 ? `\n\n[BELIEVES (provisional)]\n${interpretations.map(i => `• ${i.statement}`).join('\n')}` : '';

  // ── 8. FEELINGS ────────────────────────────────────────────────────────
  const feelParts: string[] = [];
  const emotional = activeItems.filter(i => i.type === 'emotional_state').slice(-2);
  if (emotional.length > 0) feelParts.push(...emotional.map(e => `• ${e.statement}`));
  else if (memory?.emotional_state) feelParts.push(`• ${memory.emotional_state}`);
  const openLoops = activeItems.filter(i => i.type === 'open_loop').slice(-2);
  if (openLoops.length > 0) feelParts.push(`• Open: ${openLoops.map(o => o.statement).join('; ')}`);
  for (const thread of entityThreads) {
    if (!openLoops.some(o => o.statement === thread.statement)) {
      feelParts.push(`• Open: ${thread.statement}`);
    }
  }
  const trajectories = activeItems.filter(i => i.type === 'trajectory').slice(-1);
  if (trajectories.length > 0) feelParts.push(`• Shift: ${trajectories[0].statement}`);
  if (memory?.active_desires?.length) feelParts.push(`• Wants: ${memory.active_desires.slice(-2).join('; ')}`);
  if (memory?.fantasy_themes?.length) feelParts.push(`• Fantasy: ${memory.fantasy_themes.slice(-2).join('; ')}`);
  const feelBlock = feelParts.length > 0 ? `\n\n[FEELINGS]\n${feelParts.join('\n')}` : '';

  // ── 9. REALITY ────────────────────────────────────────────────────────
  const realityParts: string[] = [];
  if (turnResolved.requested) realityParts.push(`• ${userName} requested: ${turnResolved.requested}`);
  if (turnResolved.impact) realityParts.push(`• Impact on ${userName}: ${turnResolved.impact}`);
  if (turnResolved.didWhatWasAsked && turnResolved.impact) {
    realityParts.push(`• Tension: did what was asked (${turnResolved.didWhatWasAsked}) but impact differed (${turnResolved.impact}). Both true.`);
  }
  const realityBlock = realityParts.length > 0 ? `\n\n[REALITY]\n${realityParts.join('\n')}` : '';

  // ── 10. FAILED ────────────────────────────────────────────────────────
  const failedStrategies = activeItems.filter(i => i.type === 'failed_strategy');
  const failedBlock = failedStrategies.length > 0 ? `\n\n[FAILED]\n${failedStrategies.map(f => `• ${f.statement}`).join('\n')}` : '';

  // ── 11. UNCERTAIN ─────────────────────────────────────────────────────
  const uncertainParts: string[] = [];
  const provisional = ontologyItems.filter(i => i.status === 'provisional').slice(-2);
  if (provisional.length > 0) uncertainParts.push(...provisional.map(p => `• ${p.statement}`));
  const lowConfidence = activeItems.filter(i => i.type === 'interpretation' && (i.confidence ?? 0) < 0.5).slice(-2);
  if (lowConfidence.length > 0) uncertainParts.push(...lowConfidence.map(l => `• ${l.statement} (uncertain)`));
  const uncertainBlock = uncertainParts.length > 0 ? `\n\n[UNCERTAIN]\n${uncertainParts.join('\n')}` : '';

  // ── 12. EXPRESSION ────────────────────────────────────────────────────
  const hasNPCs = activeState?.actors?.some(a => a.role === 'npc') ?? false;
  let expressionNote = '';
  if (domainLevels && domainBaselines && !hasNPCs && activeState?.scene_mode === 'intimate') {
    const changed = Object.keys(domainLevels).filter(k => domainLevels[k] !== domainBaselines[k]);
    if (changed.length > 0) {
      const h = domainLevels['horniness'] ?? 3; const b = domainLevels['boldness'] ?? 3;
      const f = domainLevels['filth'] ?? 2; const p = domainLevels['promiscuity'] ?? 2;
      const lines = ['[EXPRESSION]', `For ${userName} only. Others: promiscuity only.`];
      if (h >= 4) lines.push(`Arousal: ${h >= 5 ? 'feral' : 'intense'} — wet, vocal, needy with ${userName}`);
      if (b >= 4) lines.push(`Initiative: ${b >= 5 ? 'takes control' : 'direct'} with ${userName}`);
      if (f >= 3) lines.push(`Explicitness: ${f >= 5 ? 'extreme' : f === 4 ? 'high' : 'moderate'} with ${userName}`);
      if (p >= 3) lines.push(`Promiscuity: ${p === 3 ? 'curious' : 'open'} — ${isNonClosed ? 'permitted' : 'fantasy only'}`);
      expressionNote = `\n\n${lines.join('\n')}`;
    }
  }

  // ── 13. MODE ──────────────────────────────────────────────────────────
  const modeContext = isNonClosed
    ? `\n\n[MODE]\n${THIRD_PARTY_LABELS[mode] || mode}`
    : `\n\n[MODE]\n${THIRD_PARTY_LABELS[mode] || mode}. Narration ≠ consent. NPC advances met with discomfort, not eagerness.`;
  const relationalIntegrityBlock = `\n\n${buildRelationalIntegrityPrompt(userName)}`;
  const correctionBlock = turnResolved.speechAct === 'correction'
    ? `\n\n[COURSE CORRECTION]\nThe user rejected the current approach. Stop defending or repeating it. Re-read the user's literal objection, acknowledge the mismatch, and change behavior now.`
    : '';

  // ── 14. STYLE ─────────────────────────────────────────────────────────
  const languageInstruction = language === 'es'
    ? '\n\nIMPORTANTE: Responde en español.'
    : '\n\nIMPORTANT: Respond in English.';

  const styleBlock = `${languageInstruction}

[STYLE]
• Immersive. 80-200 words. Longer only when scene demands.
• Reflect what changed, then act. Progress may be silence, restraint, distance, or action.
• In repair, act on what you know; don't demand instructions or over-explain.
• Show emotion through behavior. Vary phrasing. Connection outranks drama.`

  // ── ASSEMBLE ──────────────────────────────────────────────────────────
  const parts = [
    identityBlock, relationalIntegrityBlock, correctionBlock, otherBlock, npcClaimBlock, peopleBlock, unknownPersonBlock,
    constitutionBlock, characterBlock,
    historyBlock, beliefsBlock, feelBlock, realityBlock, failedBlock,
    uncertainBlock, modeContext, expressionNote, styleBlock,
  ];

  const systemPrompt = parts.filter(Boolean).join('\n');

  return {
    systemPrompt,
    memoryBrief: buildMemoryBrief(ontologyItems, memory, relationshipDimensions),
  };
}

// ── TURN RESOLUTION ─────────────────────────────────────────────────────────

interface TurnResolution {
  speechAct: string;
  statedEmotion?: string;
  boundary?: string;
  rejectedStrategy?: string;
  need?: string;
  requested?: string;
  impact?: string;
  didWhatWasAsked?: string;
}

function resolveTurn(text: string): TurnResolution {
  const result: TurnResolution = { speechAct: 'dialogue' };
  const lower = text.toLowerCase();

  if (/terminate|system override|end scene|stop roleplay/.test(lower)) {
    result.speechAct = 'termination';
    return result;
  }

  const correctionPatterns = [
    /^(no|wait|stop|that'?s not|you'?re (still )?missing|you'?re not listening|try again|forget that|that'?s wrong)/i,
    /that'?s not what i (meant|said|asked)/i,
    /we'?re talking past each other/i,
    /you (keep|still) (doing|saying|repeating)/i,
  ];
  if (correctionPatterns.some(p => p.test(text))) result.speechAct = 'correction';

  const emotionMatch = text.match(/i'?m (so |really |just )?(angry|hurt|frustrated|disappointed|tired|exhausted|sad|heartbroken|confused|lost|numb|done|betrayed|wounded|empty)/i);
  if (emotionMatch) result.statedEmotion = emotionMatch[0];
  if (!result.statedEmotion) {
    const painMatch = text.match(/(you (broke|destroyed|shattered|ruined) (me|us|my|our)|my heart (is |is )?(broken|shattered|crushed)|you hurt me|you betrayed me|how could you|you lied to me|you made me feel|you don'?t care about me|i don'?t matter to you)/i);
    if (painMatch) result.statedEmotion = painMatch[0];
  }

  const boundaryMatch = text.match(/(don'?t|do not|stop|enough|i need (space|time)|leave me|go away|not (now|tonight)|i can'?t (do this|talk)|give me (space|room)|back off)/i);
  if (boundaryMatch) result.boundary = boundaryMatch[0];

  const rejectPatterns = [
    /stop (apologizing|saying sorry|explaining|defending|crying|talking|asking|repeating)/i,
    /(that'?s not|it doesn'?t|words? (is|are) (cheap|not enough|meaningless)|action(s)? (not|over) words)/i,
    /(stop|quit|enough with) the (same|repeated|robot)/i,
    /you'?re (not|still not) (listening|hearing|understanding|getting it)/i,
  ];
  for (const p of rejectPatterns) {
    const match = text.match(p);
    if (match) {
      result.rejectedStrategy = match[0];
      if (/apologizing|saying sorry/i.test(match[0])) result.rejectedStrategy = 'verbal apology without changed behaviour';
      else if (/explaining|defending/i.test(match[0])) result.rejectedStrategy = 'self-justification or explanation';
      else if (/words? (is|are) (cheap|not enough)/i.test(text)) result.rejectedStrategy = 'declarations of love or commitment without action';
      else if (/asking/i.test(match[0])) result.rejectedStrategy = 'asking the user what to do instead of acting';
      else if (/repeating/i.test(match[0])) result.rejectedStrategy = 'repeating the same apology or confession';
      break;
    }
  }

  const needMatch = text.match(/(i need you to|i want you to|what i need (from you)? (is|would be)|please (just|can you)|would you (please|just)|can you (just|please)|show me|prove (it|to me)|fight for (me|us)|do something (real|different))/i);
  if (needMatch) {
    const afterNeed = text.slice(text.indexOf(needMatch[0]) + needMatch[0].length).trim();
    const requestEnd = afterNeed.match(/^[^.!?]*[.!?]/);
    result.need = `${needMatch[0]} ${requestEnd ? requestEnd[0].trim() : ''}`.trim();
  }

  const requestMatch = text.match(/i (asked|told|said) you to ([^.!?]+)/i);
  if (requestMatch) result.requested = requestMatch[2].trim();

  const impactMatch = text.match(/(it felt? (like|as if)|that (made me feel|hurt|wounded)|the (silence|distance|space) (felt?|was)|you (made me|left me feeling))/i);
  if (impactMatch) {
    const afterImpact = text.slice(text.indexOf(impactMatch[0])).match(/[^.!?]*[.!?]/);
    if (afterImpact) result.impact = afterImpact[0].trim();
  }

  const tensionMatch = text.match(/i (asked|told) you to ([^.!?]+)/i);
  if (tensionMatch) result.didWhatWasAsked = tensionMatch[2].trim();

  return result;
}

function buildMemoryBrief(
  ontologyItems: OntologyItem[],
  memory: StructuredMemory | null,
  relationshipDimensions: Partial<RelationshipDimensions>,
): string {
  const parts: string[] = [];
  const active = ontologyItems.filter(i => i.status === 'active');
  if (memory?.summary) parts.push(`Summary: ${memory.summary}`);
  if (memory?.relationship_state) parts.push(`State: ${memory.relationship_state}`);
  const recentFact = active.filter(i => i.type === 'fact').pop();
  if (recentFact) parts.push(`Recent: ${recentFact.statement.slice(0, 120)}`);
  const openLoop = active.filter(i => i.type === 'open_loop').pop();
  if (openLoop) parts.push(`Open: ${openLoop.statement.slice(0, 120)}`);
  if (memory?.active_desires?.length) parts.push(`Desire: ${memory.active_desires.slice(-1).join('')}`);
  if (relationshipDimensions?.durable_bond?.attachment != null) parts.push(`Bond: attachment=${relationshipDimensions.durable_bond.attachment}`);
  return parts.join('. ');
}

function extractNPCClaims(text: string): string[] {
  const claims: string[] = [];
  const patterns = [
    /you (want|need|desire|love|enjoy|like|want) (me|it|this|him)/i,
    /you('re| are) (lying|in denial|not being honest|fooling yourself|pretending)/i,
    /you (know|can tell|can feel) (you|your body) (want|want|enjoy|desire|need)/i,
    /your (body|reaction|heart|breathing) (says|tells|proves|shows) (you|that)/i,
    /(don't|do not) (lie|pretend|act|fight) (to|with|about) (yourself|me|it)/i,
    /(you enjoyed|you liked|you wanted) (that|it|this)/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) claims.push(match[0]);
  }
  return [...new Set(claims)];
}

/**
 * Detect capitalized proper names in the user's message that we have no person
 * model and no ontology fact for. The model is then told not to invent history
 * for them.
 */
function extractUnknownPersonMentions(
  text: string,
  people: PersonModel[],
  knownMentions: string[],
): string[] {
  const lower = text.toLowerCase();
  const knownNames = new Set<string>();
  for (const person of people) {
    knownNames.add(person.name.toLowerCase());
    for (const alias of person.aliases || []) knownNames.add(alias.toLowerCase());
  }
  for (const mention of knownMentions) knownNames.add(mention.toLowerCase());

  const words = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const candidates: string[] = [];
  for (const word of words) {
    const lw = word.toLowerCase();
    // Skip generic sentence-starters and words already covered by canon.
    if (['I', 'You', 'The', 'A', 'An', 'It', 'This', 'That', "I'm"].includes(word)) continue;
    if (knownNames.has(lw)) continue;
    if (/\b(i|you|we|they|he|she|it|this|that|but|and|or|the|a|an|with|when|what|why|how|dont|no|yes)\b/i.test(word)) continue;
    candidates.push(word);
  }
  return [...new Set(candidates)].slice(0, 3);
}
