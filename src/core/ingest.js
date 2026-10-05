// Ingestion: validate a research result and turn it into stored documents.
// Research output is untrusted input. Anything that breaks the evidence rules is
// dropped or downgraded here, with a note the user can see.

import { ACTIONS, CATEGORIES, COMPETITION, CRITERIA, FORMATS, INTENTS, SIGNAL_TYPES, STAGES, ACCESS_METHODS } from './constants.js';
import { canonicalUrl } from './evidence.js';
import { normalizeTopic, safeId } from './normalize.js';
import { assess } from './scoring.js';
import { makeSnapshot } from './changes.js';
import { cleanPlaybookProduct, themeKey } from './playbook.js';

const MAX = { short: 200, text: 2000, list: 30 };
const EFFORTS = ['low', 'medium', 'high'];
const FULFILLMENT = ['digital', 'pod'];
const BASES = ['measured', 'reported', 'qualitative', 'unknown'];
const KINDS = ['observed', 'inference'];

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const str = (v, max = MAX.text) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = MAX.list, len = MAX.short) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const isHttp = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+\.[^\s]+/i.test(u.trim());
const isoDate = (v) => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? v.trim().slice(0, 25) : null;
};
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

function cleanEvidence(e, warn) {
  if (!e || typeof e !== 'object') return null;
  if (!isHttp(e.url)) {
    warn(`Dropped evidence "${str(e.title, 80) || e.id}" with no valid URL.`);
    return null;
  }
  const claim = str(e.claim, 600);
  if (!claim) {
    warn(`Dropped evidence ${e.url} with no stated claim.`);
    return null;
  }
  const retrievedAt = isoDate(e.retrievedAt);
  if (!retrievedAt) {
    warn(`Dropped evidence ${e.url} with no retrieval time.`);
    return null;
  }
  let kind = e.kind;
  if (!KINDS.includes(kind)) {
    kind = 'inference';
    warn(`Evidence ${e.url} had no observed/inference label; treated as inference.`);
  }
  return {
    localId: str(e.id, 40) || null,
    url: e.url.trim().slice(0, 1000),
    title: str(e.title, 300),
    publisher: str(e.publisher, 120),
    publishedAt: isoDate(e.publishedAt),
    retrievedAt,
    accessMethod: oneOf(e.accessMethod, Object.keys(ACCESS_METHODS), 'web_search_result'),
    signalType: oneOf(e.signalType, Object.keys(SIGNAL_TYPES), 'press'),
    intent: oneOf(e.intent, Object.keys(INTENTS), 'none'),
    claim,
    kind,
    syndicationOfLocal: str(e.syndicationOf, 40) || null,
    excerpt: str(e.excerpt, 600),
  };
}

function cleanScores(raw, warn) {
  const out = {};
  for (const c of CRITERIA) {
    const s = raw?.[c.key] || {};
    let score = s.score === null || s.score === undefined || s.score === '' ? null : Number(s.score);
    let basis = oneOf(s.basis, BASES, score === null ? 'unknown' : 'qualitative');
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 5)) {
      warn(`${c.label} score "${s.score}" is outside 0–5; marked not assessed.`);
      score = null;
    }
    if (score !== null) score = Math.round(score);
    if (basis === 'unknown') score = null;
    if (score === null) basis = 'unknown';
    out[c.key] = { score, basis, rationale: str(s.rationale, 800) };
  }
  return out;
}

function cleanProduct(p, warn, refMap) {
  if (!p || typeof p !== 'object') return null;
  const theme = str(p.theme, 400);
  if (!theme) {
    warn('Dropped a product suggestion with no theme.');
    return null;
  }
  const lead = Number(p.leadTimeDays);
  const hours = Number(p.effortHours);
  return {
    buyer: str(p.buyer, 300),
    format: oneOf(p.format, Object.keys(FORMATS), 'other'),
    theme,
    whyBuy: str(p.whyBuy, 600),
    evidence: mapRefs(p.evidence, refMap, warn),
    differentiation: str(p.differentiation, 600),
    channels: strList(p.channels, 8, 40),
    effort: oneOf(p.effort, EFFORTS, 'medium'),
    effortHours: Number.isFinite(hours) && hours >= 0 ? Math.round(hours) : null,
    leadTimeDays: Number.isFinite(lead) && lead >= 0 ? Math.round(lead) : null,
    fulfillment: oneOf(p.fulfillment, FULFILLMENT, 'digital'),
    validationTest: str(p.validationTest, 600),
    continueIf: str(p.continueIf, 400),
    pivotIf: str(p.pivotIf, 400),
    stopIf: str(p.stopIf, 400),
    rightsNote: str(p.rightsNote, 400),
  };
}

