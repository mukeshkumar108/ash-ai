import { expect, test } from '@playwright/test';

import {
  calculateVideoGemCost,
  getVideoModelById,
} from '@/lib/ai/video-models';

function requireModel(id: string) {
  const model = getVideoModelById(id);
  expect(model).toBeTruthy();
  if (!model) throw new Error(`missing video model ${id}`);
  return model;
}

const pvideo = () => requireModel('prunaai/p-video');
const grok = () => requireModel('xai/grok-imagine-video');

test.describe('video model pricing', () => {
  test('P-Video defaults and durations', () => {
    const model = pvideo();
    expect(model.capabilities.durations.default).toBe(5);
    expect(model.capabilities.durations.max).toBe(10);
    expect(model.capabilities.draft).toBe(true);
    expect(model.capabilities.resolutions).toContain('720p');
  });

  test('P-Video 720p costs match spec (5s = 5, draft 5s = 2)', () => {
    const model = pvideo();
    expect(calculateVideoGemCost(model, 5, '720p', false)).toBe(5);
    expect(calculateVideoGemCost(model, 5, '720p', true)).toBe(2);
  });

  test('P-Video costs scale by duration and round up', () => {
    const model = pvideo();
    // 1 credit/sec full, 0.4/sec draft
    expect(calculateVideoGemCost(model, 10, '720p', false)).toBe(10);
    expect(calculateVideoGemCost(model, 10, '720p', true)).toBe(4);
    // 3s draft = ceil(1.2) = 2
    expect(calculateVideoGemCost(model, 3, '720p', true)).toBe(2);
    // 1080p full = 2/sec
    expect(calculateVideoGemCost(model, 5, '1080p', false)).toBe(10);
  });

  test('Grok Imagine Video pricing rounds 1.5/sec up', () => {
    const model = grok();
    expect(model.capabilities.durations.default).toBe(3);
    expect(model.capabilities.durations.max).toBe(5);
    // 3s = ceil(4.5) = 5; 5s = ceil(7.5) = 8
    expect(calculateVideoGemCost(model, 3, '720p', false)).toBe(5);
    expect(calculateVideoGemCost(model, 5, '720p', false)).toBe(8);
    expect(calculateVideoGemCost(model, 4, '480p', false)).toBe(6);
  });
});
