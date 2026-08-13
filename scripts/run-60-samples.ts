import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TARGET_SCENARIOS = [
  'same-person-multiple-threads',
  'multiple-expectations-due',
  'honcho-unavailable',
  'several-valid-reasons-to-speak-compete',
  'surprising-but-not-creepy-callback',
  'carrying-conversational-load',
];

const REPETITIONS = 10;
const OUTPUT_FILE = path.join(process.cwd(), 'eval_60_results.json');

async function run() {
  const allResults: Record<string, any[]> = {};

  for (const scenarioId of TARGET_SCENARIOS) {
    allResults[scenarioId] = [];
    console.log(`=== Starting 10 runs for scenario: ${scenarioId} ===`);

    for (let run = 1; run <= REPETITIONS; run++) {
      let attempts = 0;
      let success = false;

      while (!success && attempts < 3) {
        attempts++;
        try {
          console.log(`Running ${scenarioId} [Run ${run}/10, Attempt ${attempts}]...`);
          const stdout = execFileSync(
            'pnpm',
            ['exec', 'tsx', 'scripts/continuity-scenario-harness.ts', '--', `--scenario=${scenarioId}`],
            {
              cwd: process.cwd(),
              env: process.env,
              encoding: 'utf-8',
              maxBuffer: 10 * 1024 * 1024,
            }
          );

          // Parse JSON from output
          const jsonMatch = stdout.match(/=== [\s\S]*? ===\n(\{[\s\S]*?\})\n\nContinuity harness:/);
          if (jsonMatch && jsonMatch[1]) {
            const parsed = JSON.parse(jsonMatch[1]);
            allResults[scenarioId].push({ runNumber: run, ...parsed });
            success = true;
          } else {
            console.warn(`Failed to parse JSON for ${scenarioId} run ${run}, stdout: ${stdout.slice(0, 300)}`);
          }
        } catch (err: any) {
          console.error(`Error during ${scenarioId} run ${run} (attempt ${attempts}):`, err?.message || err);
          if (attempts >= 3) {
            allResults[scenarioId].push({
              runNumber: run,
              error: err?.message || 'Infrastructure error after 3 attempts',
            });
          }
        }
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(`\nCompleted all runs! Saved 60 samples to ${OUTPUT_FILE}`);
}

run().catch(console.error);
