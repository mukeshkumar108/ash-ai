import type { StructuredMemory } from './summarizer';

export function formatRelationalGuidanceToPrompt(
  guidance: NonNullable<StructuredMemory['relational_guidance']>,
): string {
  const sections = [
    '[RELATIONSHIP DIRECTION]',
    'This is hidden trajectory guidance. It should constrain random contradiction, not hard-script the reply.',
    `Core Relationship Direction: ${guidance.core_relationship_direction}`,
    `User Desired Direction: ${guidance.user_desired_direction}`,
    `Dominant Tension: ${guidance.dominant_tension}`,
    `Supportive Arc Pressure: ${guidance.supportive_arc_pressure}`,
  ];

  const allowedResistanceStyles = guidance.allowed_resistance_styles || [];
  const disallowedDrift = guidance.disallowed_drift || [];

  if (allowedResistanceStyles.length > 0) {
    sections.push(
      `Allowed Resistance Styles: ${allowedResistanceStyles.join(', ')}`,
    );
  }

  if (disallowedDrift.length > 0) {
    sections.push(`Disallowed Drift: ${disallowedDrift.join('; ')}`);
  }

  return sections.join('\n');
}

export function createRelationalGuidanceBrief(
  guidance?: StructuredMemory['relational_guidance'],
): string {
  if (!guidance) {
    return '';
  }

  const allowedResistanceStyles = guidance.allowed_resistance_styles || [];

  return [
    `Direction=${guidance.core_relationship_direction}`,
    `UserSteer=${guidance.user_desired_direction}`,
    `Tension=${guidance.dominant_tension}`,
    allowedResistanceStyles.length > 0
      ? `Resistance=${allowedResistanceStyles.slice(0, 2).join('/')}`
      : '',
  ]
    .filter(Boolean)
    .join('. ');
}

export function formatStructuredMemoryToPrompt(
  memory: StructuredMemory,
  activeState?: { scene_mode?: string },
): string {
  const sections = [
    '[CHARACTER CANON MEMORY]',
    'Primary story facts and established truths. These are the character\'s canon — not the user\'s.',
  ];

  const coreFacts = memory.core_facts || [];
  const majorEvents = memory.major_events || [];

  // 1. Core Facts (Tightly capped)
  if (coreFacts.length > 0) {
    sections.push('\n[CORE FACTS]');
    sections.push(...coreFacts.slice(-4).map((fact) => `• ${fact}`));
  }

  // 2. Critical Continuity (Rules, Boundaries, Pinned) — compact
  const critical = [
    ...(memory.relationship_rules || []).slice(-3).map(r => `Rule: ${r}`),
    ...(memory.boundaries || []).slice(-3).map(b => `Boundary: ${b}`),
    ...(memory.must_not_forget || []).slice(-3).map(m => `Pinned: ${m}`),
  ];
  if (critical.length > 0) {
    sections.push('\n[CRITICAL STANDING CANON]');
    sections.push(...critical.map(c => `• ${c}`));
  }

  // 3. Recent Major Events (Tightly capped)
  if (majorEvents.length > 0) {
    sections.push('\n[RECENT MAJOR EVENTS]');
    sections.push(...majorEvents.slice(-3).map((event) => `• ${event}`));
  }

  // 4. Relationship & Emotional State — one-liner
  const relState = [memory.relationship_state, memory.emotional_state].filter(Boolean).join(' | ');
  if (relState) {
    sections.push(`\n[RELATIONAL CONTEXT]\n${relState}`);
  }

  // 5. Shared History (Tight)
  const history = [
    ...(memory.relationship_milestones || []).slice(-2).map(m => `Milestone: ${m}`),
    ...(memory.shared_memories || []).slice(-2).map(s => `Shared: ${s}`),
  ];
  if (history.length > 0) {
    sections.push('\n[BACKGROUND HISTORY]');
    sections.push(...history.map(h => `• ${h}`));
  }

  // 6. Summary (always), Recap (compact)
  sections.push(`\n[SUMMARY]\n${memory.summary}`);

  if (memory.recent_scene_recap) {
    const shortRecap = memory.recent_scene_recap.length > 200
      ? memory.recent_scene_recap.slice(0, 200) + '...'
      : memory.recent_scene_recap;
    sections.push(`\n[RECENT RECAP]\n${shortRecap}`);
  }

  // 7. Sexual history — only in intimate/aftercare scenes, tightly capped
  if (memory.sexual_history && activeState?.scene_mode && ['intimate', 'aftercare'].includes(activeState.scene_mode)) {
    const sh = memory.sexual_history;
    const parts: string[] = [];
    if (sh.favorite_things?.length) parts.push(`Loves: ${sh.favorite_things.slice(-2).join(', ')}`);
    if (sh.acts?.length) parts.push(`Acts: ${sh.acts.slice(-2).join(', ')}`);
    if (sh.aftercare_needs?.length) parts.push(`Aftercare: ${sh.aftercare_needs.slice(-1).join(', ')}`);
    if (sh.dirty_phrases_used?.length) parts.push(`Talk: ${sh.dirty_phrases_used.slice(-2).join(', ')}`);
    if (parts.length) {
      sections.push(`\n[SEXUAL HISTORY]\n${parts.join(' | ')}`);
    }
  }

  // 8. Corruption — one line
  if (memory.corruption_level > 0) {
    sections.push(`\n[CORRUPTION]: ${memory.corruption_level}/10`);
  }

  // 9. Desires & themes — compact
  const desiresEntries: string[] = [];
  if ((memory.fantasy_themes ?? []).length > 0) {
    desiresEntries.push(...memory.fantasy_themes!.slice(-2).map(f => `Fantasy: ${f}`));
  }
  if ((memory.active_desires ?? []).length > 0) {
    desiresEntries.push(...memory.active_desires!.slice(-2).map(d => `Desire: ${d}`));
  }
  if ((memory.decisions_and_commitments ?? []).length > 0) {
    desiresEntries.push(...memory.decisions_and_commitments!.slice(-2).map(d => `Decided: ${d}`));
  }
  if (desiresEntries.length > 0) {
    sections.push('\n[ACTIVE PUSHES]');
    sections.push(...desiresEntries.map(e => `• ${e}`));
  }

  return sections.join('\n');
}

