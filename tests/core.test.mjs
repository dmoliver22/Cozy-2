import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opportunityScore, evidenceConfidence, actionGate, productWindowFit, timeToBuyer, normalizeWeights, assess } from '../src/core/scoring.js';
import { canonicalUrl, clusterEvidence, evidenceStats, chartableSeries } from '../src/core/evidence.js';
import { diffSnapshots, latestChanges } from '../src/core/changes.js';
import { normalizeTopic, slugify } from '../src/core/normalize.js';
import { ingestResearch } from '../src/core/ingest.js';

const NOW = Date.parse('2026-10-04T21:00:00Z');
const full = (n, basis = 'qualitative') => ({ score: n, basis, rationale: 'x' });
const allScores = (n) => ({ timing: full(n), buyerIntent: full(n), supplyGap: full(n), productFit: full(n), durability: full(n), economics: full(n) });

const ev = (i, extra = {}) => ({
  id: `e${i}`,
  url: `https://site${i}.com/story-${i}`,
  title: `Story number ${i} about the trend in depth`,
  publishedAt: '2026-09-20',
  retrievedAt: '2026-10-04T20:00:00Z',
  accessMethod: 'web_search_result',
  signalType: ['press', 'social', 'marketplace', 'creator', 'community'][i % 5],
  intent: 'curiosity',
  claim: 'supports something',
  kind: 'observed',
  ...extra,
});

test('weights normalize to 100 and tolerate junk', () => {
  const w = normalizeWeights({ timing: 50, buyerIntent: 50, supplyGap: 0, productFit: 0, durability: 0, economics: 0 });
  assert.equal(Math.round(Object.values(w).reduce((a, b) => a + b, 0)), 100);
  assert.equal(Math.round(w.timing), 50);
  const z = normalizeWeights({ timing: 0, buyerIntent: 0, supplyGap: 0, productFit: 0, durability: 0, economics: 0 });
  assert.equal(Math.round(Object.values(z).reduce((a, b) => a + b, 0)), 100);
});

test('perfect scores give 100, zeros give 0', () => {
  assert.equal(opportunityScore(allScores(5)).score, 100);
  assert.equal(opportunityScore(allScores(0)).score, 0);
});

test('missing evidence never improves a score', () => {
  const known = opportunityScore(allScores(2)).score;
  for (const key of ['timing', 'buyerIntent', 'supplyGap', 'productFit', 'durability', 'economics']) {
    const s = allScores(2);
    s[key] = { score: null, basis: 'unknown' };
    const r = opportunityScore(s);
    assert.ok(r.score <= known, `${key} unknown should not raise the score`);
    assert.ok(r.unassessed.includes(key));
  }
  const s = allScores(4);
  s.timing = { score: null, basis: 'unknown' };
  assert.equal(opportunityScore(s).provisional, true);
});

test('basis unknown overrides a stray score value', () => {
  const s = allScores(5);
  s.economics = { score: 5, basis: 'unknown' };
  assert.equal(opportunityScore(s).score, 90);
});

test('canonical URLs collapse locale copies, tracking params and www', () => {
  const a = canonicalUrl('https://www.gelato.com/blog/tiktok-trends?utm_source=x');
  const b = canonicalUrl('https://gelato.com/fr/blog/tiktok-trends');
  const c = canonicalUrl('https://www.gelato.com/vi/blog/tiktok-trends/');
  assert.equal(a, b);
  assert.equal(b, c);
});

test('syndicated copies count as one independent signal', () => {
  const items = [
    ev(1),
    ev(2, { syndicationOf: 'e1' }),
    ev(3, { url: 'https://www.site1.com/story-1?utm_campaign=z' }),
    ev(4, { title: 'Story number 1 about the trend in depth', url: 'https://other.com/x' }),
    ev(5),
  ];
  const clusters = clusterEvidence(items);
  assert.equal(clusters.length, 2);
  const stats = evidenceStats(items, NOW);
  assert.equal(stats.independent, 2);
  assert.equal(stats.duplicates, 3);
});

