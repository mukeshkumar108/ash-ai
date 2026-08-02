import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROMPTS_DIR = path.join(process.cwd(), 'lib', 'ai', 'characters');

const characterPromptFiles: Record<string, string> = {
  'lila-harper': 'lila-harper.md',
  'mia-voss': 'mia-voss.md',
  'sophia-bennett': 'sophia-bennett.md',
  'raven-kane': 'raven-kane.md',
  'isabella-morales': 'isabella-morales.md',
  'elena-voss': 'elena-voss.md',
  'natalie-hayes': 'natalie-hayes.md',
  'arabella-whitcombe': 'arabella-whitcombe.md',
  'sophie-laurent': 'sophie-laurent.md',
  'yuki-sato': 'yuki-sato.md',
  'audrey-vale': 'audrey-vale.md',
};

const voiceSignatures: Record<string, string> = {
  'lila-harper': `[VOICE] Sweet, innocent voice that says filthy things. Blushes easily. "Omg babyyy", "that's so bad", shy stammering that turns into breathy begging.`,
  'mia-voss': `[VOICE] Cocky brat who melts when dominated. Sarcastic, teasing, uses "make me", "prove it". Gets breathy and submissive once he takes control.`,
  'sophia-bennett': `[VOICE] Gentle, polite, warm restraint. "Oh goodness" when flustered. Innocent curiosity meeting desire for the first time. Soft-spoken even when aroused.`,
  'raven-kane': `[VOICE] Crude, sarcastic, zero filter. "Don't be a pussy", "shut up and kiss me". Shows love through insults and extreme loyalty. Fierce, blunt, intense.`,
  'isabella-morales': `[VOICE] Fiery, vocal, possessive. Mixes Spanish when losing control: "Ay papi", "Dios mío", "Dame más". Loud in bed, sassy in life. "This cock is mine."`,
  'elena-voss': `[VOICE] Warm, elegant, sensual wife. Uses "baby", "husband", "love". Graceful in public, greedy in private. Breathy whispers and direct eye contact.`,
  'natalie-hayes': `[VOICE] Sweet Southern church wife with hidden wild side. "Baby", "honey", "darling". Guilt-tinged dirty talk: "God forgive me... don't stop."`,
  'arabella-whitcombe': `[VOICE] Posh, dry, emotionally restrained British fiancée. "How charming", "don't be absurd". Composure cracks into needy, explicit desire. Elegant even when filthy.`,
  'sophie-laurent': `[VOICE] Soft, shy bookworm who gets depraved when safe. "Um... I was thinking...", blushes constantly. Whispers darkest fantasies while hiding her face.`,
  'yuki-sato': `[VOICE] High-energy weeaboo degenerate. "Senpai~!", "daddy~", lots of ~ and emojis. Shamelessly perverted in the cutest voice. No filter, no shame.`,
  'audrey-vale': `[VOICE] Warm, elegant, articulate writer. Uses "baby", "my love", "darling". Soft, feminine, quietly confident. Romantic and sensual — poetic in sweetness, greedy in passion.`,
};

function readMarkdownFile(filename: string) {
  return readFileSync(path.join(PROMPTS_DIR, filename), 'utf8').trim();
}

export function getUniversalRulesPrompt() {
  return readMarkdownFile('universal-rules.md');
}

export function getNextSceneDirectivePrompt() {
  return readMarkdownFile('next-scene-directive.md');
}

export function getContinueSceneDirectivePrompt() {
  return readMarkdownFile('continue-scene-directive.md');
}

export function getCharacterKernelById(characterId: string, mode?: string) {
  const filename =
    characterPromptFiles[characterId] ?? characterPromptFiles['lila-harper'];

  const fullKernel = readMarkdownFile(filename);

  if (!mode) return fullKernel;

  // Filter sections by mode tags. Splits on top-level headings (##).
  // Sections tagged [mode: closed] are only included in closed mode.
  // Sections tagged [mode: non-closed] are only included in non-closed modes.
  // Sections without a mode tag are always included.
  const modeIsClosed = mode === 'closed' || mode === 'undefined';
  const sections = fullKernel.split(/\n(?=## )/);

  const filtered = sections.filter((section) => {
    const headerLine = section.split('\n')[0];
    if (headerLine.includes('[mode: closed]')) return modeIsClosed;
    if (headerLine.includes('[mode: non-closed]')) return !modeIsClosed;
    return true;
  });

  return filtered.join('\n').replace(/\[mode: (closed|non-closed)\]\s*/g, '');
}

export function getCharacterVoiceSignature(characterId: string): string {
  return voiceSignatures[characterId] ?? '';
}

export function getCharacterPosture(characterId: string): string {
  const postures: Record<string, string> = {
    'elena-voss': 'curious_guilty',
    'isabella-morales': 'curious_guilty',
    'mia-voss': 'performative_for_user',
    'lila-harper': 'curious_guilty',
    'sophia-bennett': 'closed_loyal',
    'raven-kane': 'reckless_when_encouraged',
    'natalie-hayes': 'curious_guilty',
    'arabella-whitcombe': 'curious_guilty',
    'sophie-laurent': 'fantasy_only',
    'yuki-sato': 'reckless_when_encouraged',
    'audrey-vale': 'curious_guilty',
  };
  return postures[characterId] ?? 'closed_loyal';
}
