export const GEM_POLICY = {
  initialGrant: 20,
  dailyGrant: 5,
  dailyGrantDays: 5,
  devFloor: 500,
  devTarget: 1000,
} as const;

export const GEM_BUNDLES = [
  { id: 'gems_50', gems: 50, amountCents: 500, currency: 'usd' },
  { id: 'gems_100', gems: 100, amountCents: 1000, currency: 'usd' },
  { id: 'gems_200', gems: 200, amountCents: 2000, currency: 'usd' },
] as const;

export type GemBundleId = (typeof GEM_BUNDLES)[number]['id'];

export function getGemBundle(id: string) {
  return GEM_BUNDLES.find((bundle) => bundle.id === id);
}

export function calculateGemCost(unitCost: number, quantity = 1) {
  if (!Number.isInteger(unitCost) || unitCost < 1) {
    throw new Error('Gem unit cost must be a positive integer');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Gem quantity must be a positive integer');
  }
  return unitCost * quantity;
}

export function calculateDevTopUp(balance: number) {
  return balance < GEM_POLICY.devFloor ? GEM_POLICY.devTarget - balance : 0;
}
