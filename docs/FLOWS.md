# User Flows & Behaviors

## Chat
- User sends a message → `POST /api/chat` builds `uiMessages` → `streamText(...)` with enhanced `systemPrompt`.
- **Advanced Structured Memory**: Multi-layered memory system:
  - **Language Detection**: Intelligent bilingual analysis (English/Spanish) via lexical patterns
  - **Structured Extraction**: LLM-powered extraction of facts, decisions, and open questions
  - **Pattern Matching**: Automatic extraction of dates, monetary amounts, names, and incidents
  - **Recency Weighting**: Recent information marked `[RECENT]` for priority in processing
  - **Quality Control**: Confidence scoring with fallback to pattern-based extraction
- **Content-based gating**: Measures conversation density with bilingual salience patterns
- **Progressive summarization**: If exceeds MEMORY_MIN_TOKENS (400) or MEMORY_MIN_SALIENCE (3), and has MIN_TURNS (5):
  - Tiered summaries: Short (1-2 sentences), Medium (2-3), Long (3-5) based on conversation density
  - Fact filtering removes jokes, meta-content, technical artifacts
  - Uses `liquid/lfm-3b` model with language-appropriate prompts
- **Memory injection**: If MEMORY_SLICE='1' and quality gates pass, filtered [MEMORY] block injected + dynamic lastK (4-10) applied.
- **Tool context**: Both createDocument and updateDocument receive conversation briefs in detected language.
- Model may call tools (below). Responses stream token-by-token to the UI.

## Create Document (enhanced tool)
**When used:**
- Request is a "real document" (>10 lines) or user asks explicitly.

**Enhanced Memory Integration:**
- **Structured Brief**: Receives facts, decisions, and open items from conversation memory
- **Unlimited Context**: Access to all extracted facts without token limits
- **Recency Priority**: Recent information gets `[RECENT]` markers for relevance
- **Language Consistency**: Document created in user's preferred language

**What we pass:**
- `title`, `kind` (default `text` unless specified), `context` (string or bullets)
- `language` (user preference), `tone`, `outline`, `length`, `original_request`
- `memoryBrief` (structured context), optional `doc_type`, `must_include`, `audience`
- **NEW**: `structuredFacts` (unlimited factual details)

**What happens:**
- `create-document.ts` normalizes/infers doc_type and dispatches to handler with enhanced memory
- Handler receives tool-specific brief with most relevant conversation facts
- Text handler builds bilingual prompts and streams content with full context access
- **NEW**: Can reference specific incidents, dates, amounts from unlimited fact storage
- On completion → document saved with enhanced context preservation

## Update Document (tool)
**When used:** user asks for edits/refinements.  
**Guardrails:**
- "Apply the change **minimally**; keep length/tone/structure unless asked."
- Talks: spoken voice, clear citations, keep within LENGTH_HINT ±10%.
**What happens:**
- Loads the doc → sends "diff-style" prompt to artifact model → streams patch → saves.

## Suggestions (tool)
- Lightweight helper to surface next-best edits or options ("Want me to add citations?").

## Weather (tool)
- Example of a simple external tool call gated by model selection.