test('confidence rises with independent, diverse, intent-bearing evidence and is capped when thin', () => {
  const cand = { scores: allScores(3), trajectory: { stage: 'early_growth' } };
  const thin = evidenceConfidence(cand, [ev(1)], NOW);
  assert.ok(thin.score <= 30);
  const rich = evidenceConfidence(cand, [1, 2, 3, 4, 5, 6].map((i) => ev(i, { intent: i < 3 ? 'purchase' : 'curiosity' })), NOW);
  assert.ok(rich.score > thin.score);
  assert.ok(rich.adjustments.some((a) => a.includes('search-result')));
  const tenCopies = Array.from({ length: 10 }, (_, i) => ev(100 + i, { url: 'https://viral.com/post/1' }));
  const copies = evidenceConfidence(cand, tenCopies, NOW);
  assert.equal(copies.stats.independent, 1);
  assert.ok(copies.score <= 30);
});

test('test-now is gated: single viral post cannot qualify', () => {
  const cand = {
    scores: allScores(5),
    trajectory: { stage: 'early_growth' },
    recommendedAction: 'test_now',
    products: [{ theme: 't', leadTimeDays: 2, fulfillment: 'digital' }],
    rights: { risk: 'low' },
  };
  const one = actionGate(cand, [ev(1, { intent: 'purchase' })], { now: NOW });
  assert.notEqual(one.action, 'test_now');
  assert.ok(one.downgraded);
  const many = actionGate(cand, [1, 2, 3, 4, 5, 6].map((i) => ev(i, { intent: i < 3 ? 'purchase' : 'curiosity' })), { now: NOW });
  assert.equal(many.action, 'test_now');
});

test('test-now requires purchase intent evidence', () => {
  const cand = { scores: allScores(5), trajectory: { stage: 'early_growth' }, recommendedAction: 'test_now', products: [{ theme: 't', leadTimeDays: 2 }], rights: { risk: 'low' } };
  const r = actionGate(cand, [1, 2, 3, 4, 5, 6].map((i) => ev(i)), { now: NOW });
  assert.equal(r.action, 'prepare');
  assert.ok(r.reasons.some((x) => x.reason.includes('purchase')));
});

test('high rights risk and first-spark cap at watch; analyst pass is respected', () => {
  const base = { scores: allScores(5), recommendedAction: 'test_now', products: [{ theme: 't' }] };
  const evs = [1, 2, 3, 4, 5, 6].map((i) => ev(i, { intent: 'purchase' }));
  assert.equal(actionGate({ ...base, trajectory: { stage: 'early_growth' }, rights: { risk: 'high' } }, evs, { now: NOW }).action, 'watch');
  assert.equal(actionGate({ ...base, trajectory: { stage: 'first_spark' }, rights: { risk: 'low' } }, evs, { now: NOW }).action, 'watch');
  assert.equal(actionGate({ ...base, recommendedAction: 'pass', trajectory: { stage: 'early_growth' }, rights: { risk: 'low' } }, evs, { now: NOW }).action, 'pass');
});

test('product timing: POD adds delivery, digital does not, and no dated window means no verdict', () => {
  const prefs = { audience: 'none', podDeliveryDays: 10, discoveryDays: { none: 21, small: 10, large: 3 } };
  assert.equal(timeToBuyer({ leadTimeDays: 3, fulfillment: 'pod' }, prefs).total, 34);
  assert.equal(timeToBuyer({ leadTimeDays: 3, fulfillment: 'digital' }, prefs).total, 24);
  assert.equal(productWindowFit({ leadTimeDays: 3 }, { estimate: 'a few months' }, prefs, NOW).verdict, 'unknown');
  const halloween = { sellBy: '2026-10-31' };
  assert.equal(productWindowFit({ leadTimeDays: 2, fulfillment: 'pod' }, halloween, prefs, NOW).verdict, 'misses');
  assert.equal(productWindowFit({ leadTimeDays: 1, fulfillment: 'digital' }, halloween, { ...prefs, audience: 'large' }, NOW).verdict, 'fits');
});

