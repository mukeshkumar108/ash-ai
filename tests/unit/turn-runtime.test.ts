import { expect, test } from '@playwright/test';

import type { EpistemicPolicy } from '@/lib/agent/research-policy';
import {
  EmptyModelResponseError,
  executeDirectReply,
  isRetryableModelError,
} from '@/lib/agent/turn-executor';
import {
  createTurnPacket,
  decideTurn,
  needsPrivateReadTools,
  type TurnEvent,
} from '@/lib/agent/turn-runtime';
import type { ChatMessage } from '@/lib/types';

const event: TurnEvent = {
  userId: 'user-1',
  chatId: 'chat-1',
  currentUserText: 'Hey, what do you think?',
  selectedModelId: 'deepseek/deepseek-v4-flash',
  hasImageParts: false,
  ambient: { userLocation: 'Cambridge, England', timeZone: 'Europe/London' },
};

const policy: EpistemicPolicy = {
  researchDepth: 'none',
  freshnessNeed: 'none',
  authorityNeed: 'none',
  sourceSensitivity: 'low',
  stakes: 'low',
  questionMode: 'conversation',
  capabilityRoute: 'reply',
  reason: 'Ordinary conversation.',
  confidence: 0.9,
  classifierRan: true,
  classifierSucceeded: true,
  userDeclinedResearch: false,
};

test('ordinary conversation bypasses DeepAgents and tools', () => {
  const decision = decideTurn(
    { ...event, currentUserText: 'Hey Sophie, how are you?' },
    { ...policy, neutralResearchQuestion: null },
  );

  expect(decision).toMatchObject({
    lane: 'reply_only',
    modelRole: 'conversation',
    modelId: decision.modelId,
  });
});

test('framed judgment stays direct but uses the judgment model', () => {
  const decision = decideTurn(event, {
    ...policy,
    neutralResearchQuestion:
      'What role does social media play in political polarisation?',
  });

  expect(decision.lane).toBe('reply_only');
  expect(decision.modelRole).toBe('judgment');
  expect(decision.modelId).toBe('google/gemini-3.5-flash-lite');
  expect(decision.fallbackModelId).toBe(event.selectedModelId);
});

test('private Gmail and Calendar requests use the read-tools lane', () => {
  for (const text of [
    'Have I got any unread Gmail messages?',
    "What's on my calendar this week?",
  ]) {
    const decision = decideTurn(
      { ...event, currentUserText: text },
      { ...policy, capabilityRoute: 'read_tools' },
    );
    expect(decision.lane).toBe('read_tools');
  }

  expect(needsPrivateReadTools('Show me my inbox')).toBe(true);
  expect(needsPrivateReadTools('What time is it?')).toBe(false);
});

test('a successful semantic reply decision is not overridden by a keyword', () => {
  const decision = decideTurn(
    {
      ...event,
      currentUserText:
        'I finally cleared my inbox and now I am going for a walk.',
    },
    { ...policy, capabilityRoute: 'reply', interactionMode: 'social' },
  );

  expect(decision.lane).toBe('reply_only');
});

test('public research requirements take priority over private tools', () => {
  const decision = decideTurn(
    { ...event, currentUserText: 'Search for recent Gmail security news' },
    {
      ...policy,
      capabilityRoute: 'read_tools',
      researchDepth: 'light',
      freshnessNeed: 'required',
    },
  );

  expect(decision.lane).toBe('research');
  expect(decision.modelRole).toBe('research');
});

test('structured live data takes priority over generic public research', () => {
  const decision = decideTurn(
    { ...event, currentUserText: 'Will I need a jacket this evening?' },
    {
      ...policy,
      capabilityRoute: 'live_data',
      researchDepth: 'none',
      freshnessNeed: 'required',
      interactionMode: 'practical',
    },
  );

  expect(decision.lane).toBe('live_data');
  expect(decision.modelRole).toBe('live_data');
  expect(decision.modelId).toBe('google/gemini-3.5-flash-lite');
});

test('compound live-data and public-research intent preserves both capabilities', () => {
  const decision = decideTurn(
    {
      ...event,
      currentUserText:
        'What is the weather later, and which planets are visible tonight?',
    },
    {
      ...policy,
      capabilityRoute: 'live_data',
      researchDepth: 'light',
      freshnessNeed: 'required',
      interactionMode: 'practical',
      neutralResearchQuestion:
        'What is the local weather, and what is visible in the night sky?',
    },
  );

  expect(decision.lane).toBe('research');
  expect(decision.reason).toContain('structured live data and public research');
});

