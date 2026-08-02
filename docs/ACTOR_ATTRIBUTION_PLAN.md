# Implementation Plan - Actor Attribution & Domain Misfire Guard (Final)

Address the bug where NPCs hijack relational focus and boundaries, and prevent keyword-based escalation during hesitations/refusals using a hybrid **Hot Path (Deterministic Rules Engine)** and **Cold Path (Asynchronous Extractor)** architecture.

---

## Hot Path: Deterministic Rules Engine

Runs synchronously before prompt assembly and domain state derivation. It uses an ordered rules engine to resolve proxy declarations, identify NPCs, and detect boundaries or negations.

### 1. Domain Guard Rules (Ordered)
1.  **Positive Override Pass**: Matches phrases representing consent/continuation or non-refusal patterns:
    *   `/(?:don't|dont|do not)\s+(?:stop|quit|hesitate)/i` ("don't stop")
    *   `/(?:no|nah|nope|wait)\s*,\s*(?:keep\s+going|continue|don't\s+stop|dont\s+stop)/i` ("no, keep going")
    *   `/\bno\s+one\s+else\b/i` ("no one else")
    If any match, the guard is set to `"allow"` (no block/cap).
2.  **Specific Refusal/Block Pass**: Matches strong boundaries/negations:
    *   `/\b(stop|don't\s+touch\s+me|dont\s+touch\s+me|no\s*,\s*don't|no\s*,\s*dont|i'm\s+uncomfortable|im\s+uncomfortable|not\s+comfortable|enough|limit|boundaries|don't\s+want\s+this|dont\s+want\s+this)\b/i`
    If matched, `domain_guard` is set to `"block"`.
3.  **Soft Hesitation/Cap Pass**: Matches requests to slow down or wait:
    *   `/\b(slow\s+down|wait|hold\s+on|pause|take\s+it\s+easy|too\s+fast)\b/i`
    If matched, `domain_guard` is set to `"cap"`.

### 2. User Proxy Detection (Narrow)
Matches explicit character proxy assignments:
*   `/\bi\s+am\s+([A-Z][a-z]+)\s+in\s+this\s+scene\b/i` ("I am X in this scene")
*   `/\bi'm\s+playing\s+([A-Z][a-z]+)\b/i` ("I'm playing X")
*   `/\bi\s+enter\s+as\s+([A-Z][a-z]+)\b/i` ("I enter as X")
*   `/\bmy\s+character\s+is\s+([A-Z][a-z]+)\b/i` ("My character is X")
*   `/\b([A-Z][a-z]+)\s+is\s+me\b/i` ("X is me")
*   `/\btreat\s+([A-Z][a-z]+)\s+as\s+me\b/i` ("Treat X as me")

If a proxy name is detected, update `activeState.user_proxy.current_user_proxy_actor_id` to that name.

### 3. NPC Detection
Matches third-party introductions (capitalized words that are not the user, character, or active proxy/NPCs) and registers them defaulting to `role: "npc"` unless explicit proxy patterns apply.
*   Examples: "A man named Marco walks in" -> Register Marco as NPC.

---

## Cold Path: Asynchronous Extractor

Runs in the background after generation.
1.  **Durable Actor Registry**: Updates and corrects actor entries based on long-term role assignment.
2.  **Continuity Events**: Attribute events with initiator and target actor IDs.
3.  **Pair-Scoped Relationship Deltas**: Extracted deltas specify a target pair (`user_ai` vs `npc_ai`).
4.  **Dynamics Routing**: Apply **only** `user_ai` pair updates to the primary relationship dynamics.
5.  **DomainGuard Expiry**: The `domain_guard` state resets back to `"allow"` at the end of each turn, ensuring it is volatile.

---

## Proposed Changes

### 1. State & Types Definition
*   Modify [active-state.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/active-state.ts): Add `SceneActor`, `UserProxyState`, `DomainGuardState` to `activeStateSchema` and `defaultActiveState`.
*   Modify [continuity.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/continuity.ts): Update `continuityEventSchema` and define `relationshipDeltaSchema`.

### 2. Hot Resolver
*   Create [hot-resolver.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/hot-resolver.ts) with pure function `resolveHotState`.
*   Modify [prompt-domains.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/prompt-domains.ts) to read the guard and clamp domains.
*   Modify [api/chat/route.ts](file:///Users/mukeshkumar/play/rpd2/app/(chat)/api/chat/route.ts) to execute `resolveHotState` pre-generation.

### 3. Cold Path updates
*   Modify [summarizer.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/summarizer.ts) to extract pair-scoped dynamics, actor registry updates, and attributed continuity events.
*   Modify [chat-continuity.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/chat-continuity.ts) to filter deltas and clear the volatile domain guard.

---

## Verification Plan

### Unit Tests
*   `tests/lib/ai/hot-resolver.test.ts` for positive overrides, Specific refusals, narrow proxy declarations, and NPC defaults.
*   `tests/lib/ai/prompt-domains.test.ts` verifying domain level capping when a guard is active.
*   `tests/lib/ai/chat-continuity.test.ts` verifying pair delta filtering.
