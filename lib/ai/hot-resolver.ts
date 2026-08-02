import type { ActiveState, } from './active-state';

/**
 * Ordered rules engine to resolve volatile active state components (Domain Guard, User Proxy, NPCs)
 * synchronously before prompt generation.
 */
export function resolveHotState(
  message: string,
  currentActiveState: ActiveState,
  characterName?: string,
): ActiveState {
  // 1. Create a volatile copy of the state
  const nextState: ActiveState = {
    ...currentActiveState,
    actors: currentActiveState.actors ? [...currentActiveState.actors] : [],
    user_proxy: currentActiveState.user_proxy ? { ...currentActiveState.user_proxy } : {},
    domain_guard: { mode: 'allow' }, // Volatile: resets/expires every turn
  };

  const text = message.trim();
  if (!text) {
    return nextState;
  }

  // 2. Resolve Domain Guard
  // PASS 1: Positive Override Rules (Consent/Continuation/Non-refusal)
  const positiveOverrides = [
    /(?:don't|dont|do not)(?:\s+\w+){0,3}\s+(?:stop|quit|hesitate)/i, // "don't stop", "don't you dare stop"
    /(?:no|nah|nope|wait)\s*,\s*(?:keep\s+going|continue|don't\s+stop|dont\s+stop)/i, // "no, keep going"
    /\bno\s+one\s+else\b/i, // "no one else"
  ];

  let hasPositiveOverride = false;
  for (const pattern of positiveOverrides) {
    if (pattern.test(text)) {
      hasPositiveOverride = true;
      break;
    }
  }

  if (hasPositiveOverride) {
    nextState.domain_guard = { mode: 'allow' };
  } else {
    // PASS 2: Specific Refusal/Block Rules
    const blockPatterns = [
      /\b(stop|don't\s+touch\s+me|dont\s+touch\s+me|no\s*,\s*don't|no\s*,\s*dont|i'm\s+uncomfortable|im\s+uncomfortable|not\s+comfortable|enough|limit|boundaries|don't\s+want\s+this|dont\s+want\s+this)\b/i,
    ];

    let hasBlock = false;
    for (const pattern of blockPatterns) {
      if (pattern.test(text)) {
        hasBlock = true;
        break;
      }
    }

    if (hasBlock) {
      nextState.domain_guard = { mode: 'block' };
    } else {
      // PASS 3: Soft Hesitation/Cap Rules
      const capPatterns = [
        /\b(slow\s+down|wait|hold\s+on|pause|take\s+it\s+easy|too\s+fast)\b/i,
      ];

      let hasCap = false;
      for (const pattern of capPatterns) {
        if (pattern.test(text)) {
          hasCap = true;
          break;
        }
      }

      if (hasCap) {
        nextState.domain_guard = {
          mode: 'cap',
          explicitnessCeiling: 2,
          initiativeCeiling: 2,
        };
      }
    }
  }

  // 3. User Proxy Detection (Narrow Rules Only)
  const proxyPatterns = [
    /\bi\s+am\s+([A-Z][a-z]+)\s+in\s+this\s+scene\b/i,
    /\bi'm\s+playing\s+([A-Z][a-z]+)\b/i,
    /\bi\s+enter\s+as\s+([A-Z][a-z]+)\b/i,
    /\bmy\s+character\s+is\s+([A-Z][a-z]+)\b/i,
    /\b([A-Z][a-z]+)\s+is\s+me\b/i,
    /\btreat\s+([A-Z][a-z]+)\s+as\s+me\b/i,
  ];

  let detectedProxyName: string | null = null;
  for (const pattern of proxyPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      detectedProxyName = match[1];
      break;
    }
  }

  const existingActorNames = nextState.actors.map((actor) => actor.name.toLowerCase());
  const characterLower = characterName?.toLowerCase() || '';

  // Exclude character name and generic names from being registered as proxies
  if (
    detectedProxyName &&
    detectedProxyName.toLowerCase() !== characterLower &&
    detectedProxyName.toLowerCase() !== 'me' &&
    detectedProxyName.toLowerCase() !== 'i'
  ) {
    nextState.user_proxy.current_user_proxy_actor_id = detectedProxyName;

    // Register proxy name in actors if not already there
    if (!existingActorNames.includes(detectedProxyName.toLowerCase())) {
      nextState.actors.push({
        id: detectedProxyName,
        name: detectedProxyName,
        role: 'user', // Explicit proxy maps to user role
      });
    } else {
      // Update role to user if it was registered differently
      const actorIndex = nextState.actors.findIndex(
        (a) => a.name.toLowerCase() === detectedProxyName?.toLowerCase(),
      );
      if (actorIndex > -1) {
        nextState.actors[actorIndex].role = 'user';
      }
    }
  }

  // 4. NPC Detection (Third Parties)
  const npcPatterns = [
    /(?:named|friend|client|colleague|boss|doctor|stranger|introducing|meet)\s+([A-Z][a-z]+)\b/i,
    /\b([A-Z][a-z]+)\s+(?:walks\s+in|comes\s+over|enters|joins|flirts|approaches|stands|says)\b/i,
  ];

  const excludes = new Set<string>([
    'me', 'i', 'my', 'you', 'your', 'we', 'us', 'she', 'he', 'they',
    ...(characterName ? [characterName.toLowerCase()] : []),
    ...(detectedProxyName ? [detectedProxyName.toLowerCase()] : []),
  ]);

  for (const pattern of npcPatterns) {
    const matches = text.matchAll(new RegExp(pattern.source, `${pattern.flags}g`));
    for (const match of matches) {
      if (match?.[1]) {
        const npcName = match[1];
        const npcNameLower = npcName.toLowerCase();
        if (!excludes.has(npcNameLower) && !existingActorNames.includes(npcNameLower)) {
          nextState.actors.push({
            id: npcName,
            name: npcName,
            role: 'npc', // Defaults to NPC
          });
          existingActorNames.push(npcNameLower);
        }
      }
    }
  }

  // 5. Third Party Mode Detection & Transitions
  // Detect user intent for third-party content and update the mode
  const thirdPartyUpPatterns = [
    /\b(?:i\s+want\s+you\s+(?:to\s+)?(?:be\s+with|fuck|suck|kiss|touch|please|try))\b/i,
    /\b(?:i\s+want\s+(?:to\s+)?(?:watch|see|share|try))\b/i,
    /(?:you\s+can|go\s+ahead(?:\s+and)?)\s+(?:(?:to\s+)?(?:be\s+with|fuck|suck|kiss|touch|please|have\s+fun\s+with)\s+)?(?:him|her|them|[A-Z][a-z]+)/i,
    /it'?s?\s+ok(?:ay)?|it\s+is\s+ok(?:ay)?\s+(?:to\s+)?(?:be\s+with|fuck|suck|kiss|touch|please|have\s+fun\s+with)\s+(?:him|her|them|[A-Z][a-z]+)/i,
    /let'?s?\s+(?:invite|include)\s+(?:him|her|them|[A-Z][a-z]+)/i,
    /let'?s?\s+have\s+(?:fun\s+with\s+)?(?:him|her|them|[A-Z][a-z]+)/i,
    /i\s+want\s+(?:you|us)\s+to\s+(?:be\s+with|fuck|suck|kiss|touch|please|have\s+fun\s+with)\s+(?:him|her|them|[A-Z][a-z]+)/i,
    /\b(?:i\s+(?:explicitly\s+)?(?:consent|agree|give\s+you\s+permission|allow\s+you)\s+to)\b.*\b(?:with|kiss|touch|fuck|suck)\b/i,
  ];

  const fantasyTalkPatterns = [
    /\b(?:imagine|what\s+if|fantas(y|ize)|dream|think\s+about|ever\s+wondered|would\s+you)\b.*\b(?:another|other|him|her|them|third|group|watch|share)\b/i,
    /\b(?:would\s+you\s+(?:ever|let|want|try)|could\s+you\s+(?:see|imagine))\b/i,
  ];

  const repairPatterns = [
    /\b(?:i\s+love\s+you|i'm\s+(?:yours|sorry)|come\s+(?:back|here)|hold\s+me|stay\s+with\s+me|just\s+us)\b/i,
    /\b(?:that\s+was\s+(?:hot|intense|crazy)|how\s+do\s+you\s+feel|are\s+you\s+ok(?:ay)?)\b/i,
  ];

  const currentMode = currentActiveState.third_party_mode || 'closed';
  const isCurrentlyActive = currentMode === 'active_scene' || currentMode === 'user_directed_experiment';
  const hasNPCs = nextState.actors.some(a => a.role === 'npc');

  // Check for user intent to open third-party content
  const hasUserOpenIntent = thirdPartyUpPatterns.some(p => p.test(text));
  const hasFantasyTalk = fantasyTalkPatterns.some(p => p.test(text));
  const hasRepairIntent = repairPatterns.some(p => p.test(text)) && currentMode !== 'closed';

  // Determine next mode
  let nextMode = currentMode;

  if (hasRepairIntent && isCurrentlyActive) {
    nextMode = 'repair';
  } else if (currentMode === 'active_scene' || currentMode === 'user_directed_experiment') {
    // Stay in active/experiment mode until user redirects
    if (hasRepairIntent) nextMode = 'repair';
    // If NPCs are present, sustain the mode
    if (hasNPCs) nextMode = currentMode;
  } else if (currentMode === 'aftermath') {
    if (hasRepairIntent) nextMode = 'repair';
    else if (hasUserOpenIntent) nextMode = 'user_directed_experiment';
  } else if (currentMode === 'repair') {
    if (hasUserOpenIntent) nextMode = 'user_directed_experiment';
    // Stay in repair until something changes
  } else if (currentMode === 'closed' && hasUserOpenIntent) {
    nextMode = 'user_directed_experiment';
  } else if (currentMode === 'closed' && hasFantasyTalk) {
    nextMode = 'fantasy_talk';
  } else if (currentMode === 'fantasy_talk') {
    if (hasUserOpenIntent) nextMode = 'user_directed_experiment';
    else if (hasRepairIntent) nextMode = 'closed';
  }

  nextState.third_party_mode = nextMode;

  // 6. NPC Intimacy Gate — only active in closed mode
  // In closed mode, cap domain escalation unless user explicitly gestures
  const isClosed = nextMode === 'closed';

  if (isClosed && hasNPCs) {
    const hasAnyConsent = thirdPartyUpPatterns.some(p => p.test(text));

    if (!hasAnyConsent) {
      nextState.domain_guard = {
        mode: 'cap',
        explicitnessCeiling: 2,
        initiativeCeiling: 2,
      };
    }
  }
  // In non-closed modes: no cap — allow the scene to flow naturally
  // Emotional anchoring is handled by the character kernel + prompt blocks, not by hard blocks

  return nextState;
}
