import { expect, test } from '@playwright/test';

import {
  ACTIVE_FINAL_CLOSE_PHRASES,
  ACTIVE_FOLLOWUP_PHRASES,
  finalPhraseForLocalHour,
  pickPhrase,
  rotationIndexForUser,
} from '@/lib/ai/relationship/followup-phrases';
import {
  advanceWindow,
  armWindowState,
  computeWindowDue,
  cancelState,
  FIRST_FOLLOWUP_MAX_MS,
  FIRST_FOLLOWUP_MIN_MS,
  FINAL_FOLLOWUP_MAX_MS,
  FINAL_FOLLOWUP_MIN_MS,
  isConversationOpeningMessage,
  markFinalSent,
  markFirstSent,
  randomBetweenMs,
  type FollowupStageState,
  type FollowupRandom,
} from '@/lib/ai/relationship/followup-core';
import { NIGHT_FINAL_CLOSE_PHRASES } from '@/lib/ai/relationship/followup-phrases';

const zeroRandom: FollowupRandom = () => 0;
const halfRandom: FollowupRandom = () => 0.5;

function stageFor(
  overrides: Partial<FollowupStageState> = {},
): FollowupStageState {
  const base = armWindowState(
    {
      windowId: 'window-1',
      userId: 'user-1',
      chatId: 'chat-1',
      anchorMessageId: 'anchor-1',
      anchorCreatedAt: Date.parse('2026-09-02T10:00:00Z'),
    },
    zeroRandom,
  );
  return { ...base, ...overrides };
}

test.describe('active follow-up phrases', () => {
  test('banks contain five deterministic variants per stage', () => {
    expect(ACTIVE_FOLLOWUP_PHRASES).toHaveLength(5);
    expect(ACTIVE_FINAL_CLOSE_PHRASES).toHaveLength(5);
    expect(NIGHT_FINAL_CLOSE_PHRASES.length).toBeGreaterThan(0);
  });

  test('phrase selection is deterministic from a seed', () => {
    expect(pickPhrase('first', 2)).toBe(ACTIVE_FOLLOWUP_PHRASES[2]);
    expect(pickPhrase('first', 2)).toBe(pickPhrase('first', 2));
    expect(pickPhrase('final', 999)).toBe(ACTIVE_FINAL_CLOSE_PHRASES[999 % 5]);
  });

  test('rotation avoids immediate repeats', () => {
    const r1 = rotationIndexForUser('user-a', '2026-09-02', 0);
    const r2 = rotationIndexForUser('user-a', '2026-09-02', 1);
    const r3 = rotationIndexForUser('user-a', '2026-09-02', 2);
    expect(new Set([r1, r2, r3]).size).toBe(3);
    expect(ACTIVE_FOLLOWUP_PHRASES[r1 % 5]).not.toBe(
      ACTIVE_FOLLOWUP_PHRASES[r2 % 5],
    );
  });

  test('late-night hour selects the goodnight-final bank', () => {
    const nightPhrase = finalPhraseForLocalHour(2, 0);
    const dayPhrase = finalPhraseForLocalHour(15, 0);
    expect(NIGHT_FINAL_CLOSE_PHRASES).toContain(nightPhrase);
    expect(dayPhrase).toMatch(/later|distracted|vanished|busy|leave/i);
  });
});

