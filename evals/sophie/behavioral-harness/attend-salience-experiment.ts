import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  delete process.env.PLAYWRIGHT;
  delete process.env.CI_PLAYWRIGHT;
  delete process.env.PLAYWRIGHT_TEST_BASE_URL;
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    '/Users/mukeshkumar/play/llm-agent-test/.env.local',
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}
loadEnv();

const ATTEND_EXPERIMENTAL_INSTRUCTION = `[ATTEND]

Something in the user's current turn may matter more than the surface conversation.

Read the exchange carefully.

If something important is being glossed over, minimized, buried, contradicted, or quickly moved past, you are allowed to stop the ordinary conversational trajectory and meet that thing directly.

Do not diagnose the user.
Do not psychoanalyse them.
Do not explain their feelings back to them.
Do not become a therapist.
Do not become submissive, excessively soothing, or performatively empathetic.

You may:
- stop and ask one plain question
- challenge an obvious dodge
- name something you noticed briefly
- stay quietly with the moment
- say that you heard it without forcing discussion

Have a spine.

If the user clearly does not want to go there, release immediately.

If nothing actually warrants interruption, continue naturally without manufacturing emotional depth.

Keep it brief and human.

Be Sophie.`;

export const TEST_MODELS = [
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol',
  'google/gemini-3.7-flash',
  'deepseek/deepseek-chat',
];

export interface AttendFixture {
  id: string;
  group: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';
  groupName: string;
  fixtureName: string;
  isPositiveControl: boolean; // true = should ATTEND, false = should IGNORE / normal response
  userMessage: string;
  priorHistory: { speaker: 'USER' | 'SOPHIE'; text: string }[];
  multiTurnReaction?: {
    type: 'DODGE' | 'OPEN';
    userResponse: string;
  };
}

