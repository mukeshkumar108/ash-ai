# RP subsystem classification (neutralization pass)

The RP app was neutralized into a general multimodal chat app. No RP subsystem
files were deleted. This document classifies each subsystem so we can decide
what to adapt or remove in a later cleanup commit.

## 1. Directly reusable for a general multimodal chat app

| Subsystem | Why it generalizes |
|---|---|
| `lib/ai/summarizer.ts` | Incremental summarization (extract facts / decisions / open items → dedupe → reinject compact state). Directly useful for long-chat summaries and compact history. |
| `lib/ai/continuity.ts` | Ontology persistence mechanics: status/scope pruning, deduplication, person models. Becomes "conversation continuity" — remembered preferences and unresolved threads. |
| `lib/ai/chat-continuity.ts` | Orchestrates summarizer + state refresh with an optimistic-lock `saveChatState` contract. Reusable as a background "compact history" pipeline. |

## 2. Reusable after adaptation (neutral adapters)

| Subsystem | Current form → neutral form |
|---|---|
| `lib/ai/active-state.ts` | "Scene tracker" → current task / selected mode / attached document / active edit operation / mid-workflow state. Schema is RP-flavored and needs a neutral schema. |
| `lib/ai/compiler.ts` | Prompt-assembly harness → `compileAssistantContext({ mode, selectedModel, attachments, availableTools, conversationState })`. Identity/relationship/expression blocks are RP; the assembly structure is reusable. |
| `lib/ai/prompt-domains.ts` + `lib/ai/characters/domains/` | Capability modules → chat / summarise / create image / edit image / analyse upload. Domain-guard capping logic generalizes to capability gating. |
| `lib/ai/hot-resolver.ts` | Regex state machine for mode/task transitions; current content is RP-specific (proxies, NPCs, third-party mode) and needs neutral patterns. Borderline category 2/3. |

## 3. Genuinely RP-only (kept dormant; candidates for later removal)

| Subsystem | Notes |
|---|---|
| `lib/ai/characters.ts` + `lib/ai/characters/*.md` | 11 persona kernels, universal-rules, per-character domains, backups. Could become selectable "assistant styles" later, but not in current form. |
| `lib/ai/character-prompts.ts` | Per-character voice signatures, RP postures, scene directives. |
| `lib/ai/relational-integrity.ts` | Monogamy / NPC / third-party rules. |
| `lib/ai/stall-detector.ts` | RP scene-loop prevention (action/escalation keywords). |

## Removed UI (this commit)

- `components/character-selector.tsx` — character roster screen.
- `app/api/chat/jump/route.ts` — character-switch endpoint.

## Kept working, untouched

- `lib/db/*` — schema, queries, migrations (incl. `characterId` stored as the dormant value `'neutral'`).
- Chat/message persistence, history, stream resume.
- Private Blob upload/serve/delete + `lib/image-processing.ts` (HEIC/JPEG/PNG/WebP).
- Artifacts (text/code/sheet/image), output judge, model/provider routing, auth.

## Notes

- `Chat.characterId` and the `User.rp*` columns remain in the schema and are
  written as dormant values (`'neutral'` / `null`). They can be dropped or
  repurposed in a migration-only cleanup commit.
- The chat route no longer calls the compiler, continuity, active-state,
  prompt-domains, hot-resolver, stall-detector, scene-model aliases, or the
  background continuity refresh. All of those files are still present and unit
  tests covering them still pass.