test.describe('active follow-up core state machine', () => {
  test('window timing falls in the configured randomized ranges', () => {
    const anchor = Date.parse('2026-09-02T10:00:00Z');
    const due = computeWindowDue(anchor, halfRandom);
    expect(due.followupDueAt).toBeGreaterThanOrEqual(
      anchor + FIRST_FOLLOWUP_MIN_MS,
    );
    expect(due.followupDueAt).toBeLessThanOrEqual(
      anchor + FIRST_FOLLOWUP_MAX_MS,
    );
    const finalSpan = due.finalDueAt - due.followupDueAt;
    expect(finalSpan).toBeGreaterThanOrEqual(FINAL_FOLLOWUP_MIN_MS);
    expect(finalSpan).toBeLessThanOrEqual(FINAL_FOLLOWUP_MAX_MS);
    expect(randomBetweenMs(0, 1000, zeroRandom)).toBe(0);
  });

  test('eligible Sophie message opens a finite window; stale text never opens', () => {
    expect(isConversationOpeningMessage('did I lose you?')).toBe(true);
    expect(isConversationOpeningMessage('waiting for you...')).toBe(true);
    expect(isConversationOpeningMessage('okay done.')).toBe(false);
    expect(isConversationOpeningMessage('')).toBe(false);
  });

  test('repeated ticks before first due time do nothing', () => {
    const state = stageFor();
    for (let i = 0; i < 1000; i += 1) {
      const action = advanceWindow(state, state.followupDueAt - 1);
      expect(action.kind).toBe('none');
    }
  });

  test('at first due time the reducer emits exactly one first send', () => {
    let state = stageFor();
    const first = advanceWindow(state, state.followupDueAt);
    expect(first.kind).toBe('send_first');
    state = markFirstSent(state, state.followupDueAt);
    // No second send after marking.
    expect(advanceWindow(state, state.followupDueAt).kind).toBe('none');
  });

  test('no reply allows exactly one final-close phrase, then silence forever', () => {
    let state = stageFor();
    state = markFirstSent(state, state.followupDueAt);
    // Before final due: nothing.
    expect(advanceWindow(state, state.finalDueAt - 1).kind).toBe('none');
    // At final due: exactly one final send.
    expect(advanceWindow(state, state.finalDueAt).kind).toBe('send_final');
    state = markFinalSent(state, state.finalDueAt);
    // 1000 subsequent ticks do nothing.
    for (let i = 0; i < 1000; i += 1) {
      expect(advanceWindow(state, state.finalDueAt + i).kind).toBe('none');
    }
  });

  test('user reply cancels subsequent follow-up', () => {
    let state = stageFor();
    state = cancelState(state, state.followupDueAt - 10_000);
    expect(advanceWindow(state, state.followupDueAt).kind).toBe('none');
    expect(state.closedAt).not.toBeNull();
  });
});

test.describe('active follow-up zero-model guarantee', () => {
  test('new lifecycle modules import no provider or cortex modules', async () => {
    const { readFile } = await import('node:fs/promises');
    const files = [
      'lib/ai/relationship/followup.ts',
      'lib/ai/relationship/followup-core.ts',
      'lib/ai/relationship/followup-phrases.ts',
      'lib/ai/relationship/followup-store.ts',
    ];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source).not.toMatch(
        /executeCompanionRuntime|proactive|openrouter|OpenRouter|generateObject|getLanguageModel/i,
      );
      expect(source).not.toMatch(/force_agenda/);
    }
  });

  test('the cron path routes active_idle to the deterministic sweep, not the model loop', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('lib/ai/relationship/outreach.ts', 'utf8');
    // active_idle candidates are explicitly skipped before the runtime call.
    expect(source).toMatch(/candidate\.trigger === 'active_idle'/);
    expect(source).toMatch(/sweepActiveConversationFollowups/);
    // server_scan generic eligible CTE is gone from the candidate query.
    const storeSource = await readFile('lib/ai/relationship/store.ts', 'utf8');
    expect(storeSource).not.toMatch(/latest_per_chat AS/);
    expect(storeSource).not.toMatch(/FROM eligible/);
  });
});

test.describe('active follow-up phrase/seed determinism', () => {
  test('the same persisted seed always yields the same message', () => {
    const seed = rotationIndexForUser('user-x', '2026-09-02', 3);
    const a = pickPhrase('first', seed);
    const b = pickPhrase('first', seed);
    expect(a).toBe(b);
    expect(ACTIVE_FOLLOWUP_PHRASES).toContain(a);
  });
});
