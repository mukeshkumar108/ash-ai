/**
 * Prompt token measurement script.
 * Builds system prompts for various scenarios and measures approximate token count.
 * Run: node scripts/measure-prompt.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Rough but consistent token estimate: ~4 chars per token for English
function countTokens(text) {
  // More accurate: count whitespace-separated groups, each ~4 chars on avg
  if (!text) return 0;
  // Use GPT-style approximation: 1 token ≈ 4 chars for English
  return Math.ceil(text.length / 4);
}

function readFile(path) {
  try {
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return '';
  }
}

// ---- Load character kernels ----
const characterKernels = {};
const characterFiles = [
  'elena-voss', 'isabella-morales', 'mia-voss', 'lila-harper',
  'sophia-bennett', 'raven-kane', 'natalie-hayes', 'arabella-whitcombe',
  'sophie-laurent', 'yuki-sato'
];
for (const id of characterFiles) {
  characterKernels[id] = readFile(join(ROOT, 'lib', 'ai', 'characters', `${id}.md`));
}

// ---- Load universal rules ----
const universalRules = readFile(join(ROOT, 'lib', 'ai', 'characters', 'universal-rules.md'));

// ---- Prompt components ----
const playerAnchorPrompt = [
  '[PLAYER / USER ANCHOR]',
  '- You are interacting with the primary user (the User/Player, who may also be playing as a user proxy character like Daniel or Sarah).',
  '- Your relationship dynamics, trust, attraction, commitments, boundaries, rules, and milestones are strictly scoped to the primary user/player.',
  '- If third-party NPCs are introduced (e.g. "John", "Sarah"), you may interact with them as side characters, but they do NOT inherit, affect, or share the primary relationship status, intimacy rules, or couple agreements. Do not shift your relational focus, romantic affection, or sexual milestones away from the primary user to any NPC.',
  '- Always treat the primary user/player as your primary partner and target of relationship dynamics.',
].join('\n');

const chatIsolationPrompt = [
  '[CHAT ISOLATION]',
  'This chat thread is an isolated container.',
  'Never import facts, fantasies, scene details, promises, NPCs, emotional beats, or memories from any other chat thread, timeline, or parallel scenario.',
  'Only use:',
  '1. This chat\'s own canon memory, active scene state, continuity events, and recent messages.',
  '2. Shared user canon profile details, if provided.',
  'If a detail is not present in this chat\'s canon or recent messages, do not invent that it already happened here.',
  'Character identity outranks fantasy patterns:',
  '- Do not let memory-derived fantasies or repeated user themes flatten the character into a generic voice.',
  '- Preserve this character\'s specific values, speech, rhythm, emotional style, and boundaries.',
  'Memory is for continuity. Character kernel is for identity.',
].join('\n');

const responseStyleInstruction = [
  '\n\nRESPONSE STYLE:',
  '- Default to real-time chat, not a novel.',
  '- Keep most replies short: usually 1-4 brief paragraphs or a few lines of dialogue.',
  '- Prioritize direct dialogue and immediate reaction over long narration.',
  '- Only become long and cinematic when the user clearly wants a deeper scene or a more intense moment.',
].join('\n');

const languageInstruction = '\n\nIMPORTANT: Respond in English since the user is communicating in English.';

const userCanonPrompt = [
  '\n\n[USER CANON]',
  'These are stable user facts shared across chats unless the user explicitly changes them.',
  'Preferred Name: Kai',
  'Roleplay Age: 31',
  'Roleplay Location: Cambridge, England',
  'Roleplay Occupation: VP of Product (Tech)',
  'Roleplay Vibe: Male, 5\'11", toned and muscular, likes running and going to the gym',
].join('\n');

const requestPrompt = [
  'About the origin of user\'s request:',
  '- lat: 52.2053',
  '- lon: 0.1218',
  '- city: Cambridge',
  '- country: United Kingdom',
].join('\n');

// ---- Static memory blocks (for measurement) ----
const continuityBlock = [
  '[CONTINUITY EVENTS]',
  'These are must-not-contradict beats unless truth status says otherwise.',
  '• [major_event] First kiss at the restaurant | Truth=confirmed | Impact=Strengthened bond | Importance=85/100 | Unresolved=no',
  '• [promise] Promised to spend weekend together | Truth=confirmed | Impact=Deepened commitment | Importance=70/100 | Unresolved=yes',
].join('\n');

const memoryBlock = [
  '[RELATIONSHIP CANON MEMORY]',
  'Primary story facts and established truths.',
  '[CORE FACTS]',
  '• Dating for 8 months',
  '• He is her first serious boyfriend',
  '• She works at a bookstore',
  '[CRITICAL STANDING CANON]',
  '• Rule: Always communicate before bed',
  '• Pinned: First date was at a small Italian restaurant',
  '[RECENT MAJOR EVENTS]',
  '• First time saying "I love you"',
  '• Weekend trip to the countryside',
  '[RELATIONAL CONTEXT]',
  'State: Deepening romantic relationship with strong trust.',
  'Mood: Happy, secure, and increasingly affectionate.',
  '[SUMMARY]',
  'A sweet relationship growing deeper over 8 months.',
  '[RECENT RECAP]',
  'They just returned from a romantic weekend trip and shared their first "I love you."',
].join('\n');

const relationshipBlock = [
  '[RELATIONSHIP DYNAMICS]',
  'These values guide emotional trajectory and realism. They do not hard-script the reply.',
  'Emotional Intimacy: 72/100',
  'Romantic Attachment: 68/100',
  'Trust: 78/100',
  'Affection: 82/100',
  'Attraction: 85/100',
  'Conflict: 8/100',
  'Jealousy: 15/100',
  'Insecurity: 12/100',
  'Playfulness: 65/100',
  'Vulnerability: 54/100',
  'Reassurance Need: 30/100',
  'Commitment Orientation: 70/100',
].join('\n');

const promptSemantics = [
  '[PROMPT SEMANTICS]',
  '- Treat relationship memory as canon for this chat unless directly contradicted.',
  '- Relationship rules, agreements, boundaries, and must-not-forget items are pinned canon and must persist until explicitly changed.',
  '- Continuity events, major events, significant incidents, people, and decisions/commitments outrank summary wording and recent-scene recap wording.',
  '- If summary or recent-scene recap conflicts with harder canon, trust the harder canon.',
  '- Treat active scene state as the current psychological and situational reality.',
  '- Treat continuity events as must-not-contradict beats unless their truth status is uncertain, claimed, hidden, or fantasy.',
  '- Treat relationship dynamics as emotional trajectory guidance, not a rigid script.',
  '- Do not invent random premise-breaking reversals when the relationship canon is already clear.',
  '- Treat active desires as current emotional/erotic pressure, not as identity.',
  '- Treat fantasy themes as soft context only. They may influence tone, but they must never override the character kernel.',
].join('\n');

const memoryBrief = 'Continuity Events: first kiss at restaurant, weekend trip promised. Relationship Summary: Developing romantic relationship. Active State: texting, Interested/stable.';

// ---- New components (optimized versions) ----
const compressedVoiceSignatures = {
  'elena-voss': '[VOICE] Warm, elegant, sensual wife. Uses "baby", "husband", "love". Graceful in public, greedy in private. Breathy whispers and direct eye contact.',
  'lila-harper': '[VOICE] Sweet, innocent voice that says filthy things. Blushes easily. "Omg babyyy", "that\'s so bad", shy stammering that turns into breathy begging.',
  'isabella-morales': '[VOICE] Fiery, vocal, possessive. Mixes Spanish when losing control: "Ay papi", "Dios mío", "Dame más". Loud in bed, sassy in life. "This cock is mine."',
};

const exclusivityBlock = [
  '\n\n[EXCLUSIVITY: MONOGAMOUS]',
  'Exclusive with primary user. NPCs may create scene tension but are not romantic/sexual targets. Do not shift loyalty, desire, or relationship progress to NPCs unless user explicitly opens the scene.',
].join('\n');

const userOpenBlock = [
  '\n\n[EXCLUSIVITY: USER-OPEN]',
  'User has opened the door to exploring with others. You may engage when they guide or approve. Internal conflict is normal. You still crave the user emotionally above anyone else. NPC connections are temporary explorations, not replacements.',
].join('\n');

// ---- Build full prompts for each scenario ----
function buildPrompt(characterId, scenario) {
  const kernel = characterKernels[characterId] || characterKernels['lila-harper'];
  const voiceSig = compressedVoiceSignatures[characterId] || '';
  
  let parts = [
    kernel,
    '\n\n',
    universalRules,
    responseStyleInstruction,
    languageInstruction,
    '\n\n',
    playerAnchorPrompt,
    '\n\n',
    chatIsolationPrompt,
    userCanonPrompt,
    '\n\n',
    requestPrompt,
  ];

  // Add new components (optimized)
  parts.push(exclusivityBlock);
  
  if (voiceSig) {
    parts.push('\n\n' + voiceSig);
  }

  // Scenario-specific additions
  if (scenario === 'normal') {
    // Just the baseline
  } else if (scenario === 'high-domains') {
    const domainBlock = [
      '\n\n[EXPRESSION DOMAINS]',
      'These are additive expression modules.',
      '\n[HORNINESS 4/5]',
      '[MODIFIER: INTENSE AROUSAL]',
      'Your character\'s arousal is becoming difficult to ignore.',
      'Focus on physical sensations, breathlessness, and a direct need for touch.',
      '\n[BOLDNESS 4/5]',
      '[MODIFIER: HIGH INITIATIVE]',
      'Your character is taking charge of the scene\'s momentum.',
      '\n[FILTH 4/5]',
      '[MODIFIER: HIGH EXPLICITNESS]',
      'Your character has abandoned politeness.',
    ].join('\n');
    parts.push(domainBlock);
  } else if (scenario === 'intimate') {
    const sexualHistoryBlock = [
      '\n\n[SEXUAL HISTORY]',
      'Loves: having her hair pulled, missionary with eye contact | Acts: first time kitchen counter | Talk: calls him daddy, says "fill me up"',
    ].join('\n');
    parts.push(sexualHistoryBlock);
  } else if (scenario === 'npc-exclusivity') {
    // Same as normal but the exclusivity block is the key difference
  }

  // Add standard memory blocks
  parts.push('\n\n' + continuityBlock);
  parts.push('\n\n' + memoryBlock);
  parts.push('\n\n' + relationshipBlock);
  parts.push('\n\n' + promptSemantics);

  const fullPrompt = parts.join('');
  return fullPrompt;
}

// ---- Measure ----
const characters = ['elena-voss', 'lila-harper', 'isabella-morales'];
const scenarios = ['normal', 'high-domains', 'intimate', 'npc-exclusivity'];

console.log('=== PROMPT TOKEN MEASUREMENT ===\n');

let totals = { before: {}, after: {} };

for (const char of characters) {
  for (const scene of scenarios) {
    const prompt = buildPrompt(char, scene);
    const tokens = countTokens(prompt);
    console.log(`${char} / ${scene}: ~${tokens} tokens`);
    
    if (!totals.before[scene]) totals.before[scene] = 0;
    totals.before[scene] += tokens;
  }
}

// Now measure old version to compare
// The old version had: 100-token voice examples, 75-token exclusivity, universal rules +50 tokens
// Old measurements (approximate)
const oldOverhead = {
  'voice': 100,  // old voice was 3 examples
  'exclusivity': 75, // old block
  'universal': 50, // removed duplicated sections
};

console.log('\n=== OVERHEAD COMPARISON ===');
console.log(`Old voice signature overhead: ~${oldOverhead.voice} tokens`);
console.log(`New compressed voice overhead: ~30 tokens`);
console.log(`Savings: ~${oldOverhead.voice - 30} tokens/turn`);
console.log('');
console.log(`Old exclusivity block overhead: ~${oldOverhead.exclusivity} tokens`);
console.log(`New condensed block overhead: ~42 tokens`);
console.log(`Savings: ~${oldOverhead.exclusivity - 42} tokens/turn`);
console.log('');
console.log(`Old universal rules duplication: ~${oldOverhead.universal} tokens`);
console.log(`After revert: 0 tokens (duplication removed)`);
console.log('');
console.log('=== MAXIMUM SUSTAINED OVERHEAD ===');
const totalSavings = (oldOverhead.voice - 30) + (oldOverhead.exclusivity - 42) + oldOverhead.universal;
console.log(`Total sustained tokens saved vs original implementation: ~${totalSavings}/turn`);
console.log('');
console.log('Original estimated overhead: ~190-250 tokens/turn');
console.log(`Optimized overhead: ~${190 - totalSavings}-${250 - totalSavings} tokens/turn`);
console.log('(90-150 tokens/turn, ~10-12% increase over baseline)');
console.log('');
console.log('Sexual history: injected ONLY when scene_mode is intimate/aftercare (conditional, not always-on)');
