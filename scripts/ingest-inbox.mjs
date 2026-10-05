// File research results from downloaded inbox documents, the same way the dashboard does.
// Usage: node scripts/ingest-inbox.mjs <snapshotDir>
//   <snapshotDir> holds ArtifactData downloads: inbox/, candidates/, evidence/, playbooks/, snapshots/, runs/
// Writes research/seed/inbox-batches.json: ArtifactData batches that create only documents
// that do not exist yet (anything the dashboard already filed is skipped).
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { ingestResearch } from '../src/core/ingest.js';

const root = new URL('..', import.meta.url).pathname;
const dir = process.argv[2];
if (!dir) throw new Error('Pass the snapshot directory.');
const load = async (col) => {
  const out = [];
  for (const f of await readdir(`${dir}/${col}`).catch(() => [])) {
    if (!f.endsWith('.json')) continue;
    const d = JSON.parse(await readFile(`${dir}/${col}/${f}`, 'utf8'));
    // ArtifactData downloads name files with '@' where ids contain '~'.
    out.push({ id: f.replace(/\.json$/, '').replace(/@/g, '~'), ...(d.data || d) });
  }
  return out;
};
const inbox = (await load('inbox')).filter((x) => x.status === 'new').sort((a, b) => a.id.localeCompare(b.id));
const candidates = await load('candidates');
const evidence = await load('evidence');
const existingPaths = new Set();
for (const col of ['candidates', 'evidence', 'observations', 'snapshots', 'runs', 'playbooks']) for (const d of await load(col)) existingPaths.add(`${col}/${d.id}`);

const existing = { candidates: new Map(candidates.map((c) => [c.id, c])), evidence };
const outDir = `${root}research/seed/inbox`;
await mkdir(outDir, { recursive: true });
const writes = [];
const summary = [];
for (const item of inbox) {
  const raw = typeof item.raw === 'string' ? JSON.parse(item.raw) : item.raw;
  let result;
  try {
    result = ingestResearch(raw, { runId: item.runId || item.id, jobId: item.jobId || null, existing });
  } catch (e) {
    summary.push(`${item.id}: REJECTED ${e.message}`);
    continue;
  }
  for (const c of result.report.candidates) summary.push(`${item.id}: ${c.status} ${c.name} score=${c.score} conf=${c.confidence} action=${c.action}${c.errors?.length ? ' errors=' + c.errors.join('; ') : ''}`);
  for (const d of result.docs) {
    if (existingPaths.has(d.path)) continue;
    existingPaths.add(d.path);
    const [collection, doc_id] = d.path.split('/');
    const file = `research/seed/inbox/${collection}__${doc_id}.json`;
    await writeFile(`${root}${file}`, JSON.stringify(d.data));
    writes.push({ op: 'set', collection, doc_id, file_path: file });
  }
  // Later items see this item's candidates and evidence.
  for (const d of result.docs) {
    if (d.path.startsWith('candidates/')) existing.candidates.set(d.data.id, d.data);
    if (d.path.startsWith('evidence/')) existing.evidence.push(d.data);
  }
}
const batches = [];
for (let i = 0; i < writes.length; i += 50) batches.push(writes.slice(i, i + 50));
await writeFile(`${root}research/seed/inbox-batches.json`, JSON.stringify(batches));
console.log(summary.join('\n'));
console.log(`\n${inbox.length} new inbox documents -> ${writes.length} writes in ${batches.length} batches`);
