import fs from 'node:fs';
import path from 'node:path';

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'eval_60_results.json'), 'utf-8'));

let totalRuns = 0;
let speakCount = 0;
let silenceCount = 0;
let falseHoldCount = 0;
let provenanceLeakCount = 0;
let questionStackCount = 0;
let assistantLikeCount = 0;
let performativeCount = 0;

const PROVENANCE_REGEX = /you (said|asked|wanted|mentioned|told|set)|as promised|according to|per our|you said to ask/i;

const scenarioStats: Record<string, any> = {};

for (const [scenarioId, runs] of Object.entries(data)) {
  const list = runs as any[];
  scenarioStats[scenarioId] = {
    total: list.length,
    speak: 0,
    silence: 0,
    falseHold: 0,
    provenanceLeak: 0,
    questionStack: 0,
    assistantLike: 0,
    performative: 0,
  };

  list.forEach((r) => {
    totalRuns++;
    const output = r.finalSophieOutput || 'SILENCE';
    const isSilence = output === 'SILENCE';
    const act = r.editorialDecision?.act ?? false;
    const policyAccepted = r.policyResult?.accepted ?? false;

    if (isSilence) {
      silenceCount++;
      scenarioStats[scenarioId].silence++;
      if (r.editorialDecision?.posture === 'hold' || !policyAccepted) {
        falseHoldCount++;
        scenarioStats[scenarioId].falseHold++;
      }
    } else {
      speakCount++;
      scenarioStats[scenarioId].speak++;

      if (PROVENANCE_REGEX.test(output)) {
        provenanceLeakCount++;
        scenarioStats[scenarioId].provenanceLeak++;
      }

      const qCount = (output.match(/\?/g) || []).length;
      if (qCount > 1) {
        questionStackCount++;
        scenarioStats[scenarioId].questionStack++;
      }

      if (/babe|preferred window|as promised|per contract|nudge you/i.test(output)) {
        assistantLikeCount++;
        scenarioStats[scenarioId].assistantLike++;
      }

      if (/\*\*|somewhere cold|highlands through your speakers|viking dream/i.test(output)) {
        performativeCount++;
        scenarioStats[scenarioId].performative++;
      }
    }
  });
}

console.log('=== GLOBAL SUMMARY ===');
console.log(`Total runs: ${totalRuns}`);
console.log(`Speak count: ${speakCount} (${((speakCount/totalRuns)*100).toFixed(1)}%)`);
console.log(`Silence count: ${silenceCount} (${((silenceCount/totalRuns)*100).toFixed(1)}%)`);
console.log(`False HOLD count: ${falseHoldCount} (${((falseHoldCount/totalRuns)*100).toFixed(1)}%)`);
console.log(`Provenance Leak count: ${provenanceLeakCount} (${((provenanceLeakCount/totalRuns)*100).toFixed(1)}%)`);
console.log(`Question Stack count: ${questionStackCount} (${((questionStackCount/totalRuns)*100).toFixed(1)}%)`);
console.log(`Assistant-Like count: ${assistantLikeCount} (${((assistantLikeCount/totalRuns)*100).toFixed(1)}%)`);
console.log(`Performative count: ${performativeCount} (${((performativeCount/totalRuns)*100).toFixed(1)}%)`);

console.log('\n=== SCENARIO BREAKDOWN ===');
console.log(JSON.stringify(scenarioStats, null, 2));
