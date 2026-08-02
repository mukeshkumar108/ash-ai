// Strip obvious meta/reasoning chatter we never want in model inputs
const META_LINE =
  /^(Reasoned\b|We need to respond\b|User (says|asks)\b|Now user\b|Probably\b|Let's respond\b)/i;
const THINK_TAGS = /<\/?think>|\[REASONING]|\[CHAIN OF THOUGHT]/gi;

// Unicode characters that can break layout and rendering
const PROBLEMATIC_UNICODE = {
  // Various Unicode space characters that can cause layout issues
  thinSpace: /\u2009/g, // Thin space (U+2009) - causes funky rendering
  hairSpace: /\u200A/g, // Hair space (U+200A)
  zeroWidthSpace: /\u200B/g, // Zero-width space (U+200B)
  zeroWidthJoiner: /\u200D/g, // Zero-width joiner (U+200D)
  nonBreakingSpace: /\u00A0/g, // Non-breaking space (U+00A0)
  narrowNoBreakSpace: /\u202F/g, // Narrow no-break space (U+202F)

  // Line and paragraph separators
  lineSeparator: /\u2028/g, // Line separator (U+2028)
  paragraphSeparator: /\u2029/g, // Paragraph separator (U+2029)

  // Other problematic Unicode characters
  zeroWidthNoBreakSpace: /\uFEFF/g, // Zero-width no-break space (U+FEFF)
  wordJoiner: /\u2060/g, // Word joiner (U+2060)

  // Unicode ranges for various space-like characters
  unicodeSpaces: /[\u2000-\u200F\u2028-\u2029\uFEFF]/g,
};

export function sanitizeText(input: string): string {
  if (!input) return '';

  // First, fix Unicode character issues that break layout
  let sanitized = input
    // Replace problematic Unicode spaces with regular spaces
    .replace(PROBLEMATIC_UNICODE.thinSpace, ' ')
    .replace(PROBLEMATIC_UNICODE.hairSpace, ' ')
    .replace(PROBLEMATIC_UNICODE.zeroWidthSpace, ' ')
    .replace(PROBLEMATIC_UNICODE.zeroWidthJoiner, '')
    .replace(PROBLEMATIC_UNICODE.nonBreakingSpace, ' ')
    .replace(PROBLEMATIC_UNICODE.narrowNoBreakSpace, ' ')
    .replace(PROBLEMATIC_UNICODE.zeroWidthNoBreakSpace, '')
    .replace(PROBLEMATIC_UNICODE.wordJoiner, '')

    // Convert line/paragraph separators to regular newlines
    .replace(PROBLEMATIC_UNICODE.lineSeparator, '\n')
    .replace(PROBLEMATIC_UNICODE.paragraphSeparator, '\n\n')

    // Clean up any remaining problematic Unicode space characters
    .replace(PROBLEMATIC_UNICODE.unicodeSpaces, ' ')

    // Remove think tags and reasoning markers
    .replace(THINK_TAGS, '');

  // Then apply the standard meta/reasoning filtering
  sanitized = sanitized
    .split('\n')
    .filter((line) => !META_LINE.test(line.trim()))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return sanitized;
}
