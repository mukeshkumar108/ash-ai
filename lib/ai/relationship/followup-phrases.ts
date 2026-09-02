export const ACTIVE_FOLLOWUP_PHRASES = [
  'you still there?',
  'did I lose you?',
  "oi, where'd you go?",
  'you disappeared on me 😂',
  'hello? 😂',
] as const;

export const ACTIVE_FINAL_CLOSE_PHRASES = [
  "haha okay, don't worry. we'll chat later",
  "okay, I'm assuming you got distracted 😂 talk later",
  "you're probably busy. catch you later",
  "alright, I'll leave you to it. talk later",
  'you vanished 😂 we\u2019ll continue later',
] as const;

export const NIGHT_FINAL_CLOSE_PHRASES = [
  'you probably fell asleep 😂 goodnight',
  'okay, looks like you faded 😴 goodnight',
  "it's late — chat whenever you're up 🤍",
  'you must have crashed — sleep well',
  'night night. we\u2019ll pick this up later',
] as const;

export type FollowupStage = 'first' | 'final';

export function pickPhrase(stage: FollowupStage, seedIndex: number): string {
  const bank =
    stage === 'first' ? ACTIVE_FOLLOWUP_PHRASES : ACTIVE_FINAL_CLOSE_PHRASES;
  return bank[Math.abs(seedIndex) % bank.length];
}

export function pickNightFinalPhrase(seedIndex: number): string {
  return NIGHT_FINAL_CLOSE_PHRASES[
    Math.abs(seedIndex) % NIGHT_FINAL_CLOSE_PHRASES.length
  ];
}

export function finalPhraseForLocalHour(
  hour: number,
  seedIndex: number,
  nightSeedIndex?: number,
): string {
  const isNight = hour >= 22 || hour < 5;
  return isNight
    ? pickNightFinalPhrase(nightSeedIndex ?? seedIndex)
    : pickPhrase('final', seedIndex);
}

export function rotationIndexForUser(
  userId: string,
  localDay: string,
  priorCount: number,
): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < localDay.length; i += 1) {
    hash = (hash * 31 + localDay.charCodeAt(i)) >>> 0;
  }
  return (hash + priorCount) % 1_000_000_007;
}
