import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { characters } from '@/lib/ai/characters';

test('all configured avatar assets exist locally', () => {
  for (const character of characters) {
    const avatarPath = path.join(process.cwd(), 'public', character.avatar);

    expect(
      fs.existsSync(avatarPath),
      `Missing avatar asset for ${character.id}: ${character.avatar}`,
    ).toBe(true);
  }
});
