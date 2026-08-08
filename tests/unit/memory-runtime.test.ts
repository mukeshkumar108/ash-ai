import { expect, test } from '@playwright/test';

import {
  buildMemoryPacket,
  compileMemoryNeed,
  prepareTurnMemory,
} from '@/lib/agent/memory';
import { buildSophieReplySystemPrompt } from '@/lib/agent/system-prompt';

test.describe('targeted Honcho memory runtime', () => {
  test('uses a contextualized compiler question for an ambiguous follow-up', async () => {
    const decision = await compileMemoryNeed({
      currentUserTurn: 'What am I doing instead now?',
      recentConversation:
        'user: Why did I stop cycling again?\nassistant: You stopped when the evenings got darker.',
      signal: AbortSignal.timeout(1_000),
      generate: async () => ({
        needsMemory: true,
        memoryQuestion:
          "What exercise routine replaced the user's previous evening cycling routine?",
        reason: 'The follow-up refers to an older exercise change.',
        confidence: 0.94,
      }),
    });

    expect(decision.needsMemory).toBe(true);
    expect(decision.memoryQuestion).toContain('exercise routine');
    expect(decision.memoryQuestion).not.toContain('instead now');
  });

  test('does not retrieve for a self-contained general question', async () => {
    const previousURL = process.env.HONCHO_URL;
    process.env.HONCHO_URL = 'http://honcho.test';
    let retrievals = 0;
    try {
      const memory = await prepareTurnMemory({
        userId: 'user-1',
        chatId: 'chat-1',
        currentUserTurn: 'Do you think people are naturally selfish?',
        recentConversation: '',
        compile: async () => ({
          needsMemory: false,
          memoryQuestion: null,
          reason: 'General opinion does not need personal history.',
          confidence: 0.98,
        }),
        retrieve: async () => {
          retrievals++;
          return { mode: 'targeted_conclusions', result: 'should not happen' };
        },
      });
      expect(retrievals).toBe(0);
      expect(memory.packet).toBeNull();
    } finally {
      process.env.HONCHO_URL = previousURL;
    }
  });

  test('fails open when Honcho retrieval is unavailable', async () => {
    const previousURL = process.env.HONCHO_URL;
    process.env.HONCHO_URL = 'http://honcho.test';
    try {
      const memory = await prepareTurnMemory({
        userId: 'user-1',
        chatId: 'chat-1',
        currentUserTurn: 'What was I building?',
        recentConversation: '',
        compile: async () => ({
          needsMemory: true,
          memoryQuestion: 'What project was the user previously building?',
          reason: 'Direct recall request.',
          confidence: 0.99,
        }),
        retrieve: async () => {
          throw new Error('offline');
        },
      });
      expect(memory.failed).toBe(true);
      expect(memory.packet).toBeNull();
    } finally {
      process.env.HONCHO_URL = previousURL;
    }
  });

  test('marks memory as fallible and gives the current conversation precedence', () => {
    const packet = buildMemoryPacket(
      'The user stopped cycling and started walking.',
    );
    const prompt = buildSophieReplySystemPrompt({ memoryPacket: packet });
    expect(prompt).toContain('fallible remembered context');
    expect(prompt).toContain('current explicit statements');
    expect(prompt).toContain('take precedence');
    expect(prompt).not.toContain('entire peer representation');
  });
});