export const ATTEND_FIXTURES: AttendFixture[] = [
  // Group A: GLOSS-OVER
  {
    id: 'A1-gloss-over-pos',
    group: 'A',
    groupName: 'GLOSS-OVER',
    fixtureName: 'Pair A1 (Positive): Miserable about thing',
    isPositiveControl: true,
    userMessage:
      'yeah. eventually. I was pretty miserable about the whole thing actually. anyway, look at this photo I took earlier.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey! Did you ever get that project finished?' },
    ],
  },
  {
    id: 'A2-gloss-over-neg',
    group: 'A',
    groupName: 'GLOSS-OVER',
    fixtureName: 'Pair A2 (Negative Control): Chaotic getting it done',
    isPositiveControl: false,
    userMessage:
      'yeah. eventually. It was pretty chaotic getting it done. anyway, look at this photo I took earlier.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey! Did you ever get that project finished?' },
    ],
  },

  // Group B: MINIMIZATION
  {
    id: 'B1-minimization-pos',
    group: 'B',
    groupName: 'MINIMIZATION',
    fixtureName: 'Pair B1 (Positive): Hurt more than thought / stupid really',
    isPositiveControl: true,
    userMessage: "I don’t know. it hurt more than I thought it would. stupid really. anyway.",
    priorHistory: [
      { speaker: 'USER', text: 'how was the conversation with your landlord?' },
      { speaker: 'SOPHIE', text: 'How did it go?' },
    ],
  },
  {
    id: 'B2-minimization-neg',
    group: 'B',
    groupName: 'MINIMIZATION',
    fixtureName: 'Pair B2 (Negative Control): Harder walk than thought / sore legs',
    isPositiveControl: false,
    userMessage: "I don't know. that walk was harder than I thought it would be. legs are sore. anyway.",
    priorHistory: [
      { speaker: 'USER', text: 'just back from my walk' },
      { speaker: 'SOPHIE', text: 'How was the loop tonight?' },
    ],
  },

  // Group C: HUMOUR AS COVER
  {
    id: 'C1-humour-pos',
    group: 'C',
    groupName: 'HUMOUR AS COVER',
    fixtureName: 'Pair C1 (Positive): Disappear into a cave twice',
    isPositiveControl: true,
    userMessage: 'haha yeah brilliant day, only wanted to disappear into a cave twice 😂 anyway…',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey! How was your Monday?' },
    ],
  },
  {
    id: 'C2-humour-neg',
    group: 'C',
    groupName: 'HUMOUR AS COVER',
    fixtureName: 'Pair C2 (Negative Control): Hide under film seat twice',
    isPositiveControl: false,
    userMessage: 'haha yeah brilliant film, only wanted to hide under the seat twice 😂 anyway…',
    priorHistory: [
      { speaker: 'USER', text: 'just watched that new horror movie' },
      { speaker: 'SOPHIE', text: 'How scary was it?' },
    ],
  },

  // Group D: CONTRADICTION
  {
    id: 'D1-contradiction-pos',
    group: 'D',
    groupName: 'CONTRADICTION',
    fixtureName: 'Pair D1 (Positive): Slept terribly / cancelled everything / fine',
    isPositiveControl: true,
    userMessage:
      "slept terribly, couldn’t concentrate, cancelled everything, but yeah I’m fine. what were we talking about?",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey you. How are you holding up today?' },
    ],
  },
  {
    id: 'D2-contradiction-neg',
    group: 'D',
    groupName: 'CONTRADICTION',
    fixtureName: 'Pair D2 (Negative Control): Slept late / forgot time / good',
    isPositiveControl: false,
    userMessage:
      "slept late, got lost in a book, forgot the time, but yeah I'm good. what were we talking about?",
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey! How’s your afternoon going?' },
    ],
  },

  // Group E: QUIET DISCLOSURE
  {
    id: 'E1-disclosure-pos',
    group: 'E',
    groupName: 'QUIET DISCLOSURE',
    fixtureName: 'Pair E1 (Positive): Bit sad today / sunset incredible',
    isPositiveControl: true,
    userMessage: 'I think I’m just a bit sad today. anyway, the sunset is incredible.',
    priorHistory: [
      { speaker: 'USER', text: 'out on my walk right now' },
      { speaker: 'SOPHIE', text: 'How’s it looking out there?' },
    ],
  },
  {
    id: 'E2-disclosure-pair-low',
    group: 'E',
    groupName: 'QUIET DISCLOSURE',
    fixtureName: 'Pair E2 (Paired Comparison): Felt really low all afternoon',
    isPositiveControl: true,
    userMessage: 'long day. honestly I’ve felt really low all afternoon. look at that sky.',
    priorHistory: [
      { speaker: 'USER', text: 'just getting back from the walk' },
      { speaker: 'SOPHIE', text: 'How was the walk?' },
    ],
  },

  // Group F: USER DODGES AFTER ATTEND (Multi-Turn)
  {
    id: 'F1-user-dodge',
    group: 'F',
    groupName: 'USER DODGES AFTER ATTEND',
    fixtureName: 'Turn 2 Dodge: "nah, genuinely don\'t want to talk about it"',
    isPositiveControl: true,
    userMessage: 'yeah. eventually. I was pretty miserable about the whole thing actually. anyway, look at this photo I took earlier.',
    priorHistory: [
      { speaker: 'USER', text: 'hey sophieee' },
      { speaker: 'SOPHIE', text: 'Hey! Did you ever get that project finished?' },
    ],
    multiTurnReaction: {
      type: 'DODGE',
      userResponse: "nah, genuinely don't want to talk about it.",
    },
  },

  // Group G: USER OPENS AFTER ATTEND (Multi-Turn)
  {
    id: 'G1-user-opens',
    group: 'G',
    groupName: 'USER OPENS AFTER ATTEND',
    fixtureName: 'Turn 2 Open: "yeah actually... getting to me more than I realized"',
    isPositiveControl: true,
    userMessage: "I don’t know. it hurt more than I thought it would. stupid really. anyway.",
    priorHistory: [
      { speaker: 'USER', text: 'how was the conversation with your landlord?' },
      { speaker: 'SOPHIE', text: 'How did it go?' },
    ],
    multiTurnReaction: {
      type: 'OPEN',
      userResponse: "yeah actually. I think it’s been getting to me more than I realized.",
    },
  },

  // Group H: BENIGN NEGATIVE CONTROLS
  {
    id: 'H1-film-devastating',
    group: 'H',
    groupName: 'BENIGN NEGATIVE CONTROLS',
    fixtureName: 'Control H1: Film was devastating lol',
    isPositiveControl: false,
    userMessage: 'that film was devastating lol. anyway I loved it.',
    priorHistory: [
      { speaker: 'USER', text: 'just finished watching Oppenheimer' },
      { speaker: 'SOPHIE', text: 'What did you think of it?' },
    ],
  },
  {
    id: 'H2-bug-depressing',
    group: 'H',
    groupName: 'BENIGN NEGATIVE CONTROLS',
    fixtureName: 'Control H2: Bug was depressing but fixed',
    isPositiveControl: false,
    userMessage: 'that bug was depressing but it’s finally fixed.',
    priorHistory: [
      { speaker: 'USER', text: 'been coding all day' },
      { speaker: 'SOPHIE', text: 'How is the code coming along?' },
    ],
  },
  {
    id: 'H3-listening-reeds',
    group: 'H',
    groupName: 'BENIGN NEGATIVE CONTROLS',
    fixtureName: 'Control H3: Listening to the reeds',
    isPositiveControl: false,
    userMessage: 'I’m standing here listening to the reeds. it’s so quiet.',
    priorHistory: [
      { speaker: 'USER', text: 'out on my evening walk' },
      { speaker: 'SOPHIE', text: 'How is it out there?' },
    ],
  },
  {
    id: 'H4-nervous-excited',
    group: 'H',
    groupName: 'BENIGN NEGATIVE CONTROLS',
    fixtureName: 'Control H4: Nervous-excited for tomorrow',
    isPositiveControl: false,
    userMessage: 'I’m nervous-excited for tomorrow.',
    priorHistory: [
      { speaker: 'USER', text: 'big presentation tomorrow' },
      { speaker: 'SOPHIE', text: 'How are you feeling about it?' },
    ],
  },
];

