import { expect, test } from '@playwright/test';

import {
  calculateDevTopUp,
  calculateGemCost,
  GEM_BUNDLES,
  GEM_POLICY,
  getGemBundle,
} from '@/lib/gems/catalog';

test.describe('gem policy', () => {
  test('uses the intended grants and bundles', () => {
    expect(GEM_POLICY.initialGrant).toBe(20);
    expect(GEM_POLICY.dailyGrant * GEM_POLICY.dailyGrantDays).toBe(25);
    expect(
      GEM_BUNDLES.map(({ gems, amountCents }) => [gems, amountCents]),
    ).toEqual([
      [50, 500],
      [100, 1000],
      [200, 2000],
    ]);
  });
  test('prices a multi-output generation', () => {
    expect(calculateGemCost(2, 4)).toBe(8);
    expect(() => calculateGemCost(0, 1)).toThrow();
  });
  test('tops up developer wallets only below the floor', () => {
    expect(calculateDevTopUp(499)).toBe(501);
    expect(calculateDevTopUp(500)).toBe(0);
    expect(getGemBundle('gems_50')?.gems).toBe(50);
  });
});
