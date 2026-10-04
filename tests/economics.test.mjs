import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feeTable, productEconomics, channelEconomics, asymmetry, killDays } from '../src/core/economics.js';
import { cleanPlaybookProduct, matchPlaybooks, fallbackPlaybook } from '../src/core/playbook.js';
import { ingestResearch } from '../src/core/ingest.js';

const NOW = Date.parse('2026-10-04T21:00:00Z');
const table = feeTable(null, {});

test('Etsy digital sale: fees are listing + 9.5% + $0.25 by default', () => {
  const r = channelEconomics('etsy', { price: 10, cost: { basis: 'digital', base: 0, shipping: 0 }, table });
  assert.equal(r.fees, 1.4); // 0.20 + 0.95 + 0.25
  assert.equal(r.net, 8.6);
  assert.equal(r.marginPct, 86);
});

test('Etsy POD sale: shipping passes through but attracts percentage fees', () => {
  const r = channelEconomics('etsy', { price: 20, cost: { basis: 'estimate', base: 9, shipping: 5 }, table });
  // fees = 0.20 + 25 * 9.5% + 0.25 = 2.825 -> 2.83 ; net = 20 - 2.825 - 9 = 8.175 -> 8.18
  assert.equal(r.fees, 2.83);
  assert.equal(r.net, 8.18);
});

test('Gumroad, Payhip and KDP arithmetic', () => {
  const digital = { basis: 'digital', base: 0, shipping: 0 };
  assert.equal(channelEconomics('gumroad', { price: 10, cost: digital, table }).net, 8.5);
  assert.equal(channelEconomics('payhip', { price: 10, cost: digital, table }).net, 8.91);
  const kdp = channelEconomics('kdp', { price: 9.99, cost: { basis: 'estimate', base: null, shipping: null }, table, pages: 120 });
  assert.equal(kdp.net, 3.55); // 5.994 - (1 + 1.44)
  const cheap = channelEconomics('kdp', { price: 8.99, cost: { basis: 'estimate' }, table, pages: 120 });
  assert.equal(cheap.net, 2.06); // 50% below $9.99: 4.495 - 2.44
  const short = channelEconomics('kdp', { price: 9.99, cost: { basis: 'estimate' }, table, pages: 100 });
  assert.equal(short.net, 3.69); // 5.994 - 2.30 flat
});

test('POD costs: verified Printful base falls back when Printify is unverified; mixed basis is labeled', async () => {
  const { productCost } = await import('../src/core/economics.js');
  const t = feeTable({ items: [{ key: 'printful_sticker_3x3_base', value: 2.24 }, { key: 'printify_mug_11oz_base', value: 5.02 }, { key: 'printify_mug_shipping', value: 5.79 }] }, {});
  const sticker = productCost({ format: 'sticker', fulfillment: 'pod' }, { costs: { baseCost: 2, shipping: 4.5 } }, t);
  assert.equal(sticker.base, 2.24);
  assert.equal(sticker.shipping, 4.5);
  assert.equal(sticker.basis, 'mixed');
  assert.equal(sticker.provider, 'Printful');
  const mug = productCost({ format: 'mug', fulfillment: 'pod' }, null, t);
  assert.equal(mug.basis, 'verified');
  assert.equal(Math.round((mug.base + mug.shipping) * 100) / 100, 10.81);
});

test('verified figures and user overrides replace defaults, and say so', () => {
  const t = feeTable({ items: [{ key: 'etsy_transaction_pct', value: 7, unit: 'percent', source: 'https://example.com/fees', retrievedAt: '2026-10-04' }, { key: 'gumroad_pct', value: null }] }, { etsy_processing_fixed: 0.3 });
  assert.equal(t.etsy_transaction_pct.status, 'verified');
  assert.equal(t.etsy_transaction_pct.value, 7);
  assert.equal(t.gumroad_pct.status, 'default');
  assert.equal(t.etsy_processing_fixed.status, 'override');
  assert.equal(t.etsy_processing_fixed.value, 0.3);
});

test('product economics: break-even counts cash at risk against net per sale', () => {
  const product = { format: 'printable', fulfillment: 'digital', effortHours: 6 };
  const pb = cleanPlaybookProduct({ superPrompt: 'x', pricing: { recommended: 8 }, costs: { testBudget: 14 }, platforms: [{ name: 'Etsy', role: 'primary' }, { name: 'Gumroad', role: 'secondary' }, { name: 'Pinterest', role: 'traffic' }] });
  const e = productEconomics(product, pb, table);
  assert.equal(e.rows.length, 2);
  assert.equal(e.primary.label, 'Etsy');
  assert.equal(e.cashAtRisk, 14.2);
  assert.equal(e.breakEven, Math.ceil(14.2 / e.primary.net));
});

