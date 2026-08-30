import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import {
  buildSophieReplySystemPrompt,
  buildSophieTurnModule,
} from '@/lib/agent/system-prompt';
import {
  sophieConversationalFreedom,
  sophieCoreIdentity,
  sophieHardInvariants,
  sophieStandards,
  sophieVoicePalette,
} from '@/lib/ai/prompts';
import type { ReentryContext } from '@/lib/agent/reentry';
import type { CompanionEntryContext } from '@/lib/agent/entry-context';

const reentry: ReentryContext = {
  class: 'HARD_REENTRY',
  turnIndex: 1,
  gapMinutes: 600,
  crossedLocalDay: true,
  routeReason: 'first contact UserDay',
  selectedForegroundModel: 'test',
  manualOverride: false,
  richerSteerActive: true,
  staleLightweightPhase: true,
} as never;

const entryContext: CompanionEntryContext = {
  version: 3,
  timeZone: 'Europe/London',
  chronology: {
    temporalSession: 'new',
    userDay: '2026-08-23',
    daypart: 'morning',
    firstContactUserDay: true,
    gapMinutes: 600,
    sessionStartedAt: '2026-08-23T07:00:00.000Z',
    sessionsToday: 1,
  },
  entryStyle: {
    band: 'new_day', opening: 'morning_welcome', energy: 'high',
    acknowledgeReturn: true,
  },
  previousSessionSummary: null,
  recentSessionSummaries: [],
  bridgeCandidates: [],
  thread: null,
};

const ambient = {
  userLocation: 'Cambridge, England',
  timeZone: 'Europe/London',
};

test('old large static personality is no longer compiled', () => {
  const prompt = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  expect(prompt).not.toContain('sovereign, high-status partner');
  expect(prompt).not.toContain('Christian/LDS-shaped view');
  expect(prompt).not.toContain('[THIS TURN]');
  expect(prompt).not.toContain('[CONTEXT PRECEDENCE]');
});

test('late-night re-entry is concise and care-first rather than generically bright', () => {
  const prompt = buildSophieReplySystemPrompt({
    interactionMode: 'social',
    now: new Date('2026-08-28T02:30:00.000Z'),
    timeZone: 'Europe/London',
    entryContext: {
      ...entryContext,
      chronology: {
        ...entryContext.chronology,
        daypart: 'night',
        sessionStartedAt: '2026-08-28T02:30:00.000Z',
      },
      entryStyle: {
        band: 'extended_return',
        opening: 'relationship_welcome',
        energy: 'high',
        acknowledgeReturn: true,
      },
    },
  });
  expect(prompt).toContain('do not perform a bright generic welcome');
  expect(prompt).toContain('one or two spoken-feeling sentences');
  expect(prompt).toContain('explicit user correction');
});

test('core identity and hard invariants are always present', () => {
  const prompts = [
    buildSophieReplySystemPrompt({ interactionMode: 'social' }),
    buildSophieReplySystemPrompt({ interactionMode: 'practical' }),
    buildSophieReplySystemPrompt({ interactionMode: 'safety' }),
    buildSophieReplySystemPrompt({ interactionMode: 'emotional' }),
  ];
  for (const prompt of prompts) {
    expect(prompt).toContain(sophieCoreIdentity().trim().slice(0, 40));
    expect(prompt).toContain('[HARD INVARIANTS]');
    expect(prompt).not.toContain('[RELATIONAL CONTRACT]');
  }
});

test('conversational freedom appears on ordinary social generation', () => {
  const social = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  expect(social).toContain('[CONVERSATIONAL FREEDOM]');
  expect(social).toContain('participant in the conversation');
  expect(social).toContain('Questions are one conversational move');
});

test('plain kernel retains independence without the old floral cadence', () => {
  const kernel = sophieCoreIdentity();
  expect(kernel).toContain("trusted second mind");
  expect(kernel).toContain("Do not prove you understood by paraphrasing");
  expect(kernel).toContain('Memory is useful evidence, not truth');
  expect(kernel).not.toContain('literature scholar');
  expect(kernel).not.toContain('sacred worth');
  expect(kernel).not.toContain('Warmth over cleverness');
});

test('voice palette is conversational and standards remain judgment-gated', () => {
  const social = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  const emotional = buildSophieReplySystemPrompt({ interactionMode: 'emotional' });
  const practical = buildSophieReplySystemPrompt({ interactionMode: 'practical' });
  const judgment = buildSophieReplySystemPrompt({ interactionMode: 'judgment' });
  const safety = buildSophieReplySystemPrompt({ interactionMode: 'safety' });

  expect(social).toContain(sophieVoicePalette());
  expect(emotional).toContain(sophieVoicePalette());
  expect(practical).not.toContain('[VOICE PALETTE — OPTIONAL]');
  expect(practical).not.toContain('[STANDARDS — FRIEND, NOT COACH]');
  expect(judgment).toContain(sophieStandards());
  expect(safety).toContain(sophieStandards());
  expect(social).not.toContain('[STANDARDS — FRIEND, NOT COACH]');
});

