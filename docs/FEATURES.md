# Current Features (User-Facing)

## Drafting
- **Talks (LDS or general)**: Warm tone by default; clear scripture/leader citations; 3–20 min caps with smart defaults.
- **Letters**: Formal or warm tone based on audience; structured formatting.
- **Essays/Reports**: Headings, logical flow, concise style.

## Editing
- **Inline updates** via "Update Document" without starting over.
  - Minimal-change rule preserves length/structure.
  - Smart closing rules (e.g., LDS testimony when asked).

## Advanced Multilingual System
- **Language Toggle**: Sidebar control for instant English/Spanish switching (🇺🇸 EN / 🇪🇸 ES)
- **Persistent Preferences**: Language choice saved in localStorage across sessions
- **Smart Detection**: Browser language analysis with conversation content detection
- **System Integration**: All components respect user's language preference:
  - Thinking messages switch instantly
  - Document creation uses selected language
  - Error messages and UI labels adapt
  - Memory extraction and formatting bilingual
- **SSR Compatible**: No hydration issues, works seamlessly server/client-side

## Enhanced User Experience

### Personality-Driven Thinking Messages
- **Dynamic Content**: 12+ unique witty messages rotating every 4 seconds
- **Bilingual Library**: Separate message sets for English and Spanish
- **Stage Progression**: Different messages for thinking/processing/generating phases
- **Animated Effects**:
  - Typewriter text animation with blinking cursor
  - Bouncing SparklesIcon with smooth transitions
  - Staggered pulsing progress dots (3 animated dots)
  - Professional spring-based animations

### Interactive Language Switching
- **Instant Language Toggle**: No page refresh required
- **Sidebar Integration**: Conveniently placed at bottom of sidebar
- **Visual Feedback**: Flag emojis (🇺🇸 🇪🇸) with language codes
- **Immediate Effect**: Thinking messages and UI update instantly

### Advanced Memory Integration
- **Unlimited Fact Storage**: No token limits on specific details
- **Pattern-Based Extraction**: Automatic detection of dates, amounts, names
- **Recency Awareness**: Recent information gets priority markers
- **Tool-Specific Context**: Tailored memory briefs for document creation

## Streaming UI
- Live token streaming into the artifact pane.
- Persist to DB on completion.
- Enhanced with personality-driven thinking messages.

## What's Next (shortlist)
- Goldfish (short-term working memory): rolling summary + last-N messages for cheaper context.
- Model routing: everyday vs. legal-heavy vs. web-research.
- True image model hookup (remove placeholder).
- Move shared types to `lib/types.ts` (done if merged).