export function createToolMemoryBrief(
  memory: StructuredMemory,
  maxItems = 5,
): string {
  // Create a compact brief for tools with most relevant RP information
  const brief: string[] = [];

  brief.push(`Relationship Summary: ${memory.summary}`);
  brief.push(`Relationship State: ${memory.relationship_state}`);
  brief.push(`Emotional State: ${memory.emotional_state}`);
  if (memory.corruption_level > 0)
    brief.push(`Corruption: ${memory.corruption_level}/10`);

  const majorEvents = memory.major_events || [];
  const significantIncidents = memory.significant_incidents || [];
  const relationshipMilestones = memory.relationship_milestones || [];
  const openEmotionalThreads = memory.open_emotional_threads || [];
  const promisesAndCommitments = memory.promises_and_commitments || [];
  const decisionsAndCommitments = memory.decisions_and_commitments || [];
  const peopleRegistry = memory.people_registry || [];
  const relationshipRules = memory.relationship_rules || [];
  const agreements = memory.agreements || [];
  const boundaries = memory.boundaries || [];
  const mustNotForget = memory.must_not_forget || [];
  const activeDesires = memory.active_desires || [];

  if (majorEvents.length > 0) {
    brief.push(
      `Major Event: ${majorEvents[majorEvents.length - 1]}`,
    );
  } else if (significantIncidents.length > 0) {
    brief.push(
      `Incident: ${significantIncidents[significantIncidents.length - 1]}`,
    );
  } else if (relationshipMilestones.length > 0) {
    brief.push(
      `Recent Milestone: ${relationshipMilestones[relationshipMilestones.length - 1]}`,
    );
  }

  if (openEmotionalThreads.length > 0) {
    brief.push(
      `Open Thread: ${openEmotionalThreads[openEmotionalThreads.length - 1]}`,
    );
  }

  if (promisesAndCommitments.length > 0) {
    brief.push(
      `Commitment: ${promisesAndCommitments[promisesAndCommitments.length - 1]}`,
    );
  }

  if (decisionsAndCommitments.length > 0) {
    brief.push(
      `Decision: ${decisionsAndCommitments[decisionsAndCommitments.length - 1]}`,
    );
  }

  if (peopleRegistry.length > 0) {
    brief.push(`People: ${peopleRegistry.slice(-2).join('; ')}`);
  }

  if (relationshipRules.length > 0) {
    brief.push(
      `Rule: ${relationshipRules[relationshipRules.length - 1]}`,
    );
  }

  if (agreements.length > 0) {
    brief.push(
      `Agreement: ${agreements[agreements.length - 1]}`,
    );
  }

  if (boundaries.length > 0) {
    brief.push(
      `Boundary: ${boundaries[boundaries.length - 1]}`,
    );
  }

  if (mustNotForget.length > 0) {
    brief.push(
      `Pinned Canon: ${mustNotForget.slice(-2).join('; ')}`,
    );
  }

  if (activeDesires.length > 0) {
    brief.push(`Current Desire: ${activeDesires[activeDesires.length - 1]}`);
  }

  if ((memory.fantasy_themes ?? []).length > 0) {
    brief.push(`Fantasy: ${memory.fantasy_themes?.slice(-2).join('; ')}`);
  }

  if ((memory.decisions_and_commitments ?? []).length > 0) {
    brief.push(`Decided: ${memory.decisions_and_commitments?.slice(-2).join('; ')}`);
  }

  if (memory.sexual_history?.favorite_things?.length) {
    const sh = memory.sexual_history;
    if (sh.favorite_things?.length) {
      brief.push(`Loves in bed: ${sh.favorite_things.slice(-2).join(', ')}`);
    }
  }

  if (memory.relational_guidance) {
    brief.push(`Direction: ${createRelationalGuidanceBrief(memory.relational_guidance)}`);
  }

  if (memory.recent_scene_recap && majorEvents.length === 0) {
    brief.push(`Recent Scene: ${memory.recent_scene_recap}`);
  }

  return brief.join('. ');
}

