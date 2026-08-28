import fs from 'node:fs';
import path from 'node:path';

export function generateTemporalResearchReport() {
  const jsonPath = path.join(
    process.cwd(),
    'evals/sophie/behavioral-harness/reports/temporal-rhythm-results.json',
  );

  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    return;
  }

  const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const results = rawData.results || [];

  console.log(`Loaded ${results.length} temporal trajectory evaluation results.`);

  const variantScores: Record<string, { total: number; count: number; arrivalScore: number; arrivalCount: number; metrics: Record<string, number> }> = {
    variant_a: { total: 0, count: 0, arrivalScore: 0, arrivalCount: 0, metrics: {} },
    variant_b: { total: 0, count: 0, arrivalScore: 0, arrivalCount: 0, metrics: {} },
    variant_c: { total: 0, count: 0, arrivalScore: 0, arrivalCount: 0, metrics: {} },
    variant_d: { total: 0, count: 0, arrivalScore: 0, arrivalCount: 0, metrics: {} },
  };

  for (const r of results) {
    const v = r.variant;
    if (!variantScores[v]) continue;

    const overall = r.scores?.overall_score || 0;
    variantScores[v].total += overall;
    variantScores[v].count++;

    if (r.scores?.relational_arrival_quality) {
      variantScores[v].arrivalScore += r.scores.relational_arrival_quality;
      variantScores[v].arrivalCount++;
    }

    if (r.scores) {
      for (const [k, val] of Object.entries(r.scores)) {
        if (typeof val === 'number' && k !== 'overall_score') {
          variantScores[v].metrics[k] = (variantScores[v].metrics[k] || 0) + val;
        }
      }
    }
  }

  const reportData = {
    variant_a_avg: Math.round((variantScores.variant_a.total / (variantScores.variant_a.count || 1)) * 100) / 100,
    variant_b_avg: Math.round((variantScores.variant_b.total / (variantScores.variant_b.count || 1)) * 100) / 100,
    variant_c_avg: Math.round((variantScores.variant_c.total / (variantScores.variant_c.count || 1)) * 100) / 100,
    variant_d_avg: Math.round((variantScores.variant_d.total / (variantScores.variant_d.count || 1)) * 100) / 100,

    variant_a_arrival: Math.round((variantScores.variant_a.arrivalScore / (variantScores.variant_a.arrivalCount || 1)) * 100) / 100,
    variant_b_arrival: Math.round((variantScores.variant_b.arrivalScore / (variantScores.variant_b.arrivalCount || 1)) * 100) / 100,
    variant_c_arrival: Math.round((variantScores.variant_c.arrivalScore / (variantScores.variant_c.arrivalCount || 1)) * 100) / 100,
    variant_d_arrival: Math.round((variantScores.variant_d.arrivalScore / (variantScores.variant_d.arrivalCount || 1)) * 100) / 100,
  };

  console.log('\n==================================================');
  console.log('TEMPORAL RHYTHM & ARRIVAL SCOREBOARD SUMMARY');
  console.log('==================================================');
  console.log(`Variant A (Production Baseline - No Temporal Mode): Overall = ${reportData.variant_a_avg} / 5.0 | Arrival Quality = ${reportData.variant_a_arrival} / 5.0`);
  console.log(`Variant B (Generic Temporal Mode):                Overall = ${reportData.variant_b_avg} / 5.0 | Arrival Quality = ${reportData.variant_b_arrival} / 5.0`);
  console.log(`Variant C (Personalized Temporal Rhythm - TARGET): Overall = ${reportData.variant_c_avg} / 5.0 | Arrival Quality = ${reportData.variant_c_arrival} / 5.0`);
  console.log(`Variant D (Prescriptive Checklist - NEG CONTROL):  Overall = ${reportData.variant_d_avg} / 5.0 | Arrival Quality = ${reportData.variant_d_arrival} / 5.0`);
  console.log('==================================================\n');
}

if (require.main === module) {
  generateTemporalResearchReport();
}
