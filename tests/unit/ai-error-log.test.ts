import { expect, test } from '@playwright/test';
import { compactAIError } from '@/lib/ai/error-log';

test('compacts malformed model output without printing generated text', () => {
  const cause = new SyntaxError(
    "Expected ',' or '}' after property value in JSON at position 7360",
  );
  const error = Object.assign(
    new Error(`No object generated: ${'  \n'.repeat(5000)}`),
    { cause },
  );

  const compact = compactAIError(error);

  expect(compact).toBe(
    "SyntaxError: Expected ',' or '}' after property value in JSON at position 7360",
  );
  expect(compact).not.toContain('\\n');
  expect(compact.length).toBeLessThan(280);
});

test('collapses whitespace and caps errors without a structured cause', () => {
  const compact = compactAIError(new Error(`failure ${' \n '.repeat(1000)}`));

  expect(compact).toBe('Error: failure');
  expect(compact.length).toBeLessThanOrEqual(280);
});