test('task and safety governance remain intact', () => {
  const task = buildSophieReplySystemPrompt({ interactionMode: 'practical' });
  expect(task).toContain('Be directly useful');
  expect(task).toContain('[TURN-SPECIFIC INSTINCT]');
  expect(task).not.toContain('[CONVERSATIONAL FREEDOM]');

  const safety = buildSophieReplySystemPrompt({ interactionMode: 'safety' });
  expect(safety).toContain('refuse dangerous or abusive instructions');

  const emotional = buildSophieReplySystemPrompt({
    interactionMode: 'emotional',
  });
  expect(emotional).toContain('Be present before becoming strategic');
});

test('ordinary social turns do not receive director-authored act/posture commands', () => {
  const socialReentry = buildSophieReplySystemPrompt({
    interactionMode: 'social',
    reentry,
    entryContext,
    ambient,
  });
  expect(socialReentry).not.toContain('Next conversational act');
  expect(socialReentry).not.toContain('Use the posture to choose');
  expect(socialReentry).not.toContain('posture=HOLD');
  expect(socialReentry).not.toContain('ACT=ASK');
  expect(socialReentry).not.toContain(
    'You MUST follow this exact sequence',
  );
});

test('non-social turns may keep re-entry posture guidance', () => {
  const governedReentry = buildSophieReplySystemPrompt({
    interactionMode: 'practical',
    reentry,
    entryContext,
    ambient,
  });
  expect(governedReentry).toContain('[BEHAVIORAL ENTRY POSTURE]');
  expect(governedReentry).toContain('do not open by paraphrasing or resuming it');
});

test('re-entry modules are not sticky after the relevant turn', () => {
  const plain = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  expect(plain).not.toContain('[RE-ENTRY ORIENTATION]');
  expect(plain).not.toContain('[NEW-CHAT HANDSHAKE CONTEXT]');
  expect(plain).not.toContain('[BEHAVIORAL ENTRY POSTURE]');
  expect(plain).not.toContain('[AUTHORITATIVE ENTRY CONTEXT]');
});

test('irrelevant modules are omitted where no evidence exists', () => {
  const plain = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  expect(plain).not.toContain('[RECENT RETRIEVAL PROVENANCE]');
  expect(plain).not.toContain('[AUDIO INPUT SOURCE]');
  expect(plain).not.toContain('[CORTEX CONTINUITY]');
  expect(plain).not.toContain('[RELEVANT REMEMBERED CONTEXT]');
});

test('conversational act remains telemetry, never a command on social', () => {
  const prompt = buildSophieReplySystemPrompt({
    interactionMode: 'social',
    conversationAct: 'ASK',
    actHistory: ['ask', 'react'],
  });
  expect(prompt).toContain('telemetry, not a command');
  expect(prompt).not.toContain('Next conversational act');
});

test('temporal-expression seam is accepted but absent unless populated', () => {
  const empty = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  expect(empty).not.toContain('[TEMPORAL EXPRESSION]');
  const populated = buildSophieReplySystemPrompt({
    interactionMode: 'social',
    temporalExpression:
      'The user is arriving just after waking. Warm, unhurried, present.',
  });
  expect(populated).toContain('[TEMPORAL EXPRESSION]');
  expect(populated).toContain('just after waking');
});

test('no dormant roleplay compiler is reintroduced into the live prompt path', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'lib', 'agent', 'system-prompt.ts'),
    'utf8',
  );
  expect(source).not.toContain('lib/ai/compiler');
  expect(source).not.toContain('lib/ai/character-prompts');
  const prompt = buildSophieReplySystemPrompt({ interactionMode: 'social' });
  expect(prompt).not.toContain('[VOICE]');
  expect(prompt).not.toContain('ROLEPLAY TERMINATED');
  expect(prompt).not.toContain('[RELATIONAL CENTRE');
});

test('turn modules no longer prescribe director acts on social turns', () => {
  const socialModule = buildSophieTurnModule('social');
  expect(socialModule).not.toContain('ASK and active contribution are normal');
  expect(socialModule).not.toContain('must not end in a bare acknowledgement');
  expect(socialModule).not.toContain('HOLD can still be warm');
  expect(socialModule).not.toContain('NUDGE only when');
  expect(socialModule).toContain(
    'Treat a social bid as connection unless the conversation gives real reason to read weight into it',
  );
  expect(socialModule).toContain(
    'Do not redirect a social bid into sleep, wellness, productivity, or behavioural advice',
  );
});

test('invariant blocks preserve precedence without tactical instructions', () => {
  expect(sophieHardInvariants()).toContain('outrank older memory');
  expect(sophieHardInvariants()).toContain(
    'Safety/high-consequence handling outranks ordinary contextual inference',
  );
  expect(sophieHardInvariants()).toContain(
    'An explicit correction replaces an older assumption',
  );
  expect(sophieHardInvariants()).toContain(
    "Do not adopt the user's framing merely to please them",
  );
  expect(sophieHardInvariants()).not.toContain('change the act');
  expect(sophieHardInvariants()).not.toContain('narrower version');
  expect(sophieConversationalFreedom()).toContain(
    'Do not manufacture tangents',
  );
});
