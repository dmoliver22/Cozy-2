// DEMO DATA. Fictional examples for exploring the interface only.
// Never written to the database, never mixed with researched results, and every
// link points at example.com, a domain reserved for documentation.

import { ingestResearch } from '../core/ingest.js';

const r = '2026-10-01T15:00:00Z';
const e = (id, i, extra) => ({
  id,
  url: `https://example.com/demo/source-${i}`,
  title: `Demo source ${i} (fictional)`,
  publisher: 'example.com (demo)',
  publishedAt: '2026-09-2' + (i % 9),
  retrievedAt: r,
  accessMethod: 'web_search_result',
  signalType: ['social', 'press', 'marketplace', 'creator', 'community'][i % 5],
  intent: 'curiosity',
  claim: 'Fictional evidence used to show how the dashboard presents sources.',
  kind: 'observed',
  ...extra,
});
const s = (n, basis = 'qualitative') => ({ score: n, basis, rationale: 'Demo value.' });

export const DEMO_RAW = {
  demo: true,
  lens: 'demo',
  kind: 'demo',
  researchedAt: r,
  sourcesTried: [{ source: 'Demo dataset', method: 'built-in', status: 'ok', note: 'Fictional examples.' }],
  candidates: [
    {
      name: 'DEMO: Lantern-walk journaling',
      category: 'hobby',
      summary: 'Fictional example: evening walks logged in small illustrated journals.',
      what: 'This trend does not exist. It shows how a hobby with tracking needs is presented.',
      origin: { text: 'Fictional.', evidence: ['d1'] },
      adopters: { text: 'Fictional adopters.', evidence: ['d2'] },
      spread: { text: 'Fictional spread.', evidence: ['d3'] },
      trajectory: { stage: 'early_growth', text: 'Fictional trajectory.', evidence: ['d1'] },
      productDemand: { text: 'Fictional demand.', evidence: ['d4'] },
      competition: { text: 'Fictional competition.', level: 'low', evidence: ['d5'] },
      gap: { text: 'Fictional gap.' },
      window: { estimate: 'Fictional: through winter', reasoning: 'Demo reasoning.', invalidators: ['Demo invalidator'] },
      rights: { risk: 'low', note: 'Demo.' },
      scores: { timing: s(4), buyerIntent: s(3, 'reported'), supplyGap: s(4), productFit: s(5), durability: s(3), economics: s(3) },
      recommendedAction: 'test_now',
      actionRationale: 'Demo rationale.',
      products: [
        { buyer: 'Demo buyer', format: 'printable', theme: 'Demo walk log', whyBuy: 'Demo.', evidence: ['d4'], differentiation: 'Demo.', channels: ['Etsy'], effort: 'low', effortHours: 6, leadTimeDays: 2, fulfillment: 'digital', validationTest: 'Demo test.', continueIf: 'Demo.', pivotIf: 'Demo.', stopIf: 'Demo.' },
      ],
      unresolved: ['This is demo data.'],
      evidence: [e('d1', 1), e('d2', 2), e('d3', 3), e('d4', 4, { intent: 'purchase' }), e('d5', 5, { intent: 'purchase' }), e('d6', 6)],
    },
    {
      name: 'DEMO: Teacup-pirate stickers',
      category: 'meme',
      summary: 'Fictional example: a meme with spectator attention but thin buying signals.',
      what: 'This meme does not exist. It shows how weak buyer intent caps the action.',
      trajectory: { stage: 'mainstream_surge', text: 'Fictional.', evidence: ['d1'] },
      competition: { level: 'high', text: 'Fictional.' },
      scores: { timing: s(2), buyerIntent: s(1), supplyGap: s(1), productFit: s(4), durability: s(1), economics: s(3) },
      recommendedAction: 'watch',
      products: [{ buyer: 'Demo buyer', format: 'sticker', theme: 'Demo sticker', fulfillment: 'pod', leadTimeDays: 1, effort: 'low' }],
      evidence: [e('d1', 7, { intent: 'criticism' }), e('d2', 8)],
    },
  ],
};

let cached = null;
export function demoState() {
  if (cached) return cached;
  const { docs } = ingestResearch(DEMO_RAW, { runId: 'demo-run', now: Date.parse(r) });
  const state = { ready: true, error: null, candidates: [], evidence: [], observations: [], snapshots: [], jobs: [], runs: [], watchlist: [], inbox: [], config: [] };
  for (const d of docs) {
    const col = d.path.split('/')[0];
    if (state[col]) state[col].push(d.data);
  }
  cached = state;
  return state;
}
