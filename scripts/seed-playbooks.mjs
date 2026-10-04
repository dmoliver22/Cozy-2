// Validate written playbooks (research/playbooks/out-*.json) against the stored products and
// write one database document per candidate to research/seed/playbooks/, plus a batch file.
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { cleanPlaybookProduct, themeKey } from '../src/core/playbook.js';
import { feeTable, productEconomics, asymmetry } from '../src/core/economics.js';

const root = new URL('..', import.meta.url).pathname;
const inputs = JSON.parse(await readFile(`${root}research/playbooks/input.json`, 'utf8'));
const byId = new Map(inputs.map((c) => [c.candidateId, c]));
const files = (await readdir(`${root}research/playbooks`)).filter((f) => /^out-.*\.json$/.test(f)).sort();
const outDir = `${root}research/seed/playbooks`;
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const table = feeTable(null, {});
const writes = [];
const problems = [];
let count = 0;

for (const f of files) {
  const raw = JSON.parse(await readFile(`${root}research/playbooks/${f}`, 'utf8'));
  for (const pbDoc of raw.playbooks || []) {
    const cand = byId.get(pbDoc.candidateId);
    if (!cand) {
      problems.push(`${f}: unknown candidate ${pbDoc.candidateId}`);
      continue;
    }
    const products = [];
    for (const p of pbDoc.products || []) {
      const product = cand.products[p.index];
      if (!product) {
        problems.push(`${pbDoc.candidateId}: no product at index ${p.index}`);
        continue;
      }
      const clean = cleanPlaybookProduct({ ...p, themeKey: themeKey(product.theme), source: 'written' });
      if (!clean) {
        problems.push(`${pbDoc.candidateId}#${p.index}: missing super prompt`);
        continue;
      }
      if (clean.superPrompt.split(/\s+/).length < 200) problems.push(`${pbDoc.candidateId}#${p.index}: super prompt is short (${clean.superPrompt.split(/\s+/).length} words)`);
      if (clean.pricing.recommended == null) problems.push(`${pbDoc.candidateId}#${p.index}: no recommended price`);
      if (product.fulfillment === 'pod' && (clean.costs.baseCost == null || clean.costs.shipping == null)) problems.push(`${pbDoc.candidateId}#${p.index}: POD product without base cost or shipping`);
      products.push(clean);
      const candDoc = { scores: { durability: { score: cand.durabilityScore } }, window: cand.window };
      const econ = productEconomics(product, clean, table);
      const asym = asymmetry({ product, candidate: candDoc, econ, playbook: clean, now: Date.parse('2026-10-04T23:00:00Z') });
      console.log(`${pbDoc.candidateId.padEnd(40)} #${p.index} ${clean.productName.slice(0, 40).padEnd(40)} $${clean.pricing.recommended} net ${econ.primary?.net ?? '?'} (${econ.primary?.label || '-'}) BE ${econ.breakEven ?? '?'} | ${asym.label} ${asym.score}`);
      count++;
    }
    const doc = { id: pbDoc.candidateId, candidateId: pbDoc.candidateId, products, writtenAt: raw.writtenAt || new Date().toISOString(), source: 'written' };
    const file = `research/seed/playbooks/playbooks__${pbDoc.candidateId}.json`;
    await writeFile(`${root}${file}`, JSON.stringify(doc, null, 2));
    writes.push({ op: 'set', collection: 'playbooks', doc_id: pbDoc.candidateId, file_path: file });
  }
}
await writeFile(`${outDir}/batch.json`, JSON.stringify(writes));
const missing = inputs.filter((c) => c.products.length && !writes.some((w) => w.doc_id === c.candidateId)).map((c) => c.candidateId);
console.log(`\n${count} product playbooks in ${writes.length} documents.`);
if (missing.length) console.log(`Missing playbooks for: ${missing.join(', ')}`);
if (problems.length) console.log(`Problems:\n- ${problems.join('\n- ')}`);
