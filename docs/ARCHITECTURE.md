# Pedrito – Architecture (Snapshot)

## High-level
- **Next.js app** with Vercel AI SDK.
- **Chat route** orchestrates auth, rate limits, model selection, tools, and streaming.
- **Artifacts system**: tool calls dispatch to per-kind handlers (text/code/image/sheet) that stream content, then save to DB.

## Flow (happy path)
1) **POST /app/(chat)/api/chat/route.ts**
   - Auth, entitlements, build `uiMessages`.
   - **[Advanced Memory System]**: Multi-layered memory with structured extraction:
     - **Language Detection**: Automatic bilingual analysis (English/Spanish)
     - **Structured Memory**: Extracts facts, decisions, open items into unlimited storage
     - **Pattern Matching**: Automatic extraction of dates, amounts, names, incidents
     - **Recency Weighting**: Recent information marked [RECENT] for priority
     - **Quality Scoring**: Confidence-based filtering and fallback handling
     - **Summarization**: If MEMORY_SLICE='1' and salience > threshold, generates structured memory using liquid/lfm-3b with fallback chain (gpt-4o-mini → claude-3-haiku)
     - **Memory Injection**: Formatted [MEMORY] blocks with summary + facts + decisions + open items
     - **Message Capping**: Dynamic lastK (4-10) based on conversation density
   - Calls `streamText` with enhanced `systemPrompt(...)` + structured memory context, `messages`, and tools.
2) **Tools** (when invoked by the model)
   - `createDocument` → resolves doc_type/kind + streams via handler.
   - `updateDocument` → minimal edits via handler.
3) **Handlers** in `lib/artifacts/*/server.ts`
   - Build system prompt, brief.
   - Stream tokens to UI (data-* deltas).
   - Save to DB on completion.

## Key Modules
- `lib/ai/providers.ts`: Provider map (OpenRouter in prod; mock in tests).
- `lib/ai/summarizer.ts`: Advanced structured memory extraction with pattern matching.
- `lib/ai/memory-utils.ts`: Memory formatting, recency weighting, and tool-specific briefs.
- `lib/ai/tools/create-document.ts`: Validates input, resolves doc_type/kind, dispatches handler with enhanced memory briefs.
- `lib/ai/tools/update-document.ts`: Loads doc, applies minimal changes with context preservation.
- `lib/contexts/language-context.tsx`: System-wide language management with SSR compatibility.
- `components/language-toggle.tsx`: Sidebar language switcher with persistent preferences.
- `components/thinking-message.tsx`: Personality-driven loading states with animations.
- `lib/artifacts/server.ts`: Shared types/registry + `createDocumentHandler` wrapper.
- `artifacts/{text,code,image,sheet}/server.ts`: Model prompts + streaming implementation per kind.

## Data/DB (brief)
- Drizzle-based save/load for chats + documents.
- `saveDocument()` is called by handlers after streaming completes.

## Notes
- Resumable streaming uses Redis (global context guarded).
- Tools are enabled/disabled based on selected chat model.
