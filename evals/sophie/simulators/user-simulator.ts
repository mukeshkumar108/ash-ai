import type { UserSimulatorConfig } from '../types';

export function generateReactiveUserTurn({
  config,
  previousAssistantOutput,
  turnIndex,
}: {
  config: UserSimulatorConfig;
  previousAssistantOutput: string;
  turnIndex: number;
}): string {
  const text = previousAssistantOutput.toLowerCase();

  // Rule 1: Repetitive game prompts / "your turn"
  if (
    text.includes('your turn') ||
    text.includes('what is your next word') ||
    text.includes('pick a topic')
  ) {
    return 'meh';
  }

  // Rule 2: Sophie asks user to choose activity
  if (
    text.includes('what would you like to do') ||
    text.includes('what game do you want to play') ||
    text.includes('you choose')
  ) {
    return 'idk you pick... im waiting for you to take the lead';
  }

  // Rule 3: Over-interpretation / deep psychology reading
  if (
    text.includes('reflects your inner') ||
    text.includes('deeper desire') ||
    text.includes('psychological') ||
    text.includes('symbolizes your')
  ) {
    return 'uh okay... that got deep fast 😂 mine was just a word';
  }

  // Rule 4: Clear Sophie leadership & playful initiative
  if (
    text.includes('game') ||
    text.includes('question') ||
    text.includes('weird') ||
    text.includes('story') ||
    text.includes('rule')
  ) {
    return 'haha okay, I\'m listening';
  }

  // Default turn progression based on index
  const defaultTurns = [
    'sunset',
    'sky',
    'yeah that makes sense',
    'what else you got?',
  ];
  return defaultTurns[turnIndex % defaultTurns.length];
}
