// Build the initial database contents from the research files.
//   1. Apply the editorial review in research/curation.json (every change is recorded
//      on the candidate as an editorial note).
//   2. Validate and normalize with the same ingest code the dashboard uses.
//   3. Write one JSON file per document plus batches of <=50 writes for the
//      ArtifactData tool to research/seed/.
import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { ingestResearch } from '../src/core/ingest.js';

const root = new URL('..', import.meta.url).pathname;
const curation = JSON.parse(await readFile(`${root}research/curation.json`, 'utf8'));
const files = (await readdir(`${root}research/raw`)).filter((f) => f.endsWith('.json')).sort();
const INTENT_LABEL = { purchase: 'purchase intent', none: 'context only', curiosity: 'curiosity', utility: 'help-seeking', criticism: 'criticism' };

function applyCuration(raw) {
  const out = structuredClone(raw);
  for (const c of out.candidates || []) {
    const cur = curation.candidates[c.name];
    const notes = [];
    if (!cur) continue;
    const byId = new Map((c.evidence || []).map((e) => [e.id, e]));
    for (const [id, change] of Object.entries(cur.evidence || {})) {
      const e = byId.get(id);
      if (!e) throw new Error(`Curation references unknown evidence ${id} in ${c.name}`);
      const label = e.publisher || e.title || e.url;
      if (change.intent && change.intent !== e.intent) {
        notes.push(`Relabeled "${label}" from ${INTENT_LABEL[e.intent] || e.intent} to ${INTENT_LABEL[change.intent]}: ${change.why}.`);
        e.intent = change.intent;
      }
      if (change.syndicationOf && change.syndicationOf !== e.syndicationOf) {
        const target = byId.get(change.syndicationOf);
        notes.push(`Counted "${label}" with "${target?.publisher || target?.title || change.syndicationOf}" as one signal: ${change.why}.`);
        e.syndicationOf = change.syndicationOf;
      }
    }
    for (const [key, s] of Object.entries(cur.scores || {})) {
      const before = c.scores?.[key];
      if (!before || before.score !== s.score || before.basis !== s.basis) {
        notes.push(`Changed ${key} from ${before?.score ?? 'not assessed'} (${before?.basis || 'unknown'}) to ${s.score ?? 'not assessed'} (${s.basis}): ${s.rationale}`);
      }
      c.scores = { ...(c.scores || {}), [key]: s };
    }
    if (cur.window) c.window = { ...(c.window || {}), ...cur.window };
    for (const n of cur.notes || []) notes.push(n);
    if (cur.name && cur.name !== c.name) {
      c.aliases = [...new Set([...(c.aliases || []), c.name])];
      c.name = cur.name;
    }
    c.editorialNotes = notes.map((n) => `Editorial review ${curation.reviewedAt.slice(0, 10)}: ${n}`);
  }
  return out;
}

const LENS_LABELS = {
  'aesthetics.json': 'Discovery scan: aesthetics & decor',
  'hobbies.json': 'Discovery scan: hobbies & practical niches',
  'memes.json': 'Discovery scan: memes & phrases',
  'movements.json': 'Discovery scan: movements & Q4 seasonal hooks',
};
const docs = [];
const summary = [];
const runIdFor = (f) => `run-2026-10-04-${f.replace('.json', '')}`;
for (const f of files) {
  const raw = applyCuration(JSON.parse(await readFile(`${root}research/raw/${f}`, 'utf8')));
  raw.kind = 'discover';
  raw.lens = LENS_LABELS[f] || raw.lens;
  const runId = runIdFor(f);
  const { docs: d, report } = ingestResearch(raw, { runId, now: Date.parse(raw.researchedAt) });
  docs.push(...d);
  for (const c of report.candidates) summary.push({ file: f, ...c });
}

// Source availability, as verified from this research environment on 2026-10-04.
const checkedAt = '2026-10-04T20:52:00Z';
docs.push({
  path: 'config/sources',
  data: {
    checkedAt,
    note: 'Checked from the research environment. Container network access and the page-fetch tool were both tested; web search ran through the search tool.',
    sources: [
      { source: 'Web search (Claude search tool)', method: 'search', status: 'ok', note: 'Returns current US results with links and summaries. The initial research used the full 200-search session budget.' },
      { source: 'Direct page fetch (articles)', method: 'fetch', status: 'blocked', note: 'Blocked by the environment network policy for nearly every publisher tried (Fortune, Yahoo, Fast Company, The Verge, Pinterest newsroom, Gelato, others).' },
      { source: 'Google Trends', method: 'fetch + API', status: 'blocked', note: 'trends.google.com denied by network policy. No relative-interest series could be measured.' },
      { source: 'Reddit', method: 'JSON API', status: 'blocked', note: 'reddit.com denied by network policy; Reddit evidence appears only via search results.' },
      { source: 'Etsy', method: 'site + Open API v3', status: 'blocked', note: 'etsy.com and openapi.etsy.com denied. Listing counts, sales and bestseller badges could not be observed.' },
      { source: 'Pinterest', method: 'site + Trends', status: 'blocked', note: 'pinterest.com denied. Pinterest figures come from its published reports as cited by search results.' },
      { source: 'TikTok', method: 'site', status: 'blocked', note: 'tiktok.com denied. TikTok activity appears only via search results and press.' },
      { source: 'YouTube', method: 'site + Data API', status: 'blocked', note: 'youtube.com denied; the Data API needs an API key that is not configured.' },
      { source: 'Wikipedia pageviews', method: 'Wikimedia REST API', status: 'blocked', note: 'wikimedia.org denied. This would have provided absolute daily attention measurements for charts.' },
      { source: 'Know Your Meme', method: 'site', status: 'blocked', note: 'Denied; entries appear via search results only.' },
      { source: 'Hacker News, Bluesky, Google News RSS, Google autocomplete', method: 'public APIs', status: 'blocked', note: 'All denied by the environment network policy.' },
      { source: 'Amazon, Walmart (marketplace pages)', method: 'site', status: 'blocked', note: 'Denied; marketplace facts come from third-party reports surfaced in search.' },
    ],
  },
});

const outDir = `${root}research/seed`;
await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/docs`, { recursive: true });
const writes = [];
for (const d of docs) {
  const [collection, doc_id] = d.path.split('/');
  const file = `research/seed/docs/${collection}__${doc_id}.json`;
  await writeFile(`${root}${file}`, JSON.stringify(d.data, null, 2));
  writes.push({ op: 'set', collection, doc_id, file_path: file });
}
const batches = [];
for (let i = 0; i < writes.length; i += 50) batches.push(writes.slice(i, i + 50));
await writeFile(`${outDir}/batches.json`, JSON.stringify(batches, null, 1));
await writeFile(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
const counts = docs.reduce((m, d) => ((m[d.path.split('/')[0]] = (m[d.path.split('/')[0]] || 0) + 1), m), {});
console.log(JSON.stringify(counts), `${batches.length} batches`);
for (const s of summary) console.log(`${s.status.padEnd(8)} ${s.name} score=${s.score} conf=${s.confidence} action=${s.action} warnings=${s.warnings.length}`);