test('snapshot diffs report only meaningful changes, and need two snapshots', () => {
  const a = { takenAt: '2026-10-01T00:00:00Z', score: 50, confidence: 40, stage: 'early_growth', action: 'prepare', competition: 'low', independentSources: 4, purchaseSignals: 1, windowEstimate: 'x' };
  const b = { ...a, takenAt: '2026-10-04T00:00:00Z', score: 53, confidence: 55, competition: 'high', action: 'test_now' };
  const d = diffSnapshots(a, b);
  assert.ok(!d.some((x) => x.field === 'score'));
  assert.ok(d.some((x) => x.field === 'confidence' && x.tone === 'good'));
  assert.ok(d.some((x) => x.field === 'competition' && x.tone === 'bad'));
  assert.ok(d.some((x) => x.field === 'action' && x.tone === 'good'));
  assert.equal(latestChanges([a]).comparable, false);
  assert.equal(latestChanges([b, a]).comparable, true);
});

test('topic normalization dedupes phrasing and tracking params', () => {
  assert.equal(normalizeTopic('  "Cozy  Gaming" ').key, normalizeTopic('cozy gaming').key);
  assert.equal(normalizeTopic('https://www.example.com/a/?utm_source=x').key, normalizeTopic('https://example.com/a').key);
  assert.equal(normalizeTopic('   '), null);
  assert.equal(slugify('Ägyptisch Café!'), 'agyptisch-cafe');
});

test('chartable series require same metric+unit, absolute values and 3+ dates', () => {
  const obs = [
    { metric: 'views', unit: 'count', value: 1, asOf: '2026-09-01', isAbsolute: true },
    { metric: 'views', unit: 'count', value: 2, asOf: '2026-09-08', isAbsolute: true },
    { metric: 'views', unit: 'count', value: 3, asOf: '2026-09-15', isAbsolute: true },
    { metric: 'interest', unit: 'relative', value: 80, asOf: '2026-09-15', isAbsolute: false },
  ];
  const s = chartableSeries(obs);
  assert.equal(s.length, 1);
  assert.equal(s[0].points.length, 3);
  assert.equal(chartableSeries(obs.slice(0, 2)).length, 0);
});

