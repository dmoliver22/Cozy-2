// Opportunity scoring, evidence confidence, action gates and product timing.
// These are decision heuristics, not a validated predictor of profit.
// Two invariants: missing evidence never raises a score, and confidence is kept
// separate from the opportunity score.

import { ACTIONS, ACTION_BY_RANK, BASIS, CRITERIA, DEFAULT_PREFERENCES, DEFAULT_WEIGHTS, STAGES } from './constants.js';
import { evidenceStats } from './evidence.js';

const DAY = 86400000;

export function normalizeWeights(weights = DEFAULT_WEIGHTS) {
  const raw = CRITERIA.map((c) => Math.max(0, Number(weights?.[c.key] ?? c.weight) || 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out = {};
  CRITERIA.forEach((c, i) => {
    out[c.key] = sum > 0 ? (raw[i] / sum) * 100 : 100 / CRITERIA.length;
  });
  return out;
}

function criterionValue(entry) {
  if (!entry || entry.score === null || entry.score === undefined || entry.basis === 'unknown') return null;
  const n = Number(entry.score);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(0, n));
}

/**
 * Weighted 0–100 opportunity score. Unassessed criteria contribute zero,
 * so filling in evidence can only move a score in the direction the evidence points.
 */
export function opportunityScore(scores = {}, weights = DEFAULT_WEIGHTS) {
  const w = normalizeWeights(weights);
  let total = 0;
  const breakdown = CRITERIA.map((c) => {
    const entry = scores[c.key] || {};
    const value = criterionValue(entry);
    const contribution = value === null ? 0 : (value / 5) * w[c.key];
    total += contribution;
    return {
      key: c.key,
      label: c.label,
      weight: w[c.key],
      value,
      basis: value === null ? 'unknown' : entry.basis || 'qualitative',
      rationale: entry.rationale || '',
      contribution,
      // What this criterion could add if it were assessed at the maximum.
      upside: value === null ? w[c.key] : 0,
    };
  });
  const unassessed = breakdown.filter((b) => b.value === null).map((b) => b.key);
  const criticalMissing = unassessed.filter((k) => k === 'timing' || k === 'buyerIntent');
  return {
    score: Math.round(total),
    breakdown,
    unassessed,
    provisional: criticalMissing.length > 0 || unassessed.length >= 2,
    ceiling: Math.round(total + breakdown.reduce((a, b) => a + b.upside, 0)),
  };
}

/**
 * Evidence confidence 0–100, computed only from the evidence and how criteria were assessed.
 * Every factor is shown to the user, so keep them simple and explainable.
 */
export function evidenceConfidence(candidate, evidence, now = Date.now()) {
  const stats = evidenceStats(evidence, now);
  const scores = candidate?.scores || {};
  const coverage =
    CRITERIA.reduce((acc, c) => {
      const v = criterionValue(scores[c.key]);
      const basis = v === null ? 'unknown' : scores[c.key]?.basis || 'qualitative';
      return acc + (BASIS[basis]?.weight ?? 0);
    }, 0) / CRITERIA.length;
  const purchase = stats.intents.purchase;
  const dated = stats.independent - stats.undated;
  const factors = [
    {
      key: 'independence',
      label: 'Independent sources',
      weight: 0.3,
      value: Math.min(stats.independent / 6, 1),
      detail: `${stats.independent} independent of ${stats.total} items${stats.duplicates ? ` (${stats.duplicates} duplicates merged)` : ''}; 6+ counts as full`,
    },
    {
      key: 'diversity',
      label: 'Signal diversity',
      weight: 0.15,
      value: Math.min(stats.signalTypes.length / 4, 1),
      detail: `${stats.signalTypes.length} signal type${stats.signalTypes.length === 1 ? '' : 's'}; 4+ counts as full`,
    },
    {
      key: 'recency',
      label: 'Recent evidence',
      weight: 0.15,
      value: stats.independent ? (stats.recent + stats.undated * 0.25) / stats.independent : 0,
      detail: `${stats.recent} of ${dated} dated sources from the last 45 days${stats.undated ? `; ${stats.undated} undated` : ''}`,
    },
    {
      key: 'intent',
      label: 'Purchase-intent evidence',
      weight: 0.2,
      value: purchase >= 2 ? 1 : purchase === 1 ? 0.5 : 0,
      detail: `${purchase} independent source${purchase === 1 ? '' : 's'} showing buying behavior`,
    },
    {
      key: 'coverage',
      label: 'Criteria coverage',
      weight: 0.2,
      value: coverage,
      detail: 'Measured counts 1, reported 0.8, judgment 0.5, not assessed 0',
    },
  ];
  let score = factors.reduce((acc, f) => acc + f.weight * f.value, 0) * 100;
  const adjustments = [];
  if (stats.searchOnly) {
    score *= 0.85;
    adjustments.push('All evidence came from search-result summaries; pages were not fetched directly (×0.85).');
  }
  if (stats.independent < 2) {
    score = Math.min(score, 30);
    adjustments.push('Fewer than two independent sources (capped at 30).');
  }
  if (candidate?.trajectory?.stage === 'insufficient_evidence') {
    score = Math.min(score, 35);
    adjustments.push('Stage is "insufficient evidence" (capped at 35).');
  }
  score = Math.round(score);
  return { score, band: confidenceBand(score), factors, adjustments, stats };
}

export function confidenceBand(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function discoveryDays(prefs = DEFAULT_PREFERENCES) {
  const map = { ...DEFAULT_PREFERENCES.discoveryDays, ...(prefs.discoveryDays || {}) };
  return map[prefs.audience || 'none'] ?? map.none;
}

/**
 * Days from today until a first buyer could plausibly have the product:
 * build time + time for a new listing to be discovered + delivery for POD.
 */
export function timeToBuyer(product, prefs = DEFAULT_PREFERENCES) {
  const build = Math.max(0, Number(product?.leadTimeDays) || 0);
  const discovery = discoveryDays(prefs);
  const delivery = product?.fulfillment === 'pod' ? Number(prefs.podDeliveryDays ?? DEFAULT_PREFERENCES.podDeliveryDays) : 0;
  return { build, discovery, delivery, total: build + discovery + delivery };
}

/**
 * Compare a product's time-to-buyer against the trend's window.
 * Only uses a dated window when research supplied one (`window.sellBy` for a fixed
 * deadline such as a holiday, or `window.endEstimate` for an estimate). No date, no verdict.
 */
export function productWindowFit(product, window, prefs = DEFAULT_PREFERENCES, now = Date.now()) {
  const ttb = timeToBuyer(product, prefs);
  const deadline = window?.sellBy || window?.endEstimate || null;
  const t = deadline ? Date.parse(deadline) : NaN;
  if (!Number.isFinite(t)) return { ...ttb, verdict: 'unknown', remaining: null, deadline: null, estimated: false };
  const remaining = Math.floor((t - now) / DAY);
  let verdict = 'fits';
  if (ttb.total > remaining) verdict = 'misses';
  else if (ttb.total > remaining - 7) verdict = 'tight';
  return { ...ttb, verdict, remaining, deadline, estimated: !window?.sellBy };
}

/**
 * The analyst recommends an action; these gates cap it. "Test now" needs demand evidence,
 * a credible product, a live stage, enough independent sources and enough time to reach buyers.
 */
export function actionGate(candidate, evidence, opts = {}) {
  const { prefs = DEFAULT_PREFERENCES, now = Date.now(), confidence } = opts;
  const conf = confidence || evidenceConfidence(candidate, evidence, now);
  const stats = conf.stats;
  const scores = candidate?.scores || {};
  const v = (k) => criterionValue(scores[k]);
  const analyst = ACTIONS[candidate?.recommendedAction] ? candidate.recommendedAction : 'watch';
  const stage = candidate?.trajectory?.stage || 'insufficient_evidence';
  const products = candidate?.products || [];
  const fits = products.map((p) => productWindowFit(p, candidate?.window, prefs, now));
  const reasons = [];
  let cap = ACTIONS.test_now.rank;
  const capAt = (action, reason) => {
    reasons.push({ cap: action, reason });
    cap = Math.min(cap, ACTIONS[action].rank);
  };

  // Test-now requirements.
  if (!(v('buyerIntent') >= 3)) capAt('prepare', 'Buyer intent is below 3 of 5 or not assessed.');
  if (stats.intents.purchase < 1) capAt('prepare', 'No independent source shows purchase intent.');
  if (!(v('productFit') >= 3) || products.length === 0) capAt('prepare', 'No credible product angle yet.');
  if (!(v('timing') >= 3)) capAt('prepare', 'Entry timing is below 3 of 5 or not assessed.');
  if (!['early_growth', 'mainstream_surge', 'established_niche'].includes(stage))
    capAt('prepare', `Stage "${STAGES[stage]?.label || stage}" is not a launch stage.`);
  if (stats.independent < 3) capAt('prepare', 'Fewer than three independent sources; a single viral moment is not enough.');
  if (conf.score < 40) capAt('prepare', 'Evidence confidence is low.');
  if (fits.length && fits.every((f) => f.verdict === 'misses'))
    capAt('prepare', 'No suggested product can reach buyers before the window closes.');

  // Harder caps.
  if (stage === 'first_spark' || stage === 'insufficient_evidence') capAt('watch', 'Not enough validation to commit effort.');
  if (conf.score < 25) capAt('watch', 'Evidence confidence is very low.');
  if (candidate?.rights?.risk === 'high') capAt('watch', 'High rights risk on names, likenesses or slogans.');
  if (stage === 'declining' && !(v('timing') >= 2)) capAt('pass', 'Declining and the entry window has largely passed.');

  const rank = Math.min(ACTIONS[analyst].rank, cap);
  const action = ACTION_BY_RANK[rank];
  return {
    action,
    analyst,
    downgraded: action !== analyst,
    reasons,
    productFits: fits,
  };
}

/** Everything the UI needs about one candidate, derived from stored research + settings. */
export function assess(candidate, evidence, settings = {}, now = Date.now()) {
  const prefs = { ...DEFAULT_PREFERENCES, ...(settings.preferences || {}) };
  const weights = settings.weights || DEFAULT_WEIGHTS;
  const opp = opportunityScore(candidate?.scores, weights);
  const confidence = evidenceConfidence(candidate, evidence, now);
  const gate = actionGate(candidate, evidence, { prefs, now, confidence });
  const provisional = opp.provisional || confidence.band === 'low';
  return { opportunity: opp, confidence, gate, provisional };
}

/** Sort key: action first, then opportunity score, then confidence. */
export function rankCompare(a, b) {
  const ra = ACTIONS[a.gate.action].rank;
  const rb = ACTIONS[b.gate.action].rank;
  if (ra !== rb) return rb - ra;
  if (a.opportunity.score !== b.opportunity.score) return b.opportunity.score - a.opportunity.score;
  return b.confidence.score - a.confidence.score;
}
