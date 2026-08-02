# Entry Points

## API Routes
- POST /app/(chat)/api/chat → main chat orchestration (models, tools, streaming); gated by MEMORY_SLICE='1'
- DELETE /app/(chat)/api/chat → delete chat (cleanup)
- GET /api/memory/preview?chatId=... → dev-only memory summary preview; returns JSON {tldr, facts, open, lastK, recentWindow}

## AI Tools (function-calling)
- createDocument → lib/ai/tools/create-document.ts (enhanced with structured memory briefs)
- updateDocument → lib/ai/tools/update-document.ts (minimal change with context preservation)
- requestSuggestions → lib/ai/tools/request-suggestions.ts
- getWeather → lib/ai/tools/get-weather.ts

## Memory System
- Structured Summarizer → lib/ai/summarizer.ts (extracts facts, decisions, open items)
- Memory Utilities → lib/ai/memory-utils.ts (formatting, recency weighting, tool briefs)
- Language Context → lib/contexts/language-context.tsx (system-wide language management)
- Pattern Extractor → lib/ai/summarizer.ts:extractAdditionalFacts() (automatic fact mining)

## Artifact Handlers (receive [BRIEF] at top of context from createDocument tool)
- text → artifacts/text/server.ts
- code → artifacts/code/server.ts
- sheet → artifacts/sheet/server.ts
- image → artifacts/image/server.ts

### Scripts
- Build/test/dev scripts live in `package.json`. If you add or rename scripts, update this section with the new names (e.g., `lint`, `typecheck`, `dev`, `build`, `test`).