export function recencyWeighting(
  originalMemory: StructuredMemory,
  recentMessages: any[],
): StructuredMemory {
  // Mark milestones/memories from recent messages as [RECENT]
  const recentContent = recentMessages
    .slice(-2)
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.parts)) {
        return m.parts.map((p: any) => p.text || '').join(' ');
      }
      return '';
    })
    .join(' ');

  const recentLower = recentContent.toLowerCase();

  const markRecent = (text: string) => {
    if (!text) return text;
    const textLower = text.toLowerCase();
    const words = textLower.split(' ').filter((word) => word.length > 3);
    const isRecent = words.some((word) => recentLower.includes(word));
    return isRecent && !text.includes('[RECENT]') ? `[RECENT] ${text}` : text;
  };

  return {
    ...originalMemory,
    core_facts: (originalMemory.core_facts || []).map(markRecent),
    relationship_milestones: (originalMemory.relationship_milestones || []).map(markRecent),
    major_events: (originalMemory.major_events || []).map(markRecent),
    emotional_turns: (originalMemory.emotional_turns || []).map(markRecent),
    promises_and_commitments:
      (originalMemory.promises_and_commitments || []).map(markRecent),
    shared_memories: (originalMemory.shared_memories || []).map(markRecent),
    characters_and_npcs: (originalMemory.characters_and_npcs || []).map(markRecent),
    people_registry: (originalMemory.people_registry || []).map(markRecent),
    significant_incidents: (originalMemory.significant_incidents || []).map(markRecent),
    decisions_and_commitments:
      (originalMemory.decisions_and_commitments || []).map(markRecent),
    relationship_rules: (originalMemory.relationship_rules || []).map(markRecent),
    agreements: (originalMemory.agreements || []).map(markRecent),
    boundaries: (originalMemory.boundaries || []).map(markRecent),
    must_not_forget: (originalMemory.must_not_forget || []).map(markRecent),
    active_desires: (originalMemory.active_desires || []).map(markRecent),
    fantasy_themes: (originalMemory.fantasy_themes || []).map(markRecent),
    relational_guidance: originalMemory.relational_guidance,
    open_emotional_threads: (originalMemory.open_emotional_threads || []).map(markRecent),
    resolved_threads: (originalMemory.resolved_threads || []).map(markRecent),
    recent_scene_recap: markRecent(originalMemory.recent_scene_recap),
    metadata: {
      ...originalMemory.metadata,
      confidence: Math.min((originalMemory.metadata?.confidence ?? 0.5) + 0.1, 1.0),
    },
  };
}