test('direct turn packet contains Sophie and time guidance but no tool claims', () => {
  const decision = decideTurn(event, policy);
  const messages: ChatMessage[] = [
    { id: 'message-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
  ];
  const packet = createTurnPacket({
    event,
    decision,
    messages,
    now: new Date('2026-08-06T22:57:00.000Z'),
    timeZone: 'Europe/London',
  });

  expect(packet.systemPrompt).toContain('[TRUSTED CURRENT TIME]');
  expect(packet.systemPrompt).toContain('Thursday, 6 August 2026');
  expect(packet.systemPrompt).toContain('[SOPHIE — CORE IDENTITY]');
  expect(packet.systemPrompt).toContain('[RELATIONAL CONTRACT]');
  expect(packet.systemPrompt).toContain('[HARD INVARIANTS]');
  expect(packet.systemPrompt).not.toContain('[GOOGLE INTEGRATION]');
  expect(packet.systemPrompt).not.toContain('[PUBLIC WEB RESEARCH]');
  expect(packet.systemPrompt).toContain(
    'saved default location is Cambridge, England',
  );
});

test('recent retrieval provenance remains compact and prevents invented memory claims', () => {
  const provenanceEvent: TurnEvent = {
    ...event,
    recentProvenance:
      'A recent assistant answer used weather; no recorded retrieval failures.',
  };
  const decision = decideTurn(provenanceEvent, policy);
  const prompt = createTurnPacket({
    event: provenanceEvent,
    decision,
    messages: [],
  }).systemPrompt;

  expect(prompt).toContain('[RECENT RETRIEVAL PROVENANCE]');
  expect(prompt).toContain('used weather');
  expect(prompt).toContain(
    'Do not claim a searched or tool-derived answer came from memory',
  );
});

test('turn packets expose only the instinct needed for this interaction', () => {
  const greetingDecision = decideTurn(
    { ...event, currentUserText: 'Hey my friend' },
    {
      ...policy,
      interactionMode: 'social',
      neutralResearchQuestion: null,
    },
  );
  const winDecision = decideTurn(
    { ...event, currentUserText: 'I finally shipped the project' },
    {
      ...policy,
      interactionMode: 'celebration',
      neutralResearchQuestion: null,
    },
  );
  const greeting = createTurnPacket({
    event,
    decision: greetingDecision,
    messages: [],
  }).systemPrompt;
  const win = createTurnPacket({
    event,
    decision: winDecision,
    messages: [],
  }).systemPrompt;

  expect(greeting).toContain('[CONVERSATIONAL FREEDOM]');
  expect(greeting).toContain('Do not become a coach');
  expect(greeting).not.toContain('React before analysing');
  expect(win).toContain('React before analysing');
  expect(win).not.toContain('[CONVERSATIONAL FREEDOM]');
  expect(winDecision.modelId).toBe('openai/gpt-5.6-luna-pro');
});

test('new chat after an hour supplies situational re-entry context', () => {
  const handshakeEvent: TurnEvent = {
    ...event,
    currentUserText: 'Hey',
    handshake: {
      chatsToday: 3,
      lastInteractionAt: new Date('2026-08-08T06:15:00.000Z'),
    },
  };
  const decision = decideTurn(handshakeEvent, {
    ...policy,
    interactionMode: 'social',
    neutralResearchQuestion: null,
  });
  const prompt = createTurnPacket({
    event: handshakeEvent,
    decision,
    messages: [],
    now: new Date('2026-08-08T08:00:00.000Z'),
    timeZone: 'Europe/London',
  }).systemPrompt;

  expect(prompt).toContain('[NEW-CHAT HANDSHAKE CONTEXT]');
  expect(prompt).toContain('saved default location is Cambridge, England');
  expect(prompt).toContain('returning after at least an hour away');
  expect(prompt).toContain('permission to notice the shape of the moment');
  expect(prompt).not.toContain('chat number 3');
  expect(prompt).not.toContain('07:15:00');
  expect(prompt).not.toContain('105 minutes');
  expect(prompt).not.toContain('often use none');
});

test('first chat today supplies time-aware presence without a greeting template', () => {
  const handshakeEvent: TurnEvent = {
    ...event,
    currentUserText: 'Hey',
    handshake: {
      chatsToday: 1,
      lastInteractionAt: new Date('2026-08-07T20:00:00.000Z'),
    },
  };
  const decision = decideTurn(handshakeEvent, {
    ...policy,
    interactionMode: 'social',
    neutralResearchQuestion: null,
  });
  const prompt = createTurnPacket({
    event: handshakeEvent,
    decision,
    messages: [],
    now: new Date('2026-08-08T08:00:00.000Z'),
    timeZone: 'Europe/London',
  }).systemPrompt;

  expect(prompt).toContain('first chat today');
  expect(prompt).toContain('It is morning');
  expect(prompt).toContain('one subtle observation');
  expect(prompt).toContain('Prefer implication over exposition');
});

test('quick same-day new chat keeps conversational continuity', () => {
  const handshakeEvent: TurnEvent = {
    ...event,
    currentUserText: 'One more thing',
    handshake: {
      chatsToday: 4,
      lastInteractionAt: new Date('2026-08-08T07:50:00.000Z'),
    },
  };
  const decision = decideTurn(handshakeEvent, {
    ...policy,
    interactionMode: 'social',
    neutralResearchQuestion: null,
  });
  const prompt = createTurnPacket({
    event: handshakeEvent,
    decision,
    messages: [],
    now: new Date('2026-08-08T08:00:00.000Z'),
    timeZone: 'Europe/London',
  }).systemPrompt;

  expect(prompt).toContain('already chatted recently today');
  expect(prompt).toContain('easy continuity');
  expect(prompt).toContain('not an obligation to perform a greeting');
});

test('serialized database timestamps cannot break handshake rendering', () => {
  const handshakeEvent = {
    ...event,
    currentUserText: 'Hey',
    handshake: {
      chatsToday: 2,
      lastInteractionAt: '2026-08-08T06:15:00.000Z' as unknown as Date,
    },
  };
  const decision = decideTurn(handshakeEvent, {
    ...policy,
    interactionMode: 'social',
    neutralResearchQuestion: null,
  });

  expect(() =>
    createTurnPacket({
      event: handshakeEvent,
      decision,
      messages: [],
      now: new Date('2026-08-08T08:00:00.000Z'),
      timeZone: 'Europe/London',
    }),
  ).not.toThrow();
});

test('image input falls back from a text-only model', () => {
  const decision = decideTurn(
    {
      ...event,
      selectedModelId: 'deepseek/deepseek-v4-flash',
      hasImageParts: true,
    },
    { ...policy, neutralResearchQuestion: null },
  );

  expect(decision.modelId).toBe('chat-model');
  expect(decision.modelRole).toBe('conversation');
});

test('direct judgment reply falls back once on a retryable provider failure', async () => {
  const decision = decideTurn(event, {
    ...policy,
    neutralResearchQuestion: 'What is the strongest view of this issue?',
  });
  const packet = createTurnPacket({ event, decision, messages: [] });
  const calls: string[] = [];
  const result = await executeDirectReply({
    packet,
    signal: new AbortController().signal,
    generate: async (modelId) => {
      calls.push(modelId);
      if (calls.length === 1) {
        throw Object.assign(new Error('Provider unavailable'), {
          name: 'AI_APICallError',
          statusCode: 503,
        });
      }
      return { text: 'My considered answer.', finishReason: 'stop' };
    },
  });

  expect(calls).toEqual([
    'google/gemini-3.5-flash-lite',
    event.selectedModelId,
  ]);
  expect(result).toMatchObject({
    text: 'My considered answer.',
    usedFallback: true,
    modelId: event.selectedModelId,
  });
});

test('cancellation is never treated as a retryable provider failure', async () => {
  expect(isRetryableModelError({ name: 'AbortError' })).toBe(false);

  const controller = new AbortController();
  controller.abort();
  const decision = decideTurn(event, policy);
  const packet = createTurnPacket({ event, decision, messages: [] });
  let calls = 0;

  await expect(
    executeDirectReply({
      packet,
      signal: controller.signal,
      generate: async () => {
        calls += 1;
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    }),
  ).rejects.toThrow('aborted');
  expect(calls).toBe(1);
});

test('empty successful output falls back instead of becoming a fake answer', async () => {
  const decision = decideTurn(
    { ...event, currentUserText: 'Hey my friend' },
    { ...policy, neutralResearchQuestion: null },
  );
  const packet = createTurnPacket({ event, decision, messages: [] });
  const calls: string[] = [];
  const result = await executeDirectReply({
    packet,
    signal: new AbortController().signal,
    generate: async (modelId) => {
      calls.push(modelId);
      return modelId === event.selectedModelId
        ? { text: '   ', finishReason: 'stop' }
        : { text: 'Hey, I am here.', finishReason: 'stop' };
    },
  });

  expect(calls).toEqual([event.selectedModelId, 'chat-model']);
  expect(result).toMatchObject({
    text: 'Hey, I am here.',
    modelId: 'chat-model',
    usedFallback: true,
  });
});

test('all-empty model attempts fail explicitly', async () => {
  const decision = decideTurn(event, {
    ...policy,
    neutralResearchQuestion: null,
  });
  const packet = createTurnPacket({ event, decision, messages: [] });

  await expect(
    executeDirectReply({
      packet,
      signal: new AbortController().signal,
      generate: async () => ({ text: '', finishReason: 'stop' }),
    }),
  ).rejects.toBeInstanceOf(EmptyModelResponseError);
});

test('AI SDK getter-backed result fields survive executor normalization', async () => {
  const decision = decideTurn(event, {
    ...policy,
    neutralResearchQuestion: null,
  });
  const packet = createTurnPacket({ event, decision, messages: [] });
  const sdkLikeResult = {} as { text: string; finishReason: string };
  Object.defineProperties(sdkLikeResult, {
    text: { enumerable: false, get: () => 'I am here, my friend.' },
    finishReason: { enumerable: false, get: () => 'stop' },
  });

  const result = await executeDirectReply({
    packet,
    signal: new AbortController().signal,
    generate: async () => sdkLikeResult,
  });

  expect(result).toEqual({
    text: 'I am here, my friend.',
    finishReason: 'stop',
    modelId: decision.modelId,
    usedFallback: false,
  });
});