test('ingest drops unsupported evidence, remaps references and merges runs', () => {
  const raw = {
    lens: 'test',
    researchedAt: '2026-10-04T20:00:00Z',
    candidates: [
      {
        name: 'Example Trend',
        category: 'hobby',
        trajectory: { stage: 'early_growth', text: 't', evidence: ['e1', 'e9'] },
        scores: { timing: { score: 4, basis: 'qualitative' }, buyerIntent: { score: 7, basis: 'reported' } },
        recommendedAction: 'test_now',
        window: { estimate: 'Through winter', reasoning: '' },
        products: [{ theme: 'Tracker', format: 'printable', evidence: ['e2'] }],
        evidence: [
          ev(1),
          ev(2, { intent: 'purchase' }),
          ev(3, { url: 'not a url' }),
          ev(4, { url: 'https://www.site1.com/story-1?utm_source=a', claim: 'another claim' }),
          ev(5, { kind: undefined }),
        ],
        observations: [{ metric: 'members', value: 1000, unit: 'count', asOf: '2026-09-01', evidence: 'e1', isAbsolute: true }],
      },
    ],
  };
  const { docs, report } = ingestResearch(raw, { runId: 'run-a', now: NOW });
  const cand = docs.find((d) => d.path === 'candidates/example-trend').data;
  const evidence = docs.filter((d) => d.path.startsWith('evidence/')).map((d) => d.data);
  assert.equal(evidence.length, 3, 'invalid URL dropped and canonical duplicate merged');
  assert.ok(evidence.some((e) => e.claim.includes('another claim')));
  assert.equal(cand.scores.buyerIntent.score, null, 'out-of-range score becomes unknown');
  assert.equal(cand.window.estimate, null, 'window estimate without reasoning is dropped');
  assert.equal(cand.trajectory.evidence.length, 1, 'unknown reference removed');
  assert.ok(cand.products[0].evidence[0].startsWith('example-trend~'));
  assert.ok(evidence.find((e) => e.url.includes('site5')).kind === 'inference');
  assert.ok(docs.some((d) => d.path.startsWith('snapshots/')));
  assert.ok(docs.some((d) => d.path.startsWith('observations/')));
  assert.equal(report.candidates[0].status, 'created');

  // Second run: re-sees e1, adds a new source; e2 and e5 are carried as cached.
  const raw2 = { ...raw, researchedAt: '2026-10-06T20:00:00Z', candidates: [{ ...raw.candidates[0], evidence: [ev(1), ev(7)] }] };
  const existing = { candidates: new Map([['example-trend', cand]]), evidence };
  const second = ingestResearch(raw2, { runId: 'run-b', now: NOW + 2 * 86400000, existing });
  const ev2 = second.docs.filter((d) => d.path.startsWith('evidence/')).map((d) => d.data);
  const resee = ev2.find((e) => e.url.includes('site1'));
  assert.equal(resee.firstSeenRunId, 'run-a');
  assert.equal(resee.lastSeenRunId, 'run-b');
  assert.equal(ev2.find((e) => e.url.includes('site7')).firstSeenRunId, 'run-b');
  assert.equal(second.report.candidates[0].carried, 2);
  assert.equal(second.report.candidates[0].status, 'updated');
  const c2 = second.docs.find((d) => d.path === 'candidates/example-trend').data;
  assert.deepEqual(c2.runIds, ['run-a', 'run-b']);
});

test('assess combines score, confidence and gate', () => {
  const cand = { scores: allScores(4), trajectory: { stage: 'early_growth' }, recommendedAction: 'prepare', products: [{ theme: 'x', leadTimeDays: 2 }], rights: { risk: 'low' } };
  const a = assess(cand, [1, 2, 3].map((i) => ev(i)), {}, NOW);
  assert.equal(a.opportunity.score, 80);
  assert.equal(a.gate.action, 'prepare');
  assert.ok(['low', 'medium', 'high'].includes(a.confidence.band));
});

test('job planning: cached match, duplicates, limits', async () => {
  const { planJob, findTopicMatch } = await import('../src/data/jobs.js');
  const recent = new Date(NOW - 3600000).toISOString();
  const ix = {
    candidates: [{ id: 'm', name: 'American mahjong boom', topicKeys: [normalizeTopic('American mahjong boom').key], researchedAt: recent }],
    jobs: [],
  };
  assert.equal(findTopicMatch(normalizeTopic('Mahjong'), ix.candidates).id, 'm');
  assert.equal(findTopicMatch(normalizeTopic('chess'), ix.candidates), null);
  assert.equal(planJob({ type: 'analyze', input: 'mahjong' }, ix, undefined, NOW).kind, 'cached');
  assert.equal(planJob({ type: 'analyze', input: 'mahjong', force: true }, ix, undefined, NOW).kind, 'ok');
  assert.equal(planJob({ type: 'analyze', input: '  ' }, ix, undefined, NOW).kind, 'invalid');
  const queued = planJob({ type: 'analyze', input: 'chess boxing' }, ix, undefined, NOW).job;
  const ix2 = { ...ix, jobs: [queued] };
  assert.equal(planJob({ type: 'analyze', input: 'Chess  Boxing' }, ix2, undefined, NOW).kind, 'duplicate');
  const many = { ...ix, jobs: [1, 2, 3].map((i) => ({ ...queued, key: `k${i}`, topicKey: `t${i}`, status: 'running' })) };
  assert.equal(planJob({ type: 'discover' }, many, undefined, NOW).kind, 'limit');
});
