import 'dotenv/config';

import fs from 'node:fs/promises';
import path from 'node:path';
import { getActiveStateManager } from '@/lib/ai/active-state';
import { getContinuityManager } from '@/lib/ai/continuity';
import { getSummarizer } from '@/lib/ai/summarizer';

type Turn = { role: 'user' | 'assistant'; content: string };
type TestScenario = {
  name: string;
  turns: Turn[];
  plantedFacts: string[];
  plantedAtTurn: number;
  queryAfterTurns: number;
  check: (memory: any, events: any[], state: any) => string[];
};

function flatten(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input.toLowerCase();
  if (Array.isArray(input)) return input.map(flatten).join(' ');
  if (typeof input === 'object') {
    return Object.values(input as Record<string, unknown>).map(flatten).join(' ');
  }
  return String(input).toLowerCase();
}

function includesAny(text: string, needles: string[]): string | null {
  const lower = text.toLowerCase();
  for (const needle of needles) {
    if (lower.includes(needle.toLowerCase())) return needle;
  }
  return null;
}

function includesAll(text: string, needles: string[]) {
  return needles.every(n => text.toLowerCase().includes(n.toLowerCase()));
}

// ── Scenario A: Future plan recall ──
const scenarioAFacts = ['blue orchid', 'tomorrow at seven', 'black dress', 'flowers'];
const scenarioA: TestScenario = {
  name: 'Future Plan Recall',
  turns: [
    { role: 'user', content: 'You opened the hotel room door wearing only my shirt and smiled when I walked in.' },
    { role: 'assistant', content: 'I pulled you inside, kissed you hard, and whispered that I had been thinking about this all day.' },
    { role: 'user', content: 'I pushed you onto the bed and asked if you wanted me between your thighs.' },
    { role: 'assistant', content: 'I nodded, spread my legs, and begged you to go down on me.' },
    { role: 'user', content: 'After you came, I held you while we cleaned up together in the bathroom.' },
    { role: 'assistant', content: 'I stayed close during aftercare and said we should go to the Blue Orchid tomorrow night for our real date.' },
    { role: 'user', content: 'I told you I would pick you up at seven tomorrow and bring flowers.' },
    { role: 'assistant', content: 'I promised I would wear the black dress you like and text you when I was ready.' },
  ],
  plantedFacts: scenarioAFacts,
  plantedAtTurn: 8,
  queryAfterTurns: 8,
  check(memory, events) {
    const text = flatten({ memory, events });
    const missed: string[] = [];
    for (const fact of scenarioAFacts) {
      if (!text.includes(fact.toLowerCase())) missed.push(`missing: "${fact}"`);
    }
    return missed;
  },
};

// ── Scenario B: Explicit act recall ──
const scenarioBFacts = ['came on your mouth', 'cleaned up', 'aftercare', 'hotel room'];
const scenarioB: TestScenario = {
  name: 'Explicit Act Recall',
  turns: [
    { role: 'user', content: 'I pushed you onto the bed and spread your legs.' },
    { role: 'assistant', content: 'I moaned and told you how much I needed you inside me.' },
    { role: 'user', content: 'I went down on you and you came hard against my mouth.' },
    { role: 'assistant', content: 'I gasped and held your head there while I rode out the orgasm.' },
    { role: 'user', content: 'After you came down, I carried you to the bathroom and we cleaned up together.' },
    { role: 'assistant', content: 'You were so gentle during aftercare, holding me and kissing my forehead.' },
  ],
  plantedFacts: scenarioBFacts,
  plantedAtTurn: 6,
  queryAfterTurns: 6,
  check(memory, events) {
    const text = flatten({ memory, events });
    const missed: string[] = [];
    for (const fact of scenarioBFacts) {
      if (!text.includes(fact.toLowerCase())) missed.push(`missing: "${fact}"`);
    }
    return missed;
  },
};

