# Walkthrough - Actor Attribution & Domain Misfire Guard

This walkthrough details the changes made to resolve NPC focus hijacking and prevent keyword-based domain escalation during boundaries/negation using a hybrid **Hot Path (Deterministic Rules Engine)** and **Cold Path (Asynchronous Extractor)** architecture.

---

## Changes Made

### 1. State & Schema Extensions
*   **[active-state.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/active-state.ts)**:
    *   Defined schemas for `SceneActor`, `UserProxyState`, and `DomainGuardState`.
    *   Added `actors`, `user_proxy`, and `domain_guard` fields to `activeStateSchema` and `defaultActiveState`.
    *   Modified `formatActiveStateToPrompt` to accept `characterName` and prepend a compact `=== ACTOR STATE ===` block detailing the user, active user proxy, main character, and active NPCs.
*   **[continuity.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/continuity.ts)**:
    *   Updated `continuityEventSchema` to support `initiator_actor_id`, `target_actor_id`, and `affects_primary_relationship` (boolean).
    *   Defined `relationshipDeltaSchema` specifying the `pair` (`"user_ai" | "npc_ai" | "npc_user" | "scene"`), `actor_ids`, and the dynamics deltas.

### 2. Hot Path: Deterministic Rules Engine
*   **[hot-resolver.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/hot-resolver.ts) [NEW]**:
    *   Created `resolveHotState(message, currentActiveState, characterName)`:
        *   **Domain Guard Positive Overrides**: Matches consent/continuation phrases (e.g. "don't stop", "no, keep going", "don't you dare stop", "no one else") to allow.
        *   **Domain Guard Refusals/Blocks**: Matches specific boundaries/negations (e.g. "stop", "don't touch me", "no, don't", "I'm uncomfortable") and sets `domain_guard.mode = "block"`.
        *   **Domain Guard Hesitations**: Matches soft hesitations (e.g. "slow down", "wait", "hold on") and sets `domain_guard.mode = "cap"`.
        *   **User Proxy Detection**: Matches narrow proxy declarations (e.g. "I am X in this scene", "I'm playing X", "X is me") and maps them to `user_proxy`.
        *   **NPC Introductions**: Scans for new capitalized proper names (e.g. "Alex comes over", "A man named Marco") and registers them as NPCs.
*   **[prompt-domains.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/prompt-domains.ts)**:
    *   Updated `derivePromptDomainState` to read `activeState.domain_guard`. If `'block'`, overrides `horniness`, `filth`, and `boldness` to `1`. If `'cap'`, clamps them to the defined ceilings.
*   **[route.ts](file:///Users/mukeshkumar/play/rpd2/app/(chat)/api/chat/route.ts)**:
    *   Imported and called `resolveHotState` on the incoming user message prior to prompt compilation and domain state derivation.
    *   Passed `selectedCharacter.name` to `formatActiveStateToPrompt` to populate the `=== ACTOR STATE ===` block.

### 3. Cold Path: Asynchronous Extractor
*   **[prompts.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/prompts.ts)**:
    *   Appended `[PLAYER / USER ANCHOR]` guidelines directly to `systemPrompt` to keep the AI anchored to the primary user relationship and prevent milestones/intimacy leaking to NPCs.
*   **[summarizer.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/summarizer.ts)**:
    *   Updated `unifiedRPUpdateSchema` and `UnifiedRPUpdate` interface to return `dynamicsDeltas` array instead of a single `dynamicsDelta`.
    *   Instructed the summarizer-model to output pair-attributed dynamics and resolve actors/user proxies.
*   **[chat-continuity.ts](file:///Users/mukeshkumar/play/rpd2/lib/ai/chat-continuity.ts)**:
    *   Updated `refreshChatContinuityState` to filter relationship dynamics deltas, applying **only** the `user_ai` pair deltas to the primary dynamics score.
    *   Ensured the volatile `domain_guard` state is reset back to `'allow'` at the end of each turn.

---

## Verification Results

### 1. Unit Tests
Created 12 tests across:
*   `tests/unit/hot-resolver.test.ts` (Positive overrides, specific block patterns, narrow proxy assignments, NPC introductions).
*   `tests/unit/prompt-domains.test.ts` (Domain guard block and cap clamps).
*   `tests/unit/chat-continuity.test.ts` (Relationship delta filtering).
*   `tests/unit/prompt-assembly.test.ts` (Actor State prompt injection).

All **12 unit tests passed successfully** in **1.0 seconds**.
To rerun them:
```bash
export SKIP_WEBSERVER=1 && npx playwright test --project=unit
```

### 2. Route Integration Tests
Created integration tests under `tests/routes/actor-attribution.test.ts` validating:
*   Posting a boundary negation message successfully resets `domain_guard` and creates the active state correctly.
*   Declaring a proxy works.

All **11 route tests passed successfully** in **12.3 seconds**.
To rerun them:
```bash
npx playwright test --project=routes
```

### 3. TypeScript Compilation
Verified that `npx tsc --noEmit` compiles cleanly with no type errors.
