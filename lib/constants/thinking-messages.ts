export const THINKING_MESSAGES = {
  en: {
    thinking: [
      'Pondering your words... 💭',
      'Thinking about what you just said...',
      'Getting my thoughts together...',
      'She\'s taking a moment to think...',
      'Processing that... give me a second...',
      'Thinking of the perfect response...',
      'Reflecting on our conversation...',
      'Just a moment, sweetie...',
      'Pondering...',
      'She\'s deeply in thought...',
    ],
    processing: [
      'Lila is typing...',
      'Getting ready to reply...',
      'Formulating her thoughts...',
      'Typing out a response...',
      'She\'s writing back...',
      'Almost ready with a reply...',
      'Just finishing my thought...',
      'Lila is carefully choosing her words...',
    ],
    generating: [
      'Lila is typing...',
      'Mia is typing...',
      'She\'s writing back...',
      'Sending her thoughts...',
      'Replying to you...',
      'Almost there...',
    ],
  },
} as const;

export type ThinkingStage = 'thinking' | 'processing' | 'generating';

export function getThinkingMessage(
  stage: ThinkingStage,
  messageIndex = 0,
): string {
  const messages = THINKING_MESSAGES.en[stage];
  return messages[messageIndex % messages.length] || messages[0];
}