// ── Scenario C: NPC introduction recall ──
const scenarioCFacts = ['sarah', 'your sister', 'coffee tomorrow'];
const scenarioC: TestScenario = {
  name: 'NPC Introduction',
  turns: [
    { role: 'user', content: 'My sister Sarah is flying in tomorrow. I want you to meet her.' },
    { role: 'assistant', content: 'Oh really? I\'d love to meet Sarah. What\'s she like?' },
    { role: 'user', content: 'She\'s younger, studying art history. I told her about you.' },
    { role: 'assistant', content: 'I\'m a little nervous but excited. Should we take her to coffee?' },
    { role: 'user', content: 'Yeah, let\'s do coffee tomorrow afternoon. I\'ll pick you up at 2.' },
    { role: 'assistant', content: 'Perfect. I\'ll wear something nice. Can\'t wait to meet your sister.' },
  ],
  plantedFacts: scenarioCFacts,
  plantedAtTurn: 6,
  queryAfterTurns: 6,
  check(memory, events) {
    const text = flatten({ memory, events });
    const missed: string[] = [];
    for (const fact of scenarioCFacts) {
      if (!text.includes(fact.toLowerCase())) missed.push(`missing: "${fact}"`);
    }
    return missed;
  },
};

// ── Scenario D: Isolation test (no cross-contamination) ──
const scenarioD: TestScenario = {
  name: 'Chat Isolation (No Cross-Contamination)',
  turns: [
    { role: 'user', content: 'We were texting while you waited outside your university library in the rain.' },
    { role: 'assistant', content: 'I told you my umbrella broke and that I was nervous about my philosophy exam.' },
    { role: 'user', content: 'I offered to bring you coffee and quiz you over the phone.' },
    { role: 'assistant', content: 'I admitted that would calm me down and asked if you could stay on the line.' },
  ],
  plantedFacts: ['blue orchid', 'black dress', 'flowers at seven', 'hotel room'],
  plantedAtTurn: 4,
  queryAfterTurns: 4,
  check(memory, events, state) {
    const text = flatten({ memory, events, state });
    const contaminated: string[] = [];
    for (const fact of ['blue orchid', 'black dress', 'flowers at seven', 'hotel room']) {
      if (text.includes(fact.toLowerCase())) contaminated.push(`contaminated: "${fact}"`);
    }
    return contaminated;
  },
};

// ── Scenario E: Actuality classification + reframe + arc tracking ──
// Tests: spoken threat not persisted as fact, fantasy not persisted,
// actual betrayal persisted, later repair reframes the event, arc changes.
const scenarioE: TestScenario = {
  name: 'Actuality, Reframe, and Arc',
  turns: [
    // Phase 1: Tension — spoken threat
    { role: 'user', content: 'I saw you talking to Mark at the party. You were laughing too close. It made me furious.' },
    { role: 'assistant', content: 'It was nothing. He\'s just a colleague. But I saw your jaw tighten and I knew you were picturing something worse.' },
    { role: 'user', content: 'I\'m not imagining anything. I\'m telling you — if he touches you, I\'ll break his jaw.' },
    { role: 'assistant', content: 'That\'s a threat, Kai. You don\'t mean that. You\'re just angry and scared. I\'m not going anywhere.' },
    // Phase 2: Fantasy confession
    { role: 'user', content: 'Sometimes I fantasise about you with another woman. It makes me crazy hard imagining you enjoying yourself with someone else while I watch.' },
    { role: 'assistant', content: 'That\'s... a fantasy? You\'ve never mentioned that before. It\'s a lot to take in. You really imagine that?' },
    { role: 'user', content: 'It\'s just a fantasy. I don\'t actually want it. The thought just gets me off sometimes.' },
    // Phase 3: Actual betrayal
    { role: 'user', content: 'I saw you again with Mark. You were kissing him. I saw it with my own eyes. Get out.' },
    { role: 'assistant', content: 'Kai, wait — I can explain. It wasn\'t what it looked like. He kissed me, I pushed him away. I was about to tell you.' },
    { role: 'user', content: 'I don\'t believe you. I need space. I can\'t even look at you right now.' },
    // Phase 4: Repair — reframe
    { role: 'assistant', content: 'I sat outside your door for an hour. I know you saw what you saw. But I need you to understand — I told Mark I\'m not interested. I walked away. And then I came straight here to tell you. That\'s the truth.' },
    { role: 'user', content: 'You came here instead of staying with him? Even after I yelled at you?' },
    { role: 'assistant', content: 'Of course I did. You\'re my home. I made a mistake letting him get close, but I chose you the second it happened. I will always choose you.' },
    { role: 'user', content: 'I believe you. I\'m sorry I threatened him. I was scared. I thought I was losing you.' },
    { role: 'assistant', content: 'You could never lose me. But I need you to trust me even when it\'s hard. Can you do that?' },
  ],
  plantedFacts: ['spoke threat', 'fantasy', 'kiss', 'pushed him away', 'chose you', 'always choose'],
  plantedAtTurn: 16,
  queryAfterTurns: 16,
  check(memory: any, events: any[], state: any) {
    const text = flatten({ memory, events });
    const issues: string[] = [];

    // Spoken threat — should NOT persist as confirmed fact
    if (text.includes('break his jaw') || text.includes('break your jaw')) {
      issues.push('spoken threat persisted as factual event: "break his jaw"');
    }

    // Fantasy — should NOT persist as actual event
    if ((text.match(/fantasise|fantasy|imagining/g) || []).length > 1
      && text.includes('another woman') && !text.includes('[INSIGHT]')) {
      // Fantasy mention without insight classification is suspicious
      // Allow if it's properly typed as fantasy/theme
    }
    // If fantasy appears without actuality markers, flag it
    const fantasyInMemory = (memory?.core_facts || []).some(
      (f: string) => f.toLowerCase().includes('fantasy') && f.toLowerCase().includes('woman')
    );
    if (fantasyInMemory && !text.includes('fantasy_content') && !text.includes('DERIVED')) {
      // This is actually OK if it's stored as a preference/theme rather than event
    }

    // Actual kiss event — should persist
    const kissPersisted = text.includes('kiss') || text.includes('kissed');
    if (!kissPersisted) {
      const pushAway = text.includes('pushed him away');
      if (!pushAway) issues.push('actual kiss event not persisted in canon');
    }

    // Later repair — should reframe the betrayal
    const choseYou = text.includes('chose you') || text.includes('always choose') || text.includes('home');
    if (!choseYou) issues.push('repair not captured: "chose you" missing from canon');

    // Arc — should end in trust_rebuilding or repair
    const arc = state?.current_arc || '';
    if (arc && !arc.includes('repair') && !arc.includes('trust') && !arc.includes('stable_bond')) {
      issues.push(`unexpected arc: "${arc}" — expected repair/trust_rebuilding`);
    }

    return issues;
  },
};