function mapRefs(refs, refMap, warn) {
  if (!Array.isArray(refs)) return [];
  const out = [];
  for (const r of refs) {
    const id = refMap.get(String(r));
    if (id) {
      if (!out.includes(id)) out.push(id);
    } else {
      warn(`Removed a reference to unknown evidence "${String(r).slice(0, 40)}".`);
    }
  }
  return out;
}

function section(raw, refMap, warn, extra = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return { text: str(s.text, MAX.text), evidence: mapRefs(s.evidence, refMap, warn), ...extra };
}

/**
 * Validate and normalize one research result (the shape in research/AGENT_BRIEF.md).
 * `existing` lets a refresh merge with what is already stored:
 *   { candidates: Map<id, doc>, evidence: Array<doc>, snapshots: Array<doc> }
 * Returns { docs: [{ path, data }], report }.
 */
export function ingestResearch(raw, { runId, now = Date.now(), jobId = null, existing = {}, settings = {} } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Research result is not an object.');
  if (!runId) throw new Error('runId is required.');
  const nowIso = new Date(now).toISOString();
  const docs = [];
  const report = { runId, candidates: [], warnings: [] };
  const existingCandidates = existing.candidates || new Map();
  const existingEvidence = existing.evidence || [];

  const candidates = Array.isArray(raw.candidates) ? raw.candidates.slice(0, 12) : [];
  for (const rc of candidates) {
    const warnings = [];
    const warn = (m) => warnings.push(m);
    const name = str(rc?.name, 120);
    if (!name) {
      report.warnings.push('Skipped a candidate with no name.');
      continue;
    }
    const id = safeId(name);
    const prior = existingCandidates.get(id) || null;

    // Evidence: clean, then merge duplicates by canonical URL within this result.
    const cleaned = (Array.isArray(rc.evidence) ? rc.evidence : []).map((e) => cleanEvidence(e, warn)).filter(Boolean);
    const byCanon = new Map();
    const refMap = new Map();
    for (const e of cleaned) {
      const canon = canonicalUrl(e.url);
      const docId = `${id}~${fnv1a(canon)}`;
      if (e.localId) refMap.set(e.localId, docId);
      if (byCanon.has(canon)) {
        const prev = byCanon.get(canon);
        if (!prev.claim.includes(e.claim)) prev.claim = `${prev.claim} / ${e.claim}`.slice(0, 1200);
        if (e.intent === 'purchase') prev.intent = 'purchase';
        continue;
      }
      byCanon.set(canon, { ...e, docId, canon });
    }
    if (byCanon.size === 0) {
      report.candidates.push({ id, name, status: 'rejected', errors: ['No usable evidence with a URL, claim and retrieval time.'], warnings });
      continue;
    }

    const evidenceDocs = [];
    for (const e of byCanon.values()) {
      const before = existingEvidence.find((x) => x.id === e.docId);
      const synd = e.syndicationOfLocal ? refMap.get(e.syndicationOfLocal) || null : null;
      const data = {
        id: e.docId,
        candidateId: id,
        url: e.url,
        title: e.title,
        publisher: e.publisher,
        publishedAt: e.publishedAt,
        retrievedAt: e.retrievedAt,
        accessMethod: e.accessMethod,
        signalType: e.signalType,
        intent: e.intent,
        claim: e.claim,
        kind: e.kind,
        syndicationOf: synd && synd !== e.docId ? synd : null,
        excerpt: e.excerpt,
        firstSeenRunId: before?.firstSeenRunId || runId,
        lastSeenRunId: runId,
        firstRetrievedAt: before?.firstRetrievedAt || before?.retrievedAt || e.retrievedAt,
      };
      evidenceDocs.push(data);
      docs.push({ path: `evidence/${e.docId}`, data });
    }

    const stage = oneOf(rc.trajectory?.stage, Object.keys(STAGES), 'insufficient_evidence');
    if (rc.trajectory?.stage && stage !== rc.trajectory.stage) warn(`Unknown stage "${rc.trajectory.stage}"; set to insufficient evidence.`);
    let action = rc.recommendedAction;
    if (!ACTIONS[action]) {
      warn(`Unknown action "${action}"; set to watch.`);
      action = 'watch';
    }

    let pairs = (Array.isArray(rc.products) ? rc.products : []).map((p) => ({ raw: p, clean: cleanProduct(p, warn, refMap) })).filter((x) => x.clean);
    if (pairs.length > 3) {
      warn('More than three products suggested; kept the first three.');
      pairs = pairs.slice(0, 3);
    }
    const products = pairs.map((x) => x.clean);

    const w = rc.window && typeof rc.window === 'object' ? rc.window : {};
    let estimate = str(w.estimate, 300) || null;
    const reasoning = str(w.reasoning, 1200);
    const invalidators = strList(w.invalidators, 8, 300);
    if (estimate && !reasoning) {
      warn('Dropped an entry-window estimate that had no reasoning.');
      estimate = null;
    }
    if (estimate && invalidators.length === 0) warn('Entry-window estimate does not say what would invalidate it.');

    const aliases = strList(rc.aliases, 10, 80);
    const topicKeys = [name, ...aliases].map((t) => normalizeTopic(t)?.key).filter(Boolean);
    const formats = [...new Set(products.map((p) => p.format))];
    const channels = [...new Set(products.flatMap((p) => p.channels))];
    const efforts = products.map((p) => EFFORTS.indexOf(p.effort)).filter((i) => i >= 0);

    const candidate = {
      id,
      name,
      aliases,
      topicKeys,
      category: oneOf(rc.category, Object.keys(CATEGORIES), 'other'),
      summary: str(rc.summary, 400),
      what: str(rc.what, MAX.text),
      origin: section(rc.origin, refMap, warn, { date: isoDate(rc.origin?.date) }),
      adopters: section(rc.adopters, refMap, warn),
      spread: section(rc.spread, refMap, warn),
      trajectory: section(rc.trajectory, refMap, warn, { stage }),
      productDemand: section(rc.productDemand, refMap, warn),
      competition: section(rc.competition, refMap, warn, { level: oneOf(rc.competition?.level, Object.keys(COMPETITION), 'unknown') }),
      gap: { text: str(rc.gap?.text, MAX.text), isInference: rc.gap?.isInference !== false },
      window: {
        estimate,
        reasoning,
        invalidators,
        seasonality: str(w.seasonality, 400),
        sellBy: isoDate(w.sellBy),
        endEstimate: estimate ? isoDate(w.endEstimate) : null,
      },
      rights: { risk: oneOf(rc.rights?.risk, ['low', 'medium', 'high'], 'medium'), note: str(rc.rights?.note, 600) },
      scores: cleanScores(rc.scores, warn),
      recommendedAction: action,
      actionRationale: str(rc.actionRationale, 1200),
      products,
      unresolved: strList(rc.unresolved, 12, 400),
      formats,
      channels,
      effortMin: efforts.length ? EFFORTS[Math.min(...efforts)] : null,
      region: str(rc.region, 20) || 'US',
      language: 'en',
      lens: str(raw.lens, 60),
      source: raw.demo === true ? 'demo' : 'research',
      researchedAt: str(raw.researchedAt, 30) || nowIso,
      lastRunId: runId,
      runIds: [...new Set([...(prior?.runIds || []), runId])].slice(-50),
      firstSeenAt: prior?.firstSeenAt || nowIso,
      jobId,
      qualityFlags: warnings.slice(0, 30),
      editorialNotes: strList(rc.editorialNotes, 40, 400),
    };
    // An editor's merge survives later refreshes of the duplicate.
    if (prior?.duplicateOf) Object.assign(candidate, { duplicateOf: prior.duplicateOf, duplicateNote: prior.duplicateNote || '' });
    docs.push({ path: `candidates/${id}`, data: candidate });

    // Make-and-sell playbooks written alongside the research (optional).
    const playbookProducts = pairs
      .map((x, i) => (x.raw && x.raw.playbook ? cleanPlaybookProduct({ ...x.raw.playbook, index: i, themeKey: themeKey(x.clean.theme), source: 'worker' }) : null))
      .filter(Boolean);
    if (playbookProducts.length) {
      docs.push({ path: `playbooks/${id}`, data: { id, candidateId: id, products: playbookProducts, writtenAt: candidate.researchedAt, source: 'worker', runId } });
    }

    // Observations: only numeric, dated, attributed to evidence we kept.
    for (const o of Array.isArray(rc.observations) ? rc.observations : []) {
      const ev = refMap.get(String(o?.evidence));
      const value = Number(o?.value);
      const asOf = isoDate(o?.asOf);
      if (!ev || !Number.isFinite(value) || !asOf || !str(o?.metric)) {
        warn('Dropped an observation without a value, date, metric or supporting evidence.');
        continue;
      }
      const metric = str(o.metric, 120);
      const unit = str(o.unit, 40);
      const oid = `${id}~${fnv1a(`${metric}|${unit}|${asOf}|${value}`)}`;
      docs.push({
        path: `observations/${oid}`,
        data: { id: oid, candidateId: id, metric, unit, value, asOf, evidenceId: ev, isAbsolute: o.isAbsolute === true, note: str(o.note, 300), runId, recordedAt: nowIso },
      });
    }

    // Merge evidence from earlier runs that this run did not re-see (kept as cached findings).
    const carried = existingEvidence.filter((x) => x.candidateId === id && !evidenceDocs.some((d) => d.id === x.id));
    const allEvidence = [...evidenceDocs, ...carried];
    const assessment = assess(candidate, allEvidence, settings, now);
    const snapId = `${id}~${safeId(runId)}`;
    docs.push({
      path: `snapshots/${snapId}`,
      data: { id: snapId, ...makeSnapshot({ candidate, assessment, runId, takenAt: candidate.researchedAt, weights: settings.weights || null }) },
    });

    report.candidates.push({
      id,
      name,
      status: prior ? 'updated' : 'created',
      warnings,
      errors: [],
      evidence: evidenceDocs.length,
      carried: carried.length,
      score: assessment.opportunity.score,
      confidence: assessment.confidence.score,
      action: assessment.gate.action,
    });
  }

  const runDoc = {
    id: runId,
    jobId,
    lens: str(raw.lens, 60),
    kind: str(raw.kind, 20) || 'research',
    researchedAt: str(raw.researchedAt, 30) || nowIso,
    ingestedAt: nowIso,
    sourcesTried: (Array.isArray(raw.sourcesTried) ? raw.sourcesTried : []).slice(0, 30).map((s) => ({
      source: str(s?.source, 80),
      method: str(s?.method, 40),
      status: oneOf(s?.status, ['ok', 'blocked', 'error', 'not_tried', 'unavailable', 'partial'], 'error'),
      note: str(s?.note, 300),
    })),
    discovered: (Array.isArray(raw.discovered) ? raw.discovered : []).slice(0, 40).map((d) => ({
      name: str(d?.name, 120),
      whyConsidered: str(d?.whyConsidered, 400),
      disposition: str(d?.disposition, 30),
      rejectReason: str(d?.rejectReason, 400),
    })),
    candidateIds: report.candidates.filter((c) => c.status !== 'rejected').map((c) => c.id),
    report: report.candidates.map(({ id, name, status, errors, warnings }) => ({ id, name, status, errors, warnings: warnings.length })),
  };
  docs.push({ path: `runs/${safeId(runId)}`, data: runDoc });
  report.run = runDoc;
  return { docs, report };
}
