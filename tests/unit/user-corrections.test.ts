import { expect, test } from '@playwright/test';
import { extractBehaviorCorrection, mergeBehaviorCorrections } from '@/lib/agent/user-corrections';

test('captures only direct future-facing Sophie behavior corrections', () => {
  expect(extractBehaviorCorrection({ text: "Don't ask me if I am still walking after hours have passed", sourceTurnId: 'a' })?.instruction)
    .toBe("Don't ask me if I am still walking after hours have passed");
  expect(extractBehaviorCorrection({ text: 'Stop patronising me when I am venting', sourceTurnId: 'b' })).not.toBeNull();
  expect(extractBehaviorCorrection({ text: "Mum said don't ask me about the wedding", sourceTurnId: 'c' })).toBeNull();
  expect(extractBehaviorCorrection({ text: 'No, I am home now', sourceTurnId: 'd' })).toBeNull();
});

test('deduplicates and bounds operational corrections', () => {
  const corrections = Array.from({ length: 10 }, (_, index) => ({
    id: String(index), instruction: `Never call me ${index}`, createdAt: new Date(index).toISOString(), sourceTurnId: String(index),
  }));
  const result = mergeBehaviorCorrections(corrections, {
    id: '9', instruction: 'Never call me nine', createdAt: new Date().toISOString(), sourceTurnId: 'new',
  });
  expect(result).toHaveLength(8);
  expect(result.at(-1)?.instruction).toBe('Never call me nine');
});