test('POD without known costs is flagged, not silently profitable', () => {
  const product = { format: 'tote', fulfillment: 'pod' };
  const e = productEconomics(product, cleanPlaybookProduct({ superPrompt: 'x', pricing: { recommended: 24 } }), table);
  assert.equal(e.cost.basis, 'unknown');
  assert.equal(e.rows[0].unknownCost, true);
});

test('asymmetry: cheap evergreen digital beats a thin-margin deadline POD bet', () => {
  const cand = { scores: { durability: { score: 4 } }, window: {} };
  const digital = { format: 'printable', fulfillment: 'digital', effortHours: 6 };
  const pbD = cleanPlaybookProduct({ superPrompt: 'x', pricing: { recommended: 12 }, platforms: [{ name: 'Etsy', role: 'primary' }, { name: 'Gumroad', role: 'secondary' }, { name: 'Payhip', role: 'secondary' }], extensions: ['a', 'b', 'c'] });
  const aD = asymmetry({ product: digital, candidate: cand, econ: productEconomics(digital, pbD, table), playbook: pbD, now: NOW });
  const pod = { format: 'tote', fulfillment: 'pod', effortHours: 12 };
  const pbP = cleanPlaybookProduct({ superPrompt: 'x', pricing: { recommended: 24 }, costs: { baseCost: 14, shipping: 6, testBudget: 30 }, platforms: [{ name: 'Etsy', role: 'primary' }] });
  const aP = asymmetry({ product: pod, candidate: { scores: { durability: { score: 2 } }, window: { sellBy: '2026-11-01' } }, econ: productEconomics(pod, pbP, table), playbook: pbP, now: NOW });
  assert.ok(aD.score > aP.score, `${aD.score} should beat ${aP.score}`);
  assert.equal(aD.label, 'Strongly asymmetric');
  assert.ok(['Unfavorable', 'Roughly even'].includes(aP.label));
  assert.equal(aD.downside.label, 'Small');
});

test('kill days come from the launch plan, default 21', () => {
  assert.equal(killDays({ marketing: { launchPlan: [{ day: 'Day 0' }, { day: 'Day 14' }, { day: 'Day 21–28' }] } }), 21);
  assert.equal(killDays({}), 21);
  assert.equal(killDays({ marketing: { launchPlan: [{ day: 'Day 3' }, { day: 'Day 10' }] } }), 10);
});

test('playbooks: validation, matching, stale detection and template fallback', () => {
  assert.equal(cleanPlaybookProduct({ superPrompt: '' }), null);
  const cand = { name: 'T', products: [{ theme: 'Beginner kit for hosts', format: 'bundle', fulfillment: 'digital' }, { theme: 'Club ledger', format: 'template' }] };
  const doc = { products: [{ index: 0, themeKey: 'Beginner kit for hosts', superPrompt: 'S' }] };
  const m = matchPlaybooks(cand, doc);
  assert.equal(m[0].fallback, false);
  assert.equal(m[0].stale, false);
  assert.equal(m[1].fallback, true);
  assert.ok(m[1].playbook.superPrompt.includes('Club ledger'));
  const stale = matchPlaybooks({ products: [{ theme: 'Something else entirely' }] }, doc);
  assert.equal(stale[0].stale, true);
  const fb = fallbackPlaybook({ theme: 'Sticker', format: 'sticker', rightsNote: 'No logos.' }, { rights: { note: 'Original art only.' } });
  assert.ok(fb.superPrompt.includes('1500x1500'));
  assert.ok(fb.superPrompt.includes('Original art only.'));
});

test('ingest files worker-written playbooks next to the candidate', () => {
  const raw = {
    researchedAt: '2026-10-04T20:00:00Z',
    candidates: [
      {
        name: 'Playbook Trend',
        trajectory: { stage: 'early_growth' },
        recommendedAction: 'watch',
        products: [{ theme: 'A printable', format: 'printable', playbook: { superPrompt: 'Make it', pricing: { recommended: 9 } } }],
        evidence: [{ id: 'e1', url: 'https://example.org/x', retrievedAt: '2026-10-04T20:00:00Z', claim: 'c', kind: 'observed' }],
      },
    ],
  };
  const { docs } = ingestResearch(raw, { runId: 'r1', now: NOW });
  const pb = docs.find((d) => d.path === 'playbooks/playbook-trend');
  assert.ok(pb);
  assert.equal(pb.data.products[0].superPrompt, 'Make it');
  assert.equal(pb.data.products[0].themeKey, 'A printable');
});
