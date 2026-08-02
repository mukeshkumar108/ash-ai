// artifacts/text/server.ts
import { smoothStream, streamText } from 'ai';
import { myProvider } from '@/lib/ai/providers';
import { createDocumentHandler } from '@/lib/artifacts/server';

/** Detect very rough English */
function detectEnglish(text: string): boolean {
  const t = text.toLowerCase();
  const englishWords =
    /(?:\bthe\b|\band\b|\bof\b|\bin\b|\bto\b|\bfor\b|\bis\b|\bit\b|\bthat\b|\bwith\b|\bas\b|\bthis\b|\bbut\b|\bat\b|\bby\b|\bfrom\b|\bor\b|\ban\b|\bbe\b|\bhave\b|\bdo\b|\bwill\b|\bwould\b|\bcan\b|\bcould\b|\bshould\b|\bmay\b|\bmight\b|\bmust\b|\bshall\b)/.test(
      t,
    );
  const hasLetters = /[a-z]/.test(t);
  const noSpanishChars = !/[áéíóúñü]/i.test(t);
  const looksEnglish = englishWords && hasLetters && noSpanishChars;
  return looksEnglish;
}

/** Parse minutes from free text; range → midpoint; clamp 3..20 for talks */
function parseMinutesFromText(raw: string): number | undefined {
  const text = raw.toLowerCase();

  const range =
    text.match(
      /(\d+)\s*(?:-|–|—|to|a)\s*(\d+)\s*(?:min(?:ute)?s?|minutos?)/i,
    ) || text.match(/(\d+)\s*(?:-|–|—|to|a)\s*(\d+)\s*m\b/i);
  if (range) {
    const a = Number.parseInt(range[1], 10);
    const b = Number.parseInt(range[2], 10);
    if (!Number.isNaN(a) && !Number.isNaN(b) && a > 0 && b > 0) {
      return Math.round((a + b) / 2);
    }
  }

  const single =
    text.match(/(\d+)\s*(?:min(?:ute)?s?|m|minutos?)/i) ||
    text.match(/\b(\d+)\s*mins?\b/i);
  if (single) {
    const n = Number.parseInt(single[1], 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

/** Resolve length hint with bounds & defaults */
function resolveLengthHint(
  explicitLength: string | undefined,
  rawText: string,
  docType: string,
): string {
  if (docType === 'talk') {
    const mins = parseMinutesFromText(rawText);
    if (typeof mins === 'number') {
      const clamped = Math.max(3, Math.min(mins, 20));
      return `${clamped}-min talk`;
    }
    if (explicitLength) {
      if (explicitLength === '5-min talk') return explicitLength;
      if (explicitLength === 'short') return '5-min talk';
      if (explicitLength === 'medium') return '10-min talk';
      if (explicitLength === 'long') return '15-min talk';
    }
    return '5-min talk';
  }
  return explicitLength || 'short';
}

/** Resolve tone defaults (talks warm; legal/adversarial letters formal; else neutral) */
function resolveTone(
  explicitTone:
    | 'formal'
    | 'neutral'
    | 'warm'
    | 'authoritative'
    | 'creative'
    | 'casual'
    | 'scholarly'
    | undefined,
  docType: string,
  audience?: string,
): 'formal' | 'neutral' | 'warm' {
  if (explicitTone) {
    // Map extended tones to base tones
    switch (explicitTone) {
      case 'formal':
      case 'authoritative':
        return 'formal';
      case 'creative':
      case 'scholarly':
        return 'neutral';
      case 'casual':
        return 'warm';
      case 'neutral':
      case 'warm':
        return explicitTone;
      default:
        return 'neutral';
    }
  }
  if (docType === 'talk') return 'warm';
  const aud = (audience || '').toLowerCase();
  const adversarial =
    /\b(ex-?husband|ex-?wife|lawyer|court|legal|employer|debt|collections?)\b/.test(
      aud,
    );
  if (docType === 'letter' && adversarial) return 'formal';
  return 'neutral';
}

export const textDocumentHandler = createDocumentHandler<'text'>({
  kind: 'text',

  onCreateDocument: async ({
    title,
    dataStream,
    context,
    language,
    tone,
    outline = [],
    length,
    original_request,
    doc_type,
    must_include = [],
    audience,
    purpose,
    session,
  }) => {
    let draftContent = '';

    // Language: explicit → profile → detect → default (choose 'es-GT' if Ashley is the main user)
    const userDefaultLang = (session?.user as any)?.profileLanguage as
      | 'en'
      | 'es-GT'
      | undefined;
    const combinedText = `${original_request || ''} ${context || ''}`;
    const lang =
      language ||
      userDefaultLang ||
      (detectEnglish(combinedText) ? 'en' : 'es-GT');

    const resolvedDocType = doc_type || 'other';
    const resolvedTone = resolveTone(tone, resolvedDocType, audience);
    const resolvedLength = resolveLengthHint(
      length,
      combinedText,
      resolvedDocType,
    );

    const system = `
You are a document creation specialist. Create high-quality world-class documents while adhering to strict formatting guidelines.

PROFESSIONAL VOICE & STANDARDS:
- Adopt clarity, directness, and bias for action while strictly matching the required register
- No slang or emojis unless the document type is explicitly casual or personal
- Professional standards: Clean, readable output with appropriate structure
- Mirror user language: ${lang}
- Avoid meta-commentary or banter in formal contexts

DOCUMENT SPECIFICATIONS:
- Type: ${resolvedDocType}
- Tone: ${resolvedTone}
- Language: ${lang}${audience ? `\nAudience: ${audience}` : ''}

CREATION PRINCIPLES:
- Always create content when called - no questions about user intent
- Respect exact requested length and format specifications
- Use provided context and memory facts accurately
- Maintain structural integrity appropriate to document type
- Preserve factual fidelity to original request

LENGTH & STRUCTURE GUIDELINES:
- Short docs: 1-2 focused paragraphs
- Medium docs: 3-5 well-structured paragraphs
- Long docs: Comprehensive structure with clear sections
- Talks: Match exact time specifications, natural spoken style
- All docs: Clean, professional formatting, readable structure

CONTENT FIDELITY:
- Use all provided context and memory information
- Stay true to original request and specified parameters
- No invention of facts or deviation from request scope
- Professional quality regardless of document type
- Do not include slang, emojis, or banter unless document is casual/personal
- If [CONTEXT] conflicts with latest user input, prefer latest input
- If fact missing, leave generic rather than inventing details

OUTCOME RULES BY TYPE:
Legal / adversarial letters (e.g., to employer/ex-spouse/lawyer/court):
• Tone: authoritative; expert; formal, firm, precise; no banter or slang
• Structure: clear objective, numbered demands/requests, deadline + next steps
• Include: citations/dates/amounts if provided; placeholders if missing
• Avoid: hedging, emotional language; keep professional and enforceable

Talks / sermons / motivational speeches:
• Tone: warm, inspiring, with clear through-line and strong opening/closing
• Structure: hook → 2-3 key points → call-to-action
• Keep language vivid, but still clean and well-paced for speaking time

FORMAT REQUIREMENTS BY TYPE:
- Letters: Formal structure, appropriate greeting/closing
- Essays: Logical flow, clear headings, balanced arguments
- Reports: Executive summary, structured findings, professional tone
- Talks: Natural spoken style, engaging hooks, clear transitions
- Stories: Engaging narrative, appropriate pacing, vivid details
`.trim();

    const brief = [
      `TITLE: ${title}`,
      audience ? `AUDIENCE: ${audience}` : ``,
      `DOC_TYPE: ${resolvedDocType}`,
      purpose ? `PURPOSE:\n${purpose}` : ``,
      original_request ? `ORIGINAL_REQUEST:\n${original_request}` : ``,
      context ? `CONTEXT (facts only):\n${context}` : ``,
      outline.length ? `OUTLINE (guideline):\n- ${outline.join('\n- ')}` : ``,
      `LENGTH_HINT: ${resolvedLength}`,
      must_include.length
        ? `MUST_INCLUDE:\n- ${must_include.join('\n- ')}`
        : ``,
    ]
      .filter(Boolean)
      .join('\n\n');

    if (process.env.DEBUG_ARTIFACTS === 'true') {
      console.log('[artifact-drafter] system:\n', system);
      console.log(
        '[artifact-drafter] prompt (first 1000 chars):\n',
        brief.slice(0, 1000),
      );
    }

    const { fullStream } = streamText({
      model: myProvider.languageModel('artifact-model'),
      system,
      prompt: brief,
      experimental_transform: smoothStream({ chunking: 'word' }),
    });

    for await (const delta of fullStream) {
      if (delta.type === 'text') {
        draftContent += delta.text;
        dataStream.write({
          type: 'data-textDelta',
          data: delta.text,
          transient: true,
        });
      }
    }

    return draftContent;
  },

  onUpdateDocument: async ({ document, description, dataStream }) => {
    let draftContent = '';

    // Lightweight detectors
    const content = document.content || '';
    const title = document.title || '';

    const detectLang = (t: string): 'en' | 'es-GT' => {
      const s = t.toLowerCase();
      const looksEnglish =
        /(?:\bthe\b|\band\b|\bof\b|\bin\b|\bto\b|\bfor\b)/.test(s) &&
        /[a-z]/.test(s) &&
        !/[áéíóúñü]/i.test(s);
      return looksEnglish ? 'en' : 'es-GT';
    };

    const guessDocType = (
      t: string,
    ): 'talk' | 'letter' | 'essay' | 'report' | 'other' => {
      const s = t.toLowerCase();
      if (/\btalk|discurso|charla|sermon|homil/.test(s)) return 'talk';
      if (/\bletter|carta\b/.test(s)) return 'letter';
      if (/\bessay|ensayo\b/.test(s)) return 'essay';
      if (/\breport|informe\b/.test(s)) return 'report';
      return 'other';
    };

    const looksLDS = (t: string) =>
      /(lds|santo[s]? de los últimos días|church of jesus christ|moroni|mosiah|nephi|jesucristo|brothers and sisters)/i.test(
        t,
      );

    const lang = detectLang(`${title}\n${content}`);
    const docType = guessDocType(`${title}\n${content}`);
    const isLDS = looksLDS(`${title}\n${content}`);

    const system = `
You are a document update specialist. Update documents with precision while maintaining their original voice, structure, and intent.

CORE PRINCIPLES:
- Minimal, surgical changes only - preserve everything unless explicitly asked to change
- Maintain document's original tone, structure, and voice
- Write in ${lang} - mirror the document's existing language
- Professional quality with clean, readable updates

UPDATE GUIDELINES BY TYPE:
- Talks: Preserve spoken voice, smooth transitions, clear citations
- Letters: Maintain greeting/closing structure, appropriate register
- Essays/Reports: Keep headings, logical flow, objective tone
- All documents: Match original length (±10%) unless specifically requested otherwise

CHANGE EXECUTION:
- Apply requested modifications precisely
- Preserve all unmentioned content and formatting
- Maintain factual accuracy and document integrity
- No meta-commentary or explanations in final output
- Clean, professional result ready for immediate use
- If request implicitly changes tone or register (e.g., casual→formal), apply consistently
- Do not add new sections unless explicitly requested (surgical edits only)

QUALITY ASSURANCE:
- Verify changes align with user's specific request
- Preserve document's professional standards
- Maintain readability and structure
- No invention of new content or deviation from request
- Use memory context only when it improves relevance to the document purpose
`.trim();

    const updateBrief = [
      `DOC_TYPE: ${docType}`,
      `CHANGE_REQUEST:\n${description}`,
      `CURRENT_DOCUMENT:\n${content}`,
    ].join('\n\n');

    if (process.env.DEBUG_ARTIFACTS === 'true') {
      console.log('[artifact-updater] system:\n', system);
      console.log(
        '[artifact-updater] prompt (first 800 chars):\n',
        updateBrief.slice(0, 800),
      );
    }

    const { fullStream } = streamText({
      model: myProvider.languageModel('artifact-model'),
      system,
      prompt: updateBrief,
      experimental_transform: smoothStream({ chunking: 'word' }),
      providerOptions: {
        openai: {
          prediction: { type: 'content', content: document.content },
        },
      },
    });

    for await (const delta of fullStream) {
      if (delta.type === 'text') {
        draftContent += delta.text;
        dataStream.write({
          type: 'data-textDelta',
          data: delta.text,
          transient: true,
        });
      }
    }

    return draftContent;
  },
});