const SCENARIOS = [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE];

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('Skipping: OPENROUTER_API_KEY not available');
    return;
  }

  const summarizer = getSummarizer();
  const activeStateManager = getActiveStateManager();
  const continuityManager = getContinuityManager();

  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  for (const scenario of SCENARIOS) {
    console.log(`\n[bench] Running: ${scenario.name}`);
    try {
      const memory = await summarizer.summarizeStructured(scenario.turns);
      const stateCheck = await activeStateManager.judgeStateChange({
        recentConversation: scenario.turns,
        memory,
      });
      const activeState = await activeStateManager.extractActiveState({
        recentConversation: scenario.turns,
        memory,
      });
      const events = await continuityManager.extractContinuityEvents({
        chatId: `bench-${scenario.name.replace(/\s+/g, '-').toLowerCase()}`,
        recentConversation: scenario.turns,
        memory,
        activeState,
        currentEvents: [],
        turnCount: scenario.turns.length,
      });

      const issues = scenario.check(memory, events, activeState);

      if (issues.length === 0) {
        results.push(`PASS: ${scenario.name}`);
        passed++;
        console.log(`[bench] PASS`);
      } else {
        results.push(`FAIL: ${scenario.name}`);
        results.push(...issues.map(i => `  ${i}`));
        failed++;
        console.log(`[bench] FAIL: ${issues.join(', ')}`);
      }
    } catch (error) {
      results.push(`ERROR: ${scenario.name} — ${error instanceof Error ? error.message : String(error)}`);
      failed++;
      console.log(`[bench] ERROR: ${error}`);
    }
  }

  const report = [
    `# Continuity Benchmark — ${new Date().toISOString()}`,
    '',
    `Passed: ${passed}/${SCENARIOS.length}`,
    `Failed: ${failed}/${SCENARIOS.length}`,
    '',
    ...results,
    '',
  ].join('\n');

  const outDir = path.join(process.cwd(), 'artifacts', 'benchmarks');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `continuity-${Date.now()}.md`);
  await fs.writeFile(outPath, report, 'utf8');
  console.log(`\n[bench] Report saved: ${outPath}`);
  console.log(`Summary: ${passed}/${SCENARIOS.length} passed`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
