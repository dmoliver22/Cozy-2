// Watchlist change tracking. Changes are only ever computed between two stored
// snapshots; with fewer than two there is nothing to compare and we say so.

import { ACTIONS, COMPETITION, COMPETITION_ORDER, STAGES } from './constants.js';

export function makeSnapshot({ candidate, assessment, runId, takenAt, weights }) {
  return {
    candidateId: candidate.id,
    runId,
    takenAt,
    score: assessment.opportunity.score,
    confidence: assessment.confidence.score,
    stage: candidate.trajectory?.stage || 'insufficient_evidence',
    action: assessment.gate.action,
    analystAction: candidate.recommendedAction || null,
    competition: candidate.competition?.level || 'unknown',
    independentSources: assessment.confidence.stats.independent,
    purchaseSignals: assessment.confidence.stats.intents.purchase,
    windowEstimate: candidate.window?.estimate || null,
    weightsUsed: weights || null,
  };
}

const THRESHOLDS = { score: 5, confidence: 10, independentSources: 2, purchaseSignals: 1 };

export function diffSnapshots(prev, curr) {
  if (!prev || !curr) return [];
  const out = [];
  const num = (field, label, goodWhenUp = true) => {
    const a = Number(prev[field]);
    const b = Number(curr[field]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const d = b - a;
    if (Math.abs(d) >= THRESHOLDS[field]) {
      out.push({ field, label, from: a, to: b, delta: d, tone: d > 0 === goodWhenUp ? 'good' : 'bad' });
    }
  };
  num('score', 'Opportunity score');
  num('confidence', 'Evidence confidence');
  num('independentSources', 'Independent sources');
  num('purchaseSignals', 'Purchase-intent sources');
  if (prev.stage !== curr.stage) {
    const tone = curr.stage === 'declining' || curr.stage === 'insufficient_evidence' ? 'bad' : 'neutral';
    out.push({ field: 'stage', label: 'Lifecycle stage', from: STAGES[prev.stage]?.label || prev.stage, to: STAGES[curr.stage]?.label || curr.stage, tone });
  }
  if (prev.action !== curr.action) {
    const tone = (ACTIONS[curr.action]?.rank ?? 0) > (ACTIONS[prev.action]?.rank ?? 0) ? 'good' : 'bad';
    out.push({ field: 'action', label: 'Recommended action', from: ACTIONS[prev.action]?.label || prev.action, to: ACTIONS[curr.action]?.label || curr.action, tone });
  }
  if (prev.competition !== curr.competition) {
    const a = COMPETITION_ORDER.indexOf(prev.competition);
    const b = COMPETITION_ORDER.indexOf(curr.competition);
    const tone = a < 0 || b < 0 ? 'neutral' : b > a ? 'bad' : 'good';
    out.push({ field: 'competition', label: 'Competition', from: COMPETITION[prev.competition]?.label || prev.competition, to: COMPETITION[curr.competition]?.label || curr.competition, tone });
  }
  if ((prev.windowEstimate || '') !== (curr.windowEstimate || '')) {
    out.push({ field: 'window', label: 'Entry window estimate', from: prev.windowEstimate || 'None', to: curr.windowEstimate || 'None', tone: 'neutral' });
  }
  return out;
}

/** Latest change for a candidate from its stored snapshots (any order). */
export function latestChanges(snapshots) {
  const sorted = [...(snapshots || [])].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  if (sorted.length < 2) return { comparable: false, count: sorted.length, changes: [], prev: null, curr: sorted[0] || null };
  const prev = sorted[sorted.length - 2];
  const curr = sorted[sorted.length - 1];
  return { comparable: true, count: sorted.length, changes: diffSnapshots(prev, curr), prev, curr };
}
