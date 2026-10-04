// Validate research files against Trendjack's evidence rules and print what ingest would keep.
// Usage: node scripts/validate-research.mjs [files...]   (default: research/raw/*.json)
import { readFile, readdir } from 'node:fs/promises';
import { ingestResearch } from '../src/core/ingest.js';
import { assess } from '../src/core/scoring.js';

const root = new URL('..', import.meta.url).pathname;
let files = process.argv.slice(2);
if (!files.length) files = (await readdir(`${root}research/raw`)).filter((f) => f.endsWith('.json')).map((f) => `${root}research/raw/${f}`);
let bad = 0;
for (const f of files) {
  const raw = JSON.parse(await readFile(f, 'utf8'));
  const { docs, report } = ingestResearch(raw, { runId: 'validate', now: Date.now() });
  console.log(`\n== ${f.split('/').pop()} (${raw.lens}) researchedAt=${raw.researchedAt}`);
  for (const c of report.candidates) {
    const cand = docs.find((d) => d.path === `candidates/${c.id}`)?.data;
    const ev = docs.filter((d) => d.path.startsWith('evidence/') && d.data.candidateId === c.id).map((d) => d.data);
    if (c.status === 'rejected') {
      bad++;
      console.log(`  REJECTED ${c.name}: ${c.errors.join('; ')}`);
      continue;
    }
    const a = assess(cand, ev, {}, Date.now());
    console.log(`  ${c.name} [${cand.trajectory.stage}] analyst=${cand.recommendedAction} gate=${a.gate.action} score=${a.opportunity.score} conf=${a.confidence.score} indep=${a.confidence.stats.independent}/${ev.length} purchase=${a.confidence.stats.intents.purchase} products=${cand.products.length}`);
    for (const r of a.gate.reasons) console.log(`     cap ${r.cap}: ${r.reason}`);
    for (const w of c.warnings) console.log(`     warn: ${w}`);
  }
  for (const w of report.warnings) console.log(`  warn: ${w}`);
}
process.exit(bad ? 1 : 0);
