# Model Map (Current)

## Provider wiring (`lib/ai/providers.ts`)
- **chat-model** → `openai/gpt-oss-120b` (OpenRouter)
- **chat-model-reasoning** → `openai/gpt-4o-mini` (wrapped w/ reasoning tag extraction)
- **title-model** → `meta-llama/llama-3.2-3b-instruct`
- **artifact-model** → `anthropic/claude-3-haiku`
- **summarizer-model** → liquid/lfm-3b (tiered natural-language summaries: short=1–2, medium=2–3, long=3–5 sentences) with automatic fallback to gpt-4o-mini/anthropic if unavailable
- (Image models intentionally **omitted** until a true image model is added)

## Where models are used
- **Chat** (`app/(chat)/api/chat/route.ts`):
  - Uses `selectedChatModel` → either `chat-model` or `chat-model-reasoning`.
  - Tools exposed: `createDocument`, `updateDocument`, `getWeather`, `requestSuggestions` (depending on model).
- **Artifact drafting**:
  - `artifacts/text/server.ts` → `artifact-model` for text drafting/updates.
  - `artifacts/code/server.ts` → `artifact-model` via `streamObject` schema (outputs `code`).
  - `artifacts/sheet/server.ts` → `artifact-model` (CSV/structured).
  - `artifacts/image/server.ts` → placeholder until a real image generator is wired.

## Planned routing (future)
- Everyday chat/drafts → economical small model.
- Legal/strategy → heavyweight (e.g., Grok 3 / Claude Sonnet).
- Web-backed research → Perplexity Sonar (with citations) when the "advisor" layer triggers it.

## Summarizer Model Usage
- **Summarizer** (`lib/ai/summarizer.ts`): Uses `summarizer-model` with tiered prompts (short/medium/long) for contextual summary length; content-gated; includes robust fallback chain:
  - **Primary**: `summarizer-model` (liquid/lfm-3b)
  - **Fallback 1**: `chat-model` (gpt-oss-120b - our default chat model)
  - **Fallback 2**: `chat-model-reasoning` (gpt-4o-mini)
  - **Fallback 3**: `artifact-model` (claude-3-haiku)
  - **Last Resort**: Safe default summary in detected language
