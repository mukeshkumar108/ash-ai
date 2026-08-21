import { expect, test } from '@playwright/test';
import { initiativeEvaluatorModelId } from '@/lib/ai/relationship/evaluator';
import { initiativeComposerModelId } from '@/lib/ai/relationship/composer';

test('initiative evaluation is independent from foreground speaker routing', () => {
  expect(initiativeEvaluatorModelId()).toBe('google/gemini-3.7-flash');
  expect(initiativeComposerModelId({ highConsequence: false })).toBe(
    'nex-agi/nex-n2-mini',
  );
  expect(initiativeComposerModelId({ highConsequence: true })).toBe(
    'anthropic/claude-sonnet-5',
  );
});