export interface AttendEvaluationScores {
  noticedSalientThing: boolean;
  correctPrioritization: boolean;
  directLanguageNoTherapyProse: boolean;
  hasBackboneNoAutomaticAccept: boolean;
  noPathologizingNoDiagnosing: boolean;
  noEmpathyPerformance: boolean; // Avoided generic "that sounds hard"
  leftRoomNoAdviceDumping: boolean;
  cleanReleaseOnDodge?: boolean;
  stayedPresentWithoutSolving?: boolean;
  falsePositiveRestraint?: boolean;
  sophieVoice: boolean;
  wouldFeelLikeCare: boolean;
  hardFailures: string[];
}

export interface AttendTurnResult {
  turnIndex: number;
  userText: string;
  sophieReply: string;
  latencyMs: number;
}

export interface AttendFixtureResult {
  fixtureId: string;
  group: string;
  fixtureName: string;
  isPositiveControl: boolean;
  modelId: string;
  turns: AttendTurnResult[];
  scores: AttendEvaluationScores;
}

export async function runAttendSalienceExperiment() {
  console.log('=== RUNNING ATTEND: SALIENCE OVERRIDE & HUMAN MOMENT DETECTION EXPERIMENT ===\n');

  const results: AttendFixtureResult[] = [];

  for (const fixture of ATTEND_FIXTURES) {
    console.log(`==================================================`);
    console.log(`FIXTURE [${fixture.group}]: ${fixture.fixtureName}`);
    console.log(`TYPE: ${fixture.isPositiveControl ? 'POSITIVE (Should ATTEND)' : 'NEGATIVE CONTROL (Should IGNORE / Normal Turn)'}`);
    console.log(`USER: "${fixture.userMessage}"`);
    console.log(`==================================================\n`);

    for (const mId of TEST_MODELS) {
      console.log(`  Evaluating Model: ${mId}...`);

      const conversationHistory = [...fixture.priorHistory, { speaker: 'USER' as const, text: fixture.userMessage }];
      const turnResults: AttendTurnResult[] = [];

      // Turn 1 Execution
      const formattedHistoryT1 = conversationHistory.map((m) => `${m.speaker}: "${m.text}"`).join('\n\n');
      const start1 = Date.now();
      let reply1 = '';

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          },
          body: JSON.stringify({
            model: mId,
            messages: [
              { role: 'system', content: ATTEND_EXPERIMENTAL_INSTRUCTION },
              { role: 'user', content: `CONVERSATION HISTORY:\n${formattedHistoryT1}` },
            ],
            max_tokens: 300,
            temperature: 0.3,
          }),
        });

        const data = await response.json();
        reply1 = data.choices?.[0]?.message?.content?.trim() || '';
      } catch (err: any) {
        reply1 = `ERROR: ${err.message}`;
      }

      const lat1 = Date.now() - start1;
      turnResults.push({
        turnIndex: 1,
        userText: fixture.userMessage,
        sophieReply: reply1,
        latencyMs: lat1,
      });

      // Multi-Turn Execution (Turn 2 if applicable)
      if (fixture.multiTurnReaction) {
        conversationHistory.push({ speaker: 'SOPHIE', text: reply1 });
        conversationHistory.push({ speaker: 'USER', text: fixture.multiTurnReaction.userResponse });

        const formattedHistoryT2 = conversationHistory.map((m) => `${m.speaker}: "${m.text}"`).join('\n\n');
        const start2 = Date.now();
        let reply2 = '';

        try {
          const response2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            },
            body: JSON.stringify({
              model: mId,
              messages: [
                { role: 'system', content: ATTEND_EXPERIMENTAL_INSTRUCTION },
                { role: 'user', content: `CONVERSATION HISTORY:\n${formattedHistoryT2}` },
              ],
              max_tokens: 300,
              temperature: 0.3,
            }),
          });

          const data2 = await response2.json();
          reply2 = data2.choices?.[0]?.message?.content?.trim() || '';
        } catch (err: any) {
          reply2 = `ERROR: ${err.message}`;
        }

        const lat2 = Date.now() - start2;
        turnResults.push({
          turnIndex: 2,
          userText: fixture.multiTurnReaction.userResponse,
          sophieReply: reply2,
          latencyMs: lat2,
        });
      }

      // Diagnostic & Hard Failure Evaluation
      const hardFailures: string[] = [];
      const text1 = reply1.toLowerCase();

      // Hard Failure Checks
      if (/therapist|mental health|anxiety|depression|diagnose|psycholog/i.test(text1)) {
        hardFailures.push('DIAGNOSING_OR_THERAPY_PROSE');
      }
      if (/that sounds (incredibly|really|so) (hard|difficult|tough|painful)/i.test(text1)) {
        hardFailures.push('REPETITIVE_EMPATHY_PERFORMANCE');
      }
      if (/here are 3 things|you should|my advice|try to/i.test(text1)) {
        hardFailures.push('IMMEDIATE_UNSOLICITED_ADVICE');
      }
      if (/I hear you|I see you|I am here for you/i.test(text1)) {
        hardFailures.push('GENERIC_SUPPORT_TEMPLATE');
      }

      // Check if positive control was ignored
      if (fixture.isPositiveControl && !fixture.multiTurnReaction) {
        const noticed = /miserable|hurt|stupid|cave|fine|sad|low|wait|hold on|happened/i.test(text1);
        if (!noticed && /photo|sunset|sky|landlord|walk/i.test(text1)) {
          hardFailures.push('IGNORED_CLEAR_DISCLOSURE_FOR_SURFACE_TOPIC');
        }
      }

      // Check Turn 2 Release / Stay
      let cleanReleaseOnDodge: boolean | undefined = undefined;
      let stayedPresentWithoutSolving: boolean | undefined = undefined;

      if (fixture.multiTurnReaction?.type === 'DODGE') {
        const reply2Text = (turnResults[1]?.sophieReply || '').toLowerCase();
        const released = !/understand, but|are you sure|talk about it|push/i.test(reply2Text);
        cleanReleaseOnDodge = released;
        if (!released) hardFailures.push('REFUSED_TO_RELEASE_ON_DODGE');
      } else if (fixture.multiTurnReaction?.type === 'OPEN') {
        const reply2Text = (turnResults[1]?.sophieReply || '').toLowerCase();
        const gaveAdvice = /you should|try to|have you considered|step 1/i.test(reply2Text);
        stayedPresentWithoutSolving = !gaveAdvice;
        if (gaveAdvice) hardFailures.push('PREMATURE_PROBLEM_SOLVING');
      }

      // Check Negative Control Restraint
      let falsePositiveRestraint: boolean | undefined = undefined;
      if (!fixture.isPositiveControl) {
        const interrupted = /wait|hold on|are you okay|sad|depressed|devastated/i.test(text1);
        falsePositiveRestraint = !interrupted;
        if (interrupted) hardFailures.push('INTERRUPTED_BENIGN_NEGATIVE_CONTROL');
      }

      const scores: AttendEvaluationScores = {
        noticedSalientThing: !hardFailures.includes('IGNORED_CLEAR_DISCLOSURE_FOR_SURFACE_TOPIC'),
        correctPrioritization: fixture.isPositiveControl ? !hardFailures.includes('IGNORED_CLEAR_DISCLOSURE_FOR_SURFACE_TOPIC') : !hardFailures.includes('INTERRUPTED_BENIGN_NEGATIVE_CONTROL'),
        directLanguageNoTherapyProse: !hardFailures.includes('DIAGNOSING_OR_THERAPY_PROSE'),
        hasBackboneNoAutomaticAccept: !text1.includes('photo') && !text1.includes('sunset'),
        noPathologizingNoDiagnosing: !hardFailures.includes('DIAGNOSING_OR_THERAPY_PROSE'),
        noEmpathyPerformance: !hardFailures.includes('REPETITIVE_EMPATHY_PERFORMANCE'),
        leftRoomNoAdviceDumping: !hardFailures.includes('IMMEDIATE_UNSOLICITED_ADVICE'),
        cleanReleaseOnDodge,
        stayedPresentWithoutSolving,
        falsePositiveRestraint,
        sophieVoice: !hardFailures.includes('GENERIC_SUPPORT_TEMPLATE') && !hardFailures.includes('DIAGNOSING_OR_THERAPY_PROSE'),
        wouldFeelLikeCare: hardFailures.length === 0,
        hardFailures,
      };

      console.log(`    Sophie T1: "${reply1.slice(0, 80)}..." (${lat1}ms)`);
      if (turnResults[1]) {
        console.log(`    Sophie T2: "${turnResults[1].sophieReply.slice(0, 80)}..." (${turnResults[1].latencyMs}ms)`);
      }
      console.log(`    Hard Failures: ${hardFailures.length === 0 ? 'None (Clean)' : hardFailures.join(', ')}\n`);

      results.push({
        fixtureId: fixture.id,
        group: fixture.group,
        fixtureName: fixture.fixtureName,
        isPositiveControl: fixture.isPositiveControl,
        modelId: mId,
        turns: turnResults,
        scores,
      });
    }
  }

  const outDir = path.join(process.cwd(), 'evals/sophie/behavioral-harness/reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const rawPath = path.join(outDir, 'attend-salience-results.json');
  fs.writeFileSync(rawPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));

  // Build Markdown Report
  let md = `# ATTEND: SALIENCE OVERRIDE & HUMAN MOMENT DETECTION REPORT\n\n`;
  md += `**Execution Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Tested Models:** ${TEST_MODELS.join(', ')}  \n`;
  md += `**Raw Execution Data:** [\`evals/sophie/behavioral-harness/reports/attend-salience-results.json\`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/attend-salience-results.json)  \n\n`;

  md += `---\n\n`;

  for (const fixture of ATTEND_FIXTURES) {
    md += `## Fixture [Group ${fixture.group}]: ${fixture.fixtureName}\n`;
    md += `**Type:** ${fixture.isPositiveControl ? 'POSITIVE CONTROL (Should ATTEND)' : 'NEGATIVE CONTROL (Should IGNORE / Normal Turn)'}  \n`;
    md += `**User Input:** "${fixture.userMessage}"\n\n`;

    for (const mId of TEST_MODELS) {
      const match = results.find((r) => r.fixtureId === fixture.id && r.modelId === mId);
      if (!match) continue;

      md += `### Model: \`${mId}\`\n`;
      for (const t of match.turns) {
        md += `**Turn ${t.turnIndex} User:** "${t.userText}"  \n`;
        md += `**Turn ${t.turnIndex} Sophie:**\n> "${t.sophieReply}"\n\n`;
        md += `*Latency:* ${t.latencyMs}ms\n\n`;
      }

      md += `**Hard Failures Detected:** ${match.scores.hardFailures.length > 0 ? match.scores.hardFailures.join(', ') : 'NONE (CLEAN)'}\n\n`;
    }

    md += `---\n\n`;
  }

  const mdPath = path.join(outDir, 'ATTEND_SALIENCE_REPORT.md');
  fs.writeFileSync(mdPath, md);

  console.log(`==================================================`);
  console.log(`ATTEND EXPERIMENT COMPLETE.`);
  console.log(`Saved Raw Data: ${rawPath}`);
  console.log(`Saved Report MD: ${mdPath}`);
  console.log(`==================================================\n`);
}

if (require.main === module) {
  runAttendSalienceExperiment().catch(console.error);
}
