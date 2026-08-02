// Detect primary language of conversation
export function detectLanguage(
  allMsgs: { role: 'user' | 'assistant'; content: string }[],
): 'en' | 'es' {
  const fullText = allMsgs
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  // Spanish indicators (more specific patterns)
  const spanishIndicators = [
    /\b(el|la|los|las|un|una|unos|unas|y|o|pero|porque|que|como|donde|cuando)\b/g,
    /\b(es|son|está|están|era|eran|fue|fueron|será|serán)\b/g,
    /\b(hacer|hace|hizo|hará|decir|dice|dijo|dirá|poder|puede|pudo|podrá)\b/g,
    /\b(tengo|tiene|tenía|tuvimos|tendremos)\b/g,
    /\b(me|te|se|nos|les|lo|la|le|los|las)\b/g,
    /\b(muy|poco|nada|bien|mal|sí|no|aquí|allí)\b/g,
    /\b(hola|gracias|por favor|perdón|disculpe)\b/g,
    /\b(español|hispano|latin|méxico|colombia|argentina)\b/g,
  ];

  // English indicators (more specific patterns)
  const englishIndicators = [
    /\b(the|and|or|but|because|that|how|where|when)\b/g,
    /\b(is|are|was|were|be|been|will|would|can|could|should)\b/g,
    /\b(do|does|did|done|make|made|say|said|says|tell|told)\b/g,
    /\b(have|has|had|having|get|got|give|gave|take|took)\b/g,
    /\b(i|you|he|she|it|we|they|me|him|her|us|them|this|that|these|those)\b/g,
    /\b(very|much|little|nothing|well|bad|yes|no|here|there)\b/g,
    /\b(hello|thank you|please|sorry|excuse me)\b/g,
    /\b(english|american|british|american|canadian)\b/g,
  ];

  let spanishScore = 0;
  let englishScore = 0;

  for (const pattern of spanishIndicators) {
    const matches = fullText.match(pattern);
    if (matches) spanishScore += matches.length;
  }

  for (const pattern of englishIndicators) {
    const matches = fullText.match(pattern);
    if (matches) englishScore += matches.length;
  }

  return spanishScore > englishScore ? 'es' : 'en';
}

// Bilingual salience patterns for measuring content density
const BILINGUAL_PATTERNS = {
  dates: {
    en: /\b(?:\d{1,2}\s?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}|\d{4}-\d{2}-\d{2})\b/gi,
    es: /\b(?:\d{1,2}\s?(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)|(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?\d{1,2}|\d{4}-\d{2}-\d{2})\b/gi,
  },
  numbers: {
    en: /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b|[£$€]\s?\d+/g,
    es: /\b\d{1,3}(?:\.\d{3})*(?:,\d+)?\b|[€$]\s?\d+/g,
  },
  properNouns: {
    en: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
    es: /\b[A-Z][a-záéíóúñ]+(?:\s+[A-Z][a-záéíóúñ]+)*\b/g,
  },
  decisionVerbs: {
    en: /\b(confirm|decide|choose|must|need|require|should|agree|set|plan|schedule)\b/gi,
    es: /\b(confirmar|decidir|elegir|deber|necesitar|requerir|debería|acordar|establecer|planificar|programar)\b/gi,
  },
  timeExpressions: {
    en: /\b(?:today|tomorrow|yesterday|next\s+(?:week|month|year)|last\s+(?:week|month|year)|this\s+(?:week|month|year))\b/gi,
    es: /\b(?:hoy|mañana|ayer|siguiente\s+(?:semana|mes|año|día)|pasado\s+(?:semana|mes|año|día)|esta\s+(?:semana|mes|año|día))\b/gi,
  },
} as const;

export function measureConversation(
  allMsgs: { role: 'user' | 'assistant'; content: string }[],
) {
  const fullText = allMsgs.map((m) => m.content).join(' ');
  const chars = fullText.length;
  const tokensApprox = chars / 4; // Basic approximation

  const language = detectLanguage(allMsgs);

  // Count salience matches across patterns
  let salience = 0;
  for (const category in BILINGUAL_PATTERNS) {
    const pattern =
      BILINGUAL_PATTERNS[category as keyof typeof BILINGUAL_PATTERNS][language];
    const matches = fullText.match(pattern);
    if (matches) salience += matches.length;
  }

  return { chars, tokensApprox, salience, language };
}

export function pickSummaryTier(
  tokensApprox: number,
): 'short' | 'medium' | 'long' {
  if (tokensApprox < 500) return 'short';
  if (tokensApprox < 1000) return 'medium';
  return 'long';
}
