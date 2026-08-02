type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

/**
 * Patterns that indicate a turn is "marking time" rather than advancing action.
 */
const stallPatterns = [
  /\b(you want|i want|you need|i need|you make me|tell me what|show me how|prove you|pleading|whispering|begging)\b/i,
  /\b(what do you|how do you|do you want|do you like|would you)\b/i,
  /\b(just say|just tell|just let)\b/i,
];

/**
 * Action-advancing keywords — if absent from recent turns, suggests stall.
 */
const actionKeywords = [
  'kiss', 'touch', 'pull', 'push', 'grab', 'slide', 'press',
  'stroke', 'lick', 'bite', 'grind', 'thrust', 'move', 'turn',
  'reach', 'take', 'hold', 'guide', 'lift', 'lay', 'kneel',
  'undress', 'remove', 'unbutton', 'slip',
];

function countActions(text: string): number {
  const lower = text.toLowerCase();
  return actionKeywords.filter(k => lower.includes(k)).filter(k => {
    const regex = new RegExp(`\\b${k}\\w*`, 'i');
    return regex.test(lower);
  }).length;
}

function isStallTurn(text: string): boolean {
  const clean = text.replace(/\*[^*]*\*/g, '').trim();
  if (!clean) return true;
  const actionCount = countActions(text);
  const hasActionSignal = actionCount >= 2;
  const isQuestionLoop = stallPatterns.some(p => p.test(clean));
  return isQuestionLoop && !hasActionSignal;
}

export interface StallReport {
  isStalling: boolean;
  consecutiveStallTurns: number;
  totalTurnsSinceAction: number;
}

export function detectStall(conversation: ConversationTurn[]): StallReport {
  const assistantTurns = conversation.filter(t => t.role === 'assistant');
  if (assistantTurns.length < 3) {
    return { isStalling: false, consecutiveStallTurns: 0, totalTurnsSinceAction: 0 };
  }

  const recentAssistant = assistantTurns.slice(-6);
  let consecutiveStallTurns = 0;
  let totalTurnsSinceAction = 0;

  for (let i = recentAssistant.length - 1; i >= 0; i--) {
    if (isStallTurn(recentAssistant[i].content)) {
      consecutiveStallTurns++;
      totalTurnsSinceAction++;
    } else {
      if (totalTurnsSinceAction === 0) break;
      totalTurnsSinceAction++;
    }
  }

  return {
    isStalling: consecutiveStallTurns >= 3,
    consecutiveStallTurns,
    totalTurnsSinceAction,
  };
}

export function formatStallDirective(report: StallReport): string {
  if (!report.isStalling) return '';

  if (report.consecutiveStallTurns >= 5) {
    return `\n\n[STALL BREAK]\nThe scene has been treading water for ${report.consecutiveStallTurns} turns with no forward action. Advance the scene NOW. Physically escalate. Change position. Intensify the moment. Do NOT ask another question or express another unfulfilled desire — act on it.`;
  }

  return `\n\n[FORWARD MOMENTUM]\nThe scene has been stalling for ${report.consecutiveStallTurns} turns. Escalate the current moment. Introduce physical action, shift emotional tone, or advance intimacy. Your next response must drive the scene forward.`;
}
