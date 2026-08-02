import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getSummarizer } from '@/lib/ai/summarizer';
import { filterPersistableEvents } from '@/lib/ai/continuity';

const transcript = JSON.parse(
  fs.readFileSync('/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/full_transcript_226_turns.json', 'utf-8')
);

const segments = [
  { name: '1. Marco Encounter & Exposure Video', start: 23, end: 32 },
  { name: '2. Outside-partner agreement & honesty rule', start: 55, end: 65 },
  { name: '3. Isa withholding details & Kai leaving', start: 24, end: 28 },
  { name: '4. Weeks of separation & financial consequences', start: 129, end: 145 },
  { name: '5. Confession & engagement-ring disclosures', start: 140, end: 149 },
  { name: '6. Motel FaceTime sequence', start: 150, end: 191 },
  { name: '7. Final Mateo discussion', start: 216, end: 226 },
];

async function runSegmentTests() {
  const results: any[] = [];

  for (const seg of segments) {
    console.log(`\n========================================`);
    console.log(`RUNNING EXTRACTION TEST FOR SEGMENT: ${seg.name}`);
    console.log(`Turns ${seg.start} to ${seg.end}`);

    const segmentTurns = transcript.slice(seg.start - 1, seg.end).map((t: any) => ({
      role: t.role as 'user' | 'assistant',
      content: t.text,
    }));

    try {
      const summarizer = getSummarizer();
      
      const ontologyUpdate = await summarizer.extractOntologyUpdate(segmentTurns, {
        characterName: 'Isabella Morales',
      }).catch(err => {
        console.error('Ontology update failed:', err.message);
        return { operations: [], event_families: [], scene_frame: null, relationship: {} };
      });

      const canonicalEvents = await summarizer.extractCanonicalEvents(segmentTurns, {
        characterName: 'Isabella Morales',
      }).catch(err => {
        console.error('Canonical events failed:', err.message);
        return { events: [] };
      });

      const unifiedUpdate = await summarizer.extractUnifiedUpdate(segmentTurns, {
        characterName: 'Isabella Morales',
      }).catch(err => {
        console.error('Unified update failed:', err.message);
        return { memoryPatch: {}, activeState: null, newEvents: [], dynamicsDeltas: [], reasoning: '' };
      });

      const filteredEvents = filterPersistableEvents(unifiedUpdate.newEvents || []);

      results.push({
        segment: seg.name,
        turnRange: `${seg.start}-${seg.end}`,
        ontologyUpdate,
        canonicalEvents,
        rawEventsCount: (unifiedUpdate.newEvents || []).length,
        filteredEventsCount: filteredEvents.length,
        filteredEvents,
        memoryPatch: unifiedUpdate.memoryPatch,
      });

      console.log('Operations count:', ontologyUpdate.operations.length);
      console.log('Raw newEvents count:', (unifiedUpdate.newEvents || []).length);
      console.log('Filtered newEvents count:', filteredEvents.length);
    } catch (e: any) {
      console.error(`Error processing segment ${seg.name}:`, e.message);
    }
  }

  const outPath = '/Users/mukeshkumar/.gemini/antigravity-cli/brain/2eecbd57-51ac-4faf-aecf-771e5f5b778e/scratch/segment_test_results.json';
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved test results to ${outPath}`);
}

runSegmentTests().catch(console.error);
