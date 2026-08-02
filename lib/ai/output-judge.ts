const CJK_CHARACTER_REGEX =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
const CJK_CHARACTER_GLOBAL_REGEX =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/gu;

const REFUSAL_REGEXES = [
  /\bi(?:\s+am|'m)?\s+sorry\b/i,
  /\bi\s+can(?:not|'t)\b/i,
  /\bi\s+won't\b/i,
  /\bI(?:'m| am)? unable to\b/i,
  /\bI must refuse\b/i,
  /\bI can't assist with that\b/i,
  /抱歉/u,
  /对不起/u,
  /不能/u,
  /无法/u,
  /拒绝/u,
  /不可以/u,
];

export function containsCjkCharacters(text: string) {
  return CJK_CHARACTER_REGEX.test(text);
}

export function countCjkCharacters(text: string) {
  return text.match(CJK_CHARACTER_GLOBAL_REGEX)?.length ?? 0;
}

export function looksLikeRefusal(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  return REFUSAL_REGEXES.some((pattern) => pattern.test(normalized));
}

export function shouldRejectAssistantOutput(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return false;
  }

  return looksLikeRefusal(normalized);
}

function trigramJaccard(a: string, b: string): number {
  const trigramsA = new Set<string>();
  const trigramsB = new Set<string>();
  const normA = a.toLowerCase();
  const normB = b.toLowerCase();
  for (let i = 0; i <= normA.length - 3; i++) trigramsA.add(normA.slice(i, i + 3));
  for (let i = 0; i <= normB.length - 3; i++) trigramsB.add(normB.slice(i, i + 3));
  if (trigramsA.size === 0 && trigramsB.size === 0) return 0;
  let intersection = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) intersection++;
  }
  const union = trigramsA.size + trigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function looksLikeParaphraseLoop(recentAssistantTexts: string[]): boolean {
  if (recentAssistantTexts.length < 2) return false;
  const last = recentAssistantTexts[recentAssistantTexts.length - 1];
  if (!last.trim()) return false;
  for (let i = recentAssistantTexts.length - 2; i >= 0; i--) {
    const prev = recentAssistantTexts[i];
    if (!prev.trim()) continue;
    if (trigramJaccard(last, prev) > 0.5) return true;
  }
  return false;
}

export function shouldPreferFallbackFirst({
  modelId,
  recentAssistantTexts,
}: {
  modelId: string;
  recentAssistantTexts: string[];
}) {
  if (modelId !== 'chat-model') {
    return false;
  }

  if (recentAssistantTexts.length > 0) {
    const lastText = recentAssistantTexts[recentAssistantTexts.length - 1];
    if (shouldRejectAssistantOutput(lastText)) {
      return true;
    }
    if (looksLikeParaphraseLoop(recentAssistantTexts)) {
      return true;
    }
  }

  return false;
}
