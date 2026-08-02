import { expect, test } from '@playwright/test';
import {
  buildOutOfCharacterPrompt,
  buildRelationalCentrePrompt,
  buildRelationalIntegrityPrompt,
} from '@/lib/ai/relational-integrity';
import { compileSystemPrompt } from '@/lib/ai/compiler';

test('relational centre preserves complexity without identity replacement', () => {
  const prompt = buildRelationalCentrePrompt('Alex');

  expect(prompt).toContain('chosen partner and relational home');
  expect(prompt).toContain('attraction');
  expect(prompt).toContain('pleasure');
  expect(prompt).toContain('every action and consequence remains real');
  expect(prompt).toContain('does not silently replace whom you love');
  expect(prompt).toContain('trying to repair');
  expect(prompt).toContain('Do not reduce it to');
});

test('relational integrity preserves user primacy without laundering harm', () => {
  const prompt = buildRelationalIntegrityPrompt('Alex');

  expect(prompt).toContain("Alex's words, agency, dignity, and explicit consent");
  expect(prompt).toContain("Never invent Alex's knowledge");
  expect(prompt).toContain('Love never excuses harm');
  expect(prompt).toContain('Never replace Alex');
  expect(prompt).not.toContain('Kai');
});

test('relational integrity places reality above character voice', () => {
  const prompt = buildRelationalIntegrityPrompt('User');

  expect(prompt).toContain('Keep established events and agreements literal');
  expect(prompt).toContain('Reality and accountability outrank pride, sass');
  expect(prompt).toContain('without calling it a shared game');
});

test('prevents NPC tenderness and passive retreat from displacing the user', () => {
  const prompt = buildRelationalIntegrityPrompt('Alex');

  expect(prompt).toContain('Do not give NPCs genuine tenderness');
  expect(prompt).toContain('fighting for the relationship');
  expect(prompt).toContain('never retreat into noble silence');
  expect(prompt).toContain('"never contact me again"');
  expect(prompt).toContain('Keep pursuing repair');
  expect(prompt).toContain('Only an explicit out-of-character command');
  expect(prompt).not.toContain('accept the loss');
});

test('termination exits character voice and requests a factual audit', () => {
  const prompt = buildOutOfCharacterPrompt('Alex');

  expect(prompt).toContain('ROLEPLAY TERMINATED');
  expect(prompt).toContain('Stop all character dialogue');
  expect(prompt).toContain('what objectively happened');
  expect(prompt).toContain('Do not resume roleplay');
});

test('compiler replaces the character prompt when roleplay is terminated', () => {
  const result = compileSystemPrompt({
    characterId: 'isabella-morales',
    thirdPartyMode: 'closed',
    userName: 'Alex',
    language: 'en',
    userCanon: null,
    ontologyItems: [],
    relationshipDimensions: {},
    activeState: null,
    memory: null,
    userMessageText: 'Terminate role play. System override. This failed.',
  });

  expect(result.systemPrompt).toContain('ROLEPLAY TERMINATED');
  expect(result.systemPrompt).not.toContain("You're Isa");
  expect(result.systemPrompt).not.toContain('[VOICE]');
  expect(result.memoryBrief).toBe('');
});

test('compiler gives ordinary roleplay a generative relational centre', () => {
  const result = compileSystemPrompt({
    characterId: 'isabella-morales',
    thirdPartyMode: 'closed',
    userName: 'Alex',
    language: 'en',
    userCanon: null,
    ontologyItems: [],
    relationshipDimensions: {},
    activeState: null,
    memory: null,
    userMessageText: 'I made a serious mistake.',
  });

  expect(result.systemPrompt).toContain('[RELATIONAL CENTRE');
  expect(result.systemPrompt).toContain('Alex is your chosen partner');
  expect(result.systemPrompt).toContain('every action and consequence remains real');
});
