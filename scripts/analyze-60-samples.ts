import fs from 'node:fs';
import path from 'node:path';

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'eval_60_results.json'), 'utf-8'));

for (const [scenarioId, runs] of Object.entries(data)) {
  console.log(`\n======================================================`);
  console.log(`SCENARIO: ${scenarioId} (${(runs as any[]).length} runs)`);
  console.log(`======================================================`);
  
  (runs as any[]).forEach((run: any) => {
    const act = run.editorialDecision?.act ?? false;
    const policyAccepted = run.policyResult?.accepted ?? false;
    const output = run.finalSophieOutput || 'SILENCE';
    const posture = run.editorialDecision?.posture || 'N/A';
    const reason = run.editorialDecision?.reason || run.policyResult?.reason || 'N/A';

    console.log(`Run ${run.runNumber}: [act=${act}, policyAccepted=${policyAccepted}, posture=${posture}]`);
    console.log(`   Output: "${output}"`);
    console.log(`   Reason: ${reason}`);
  });
}
