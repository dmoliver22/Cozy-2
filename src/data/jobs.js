// Research jobs: submission with duplicate prevention, caching and limits; stall
// detection; and ingestion of finished research from the inbox.

import { normalizeTopic, newId } from '../core/normalize.js';
import { ingestResearch } from '../core/ingest.js';
import { DEFAULT_PREFERENCES } from '../core/constants.js';

export const ACTIVE = ['queued', 'running'];
const MIN = 60000;

export const JOB_TYPES = {
  discover: 'Discover trends',
  analyze: 'Analyze a topic',
  refresh: 'Refresh research',
};

/**
 * Decide what to do with a request before writing anything.
 * Returns one of:
 *   { kind: 'invalid', message }
 *   { kind: 'duplicate', job }            same topic already queued or running
 *   { kind: 'cached', candidate, ageH }   researched recently; caller may force
 *   { kind: 'limit', message }            too many active jobs
 *   { kind: 'ok', job }                   a job document ready to write
 */
export function planJob({ type, input, candidateId = null, force = false }, ix, prefs = DEFAULT_PREFERENCES, now = Date.now()) {
  const maxActive = prefs.maxActiveJobs ?? DEFAULT_PREFERENCES.maxActiveJobs;
  const cacheHours = prefs.cacheHours ?? DEFAULT_PREFERENCES.cacheHours;
  let topic = null;
  if (type === 'analyze' || type === 'refresh') {
    topic = normalizeTopic(input);
    if (!topic) return { kind: 'invalid', message: 'Enter a phrase or a full URL starting with https://.' };
  } else if (type !== 'discover') {
    return { kind: 'invalid', message: `Unknown job type "${type}".` };
  }
  const key = type === 'discover' ? 'discover' : `${type === 'refresh' ? 'refresh' : 'topic'}:${topic.key}`;
  const dupe = ix.jobs.find((j) => ACTIVE.includes(j.status) && (j.key === key || (topic && j.topicKey === topic.key)));
  if (dupe) return { kind: 'duplicate', job: dupe };

  if (type === 'analyze' && !force) {
    const match = findTopicMatch(topic, ix.candidates);
    if (match) {
      const ageH = (now - Date.parse(match.researchedAt || 0)) / 3600000;
      if (ageH < cacheHours) return { kind: 'cached', candidate: match, ageH };
    }
  }
  const active = ix.jobs.filter((j) => ACTIVE.includes(j.status)).length;
  if (active >= maxActive) return { kind: 'limit', message: `${active} research jobs are already in progress. Wait for one to finish or cancel one.` };

  const iso = new Date(now).toISOString();
  const job = {
    id: newId(type),
    type,
    input: type === 'discover' ? 'Scan for new trends' : topic.display,
    inputKind: topic ? topic.kind : null,
    topicKey: topic ? topic.key : null,
    key,
    candidateId,
    status: 'queued',
    createdAt: iso,
    updatedAt: iso,
    steps: [{ label: 'Queued', status: 'done', at: iso }],
    progress: 'Waiting for the research worker',
    dispatch: { status: 'pending', at: iso },
    result: null,
    error: null,
  };
  return { kind: 'ok', job };
}

const tokens = (key) => key.replace(/^(phrase|url):/, '').split(/[\s/]+/).filter((t) => t.length >= 3);

/**
 * A stored candidate that already covers this topic: an exact key match, or every
 * meaningful word of the request appearing in one of the candidate's names.
 */
export function findTopicMatch(topic, candidates) {
  if (!topic) return null;
  const exact = candidates.find((c) => (c.topicKeys || []).includes(topic.key));
  if (exact || topic.kind !== 'phrase') return exact || null;
  const want = tokens(topic.key);
  if (!want.length) return null;
  return candidates.find((c) => (c.topicKeys || []).some((k) => {
    const have = new Set(tokens(k));
    return want.every((t) => have.has(t));
  })) || null;
}

/** Flags for jobs that look stuck. Only advisory; nothing is changed automatically. */
export function jobHealth(job, now = Date.now()) {
  const updated = Date.parse(job.updatedAt || job.createdAt || 0);
  const age = now - updated;
  if (job.status === 'queued') {
    if (job.dispatch?.status === 'not_connected') return { state: 'waiting', note: 'No research worker is connected. The job will run when a worker processes the queue.' };
    if (job.dispatch?.status === 'failed') return { state: 'dispatch_failed', note: job.dispatch.message || 'Could not start the research worker.' };
    if (age > 20 * MIN) return { state: 'stalled', note: 'Not picked up after 20 minutes. The worker may not have started.' };
    return { state: 'ok', note: '' };
  }
  if (job.status === 'running' && age > 45 * MIN) return { state: 'stalled', note: 'No progress for 45 minutes. The worker may have stopped.' };
  return { state: 'ok', note: '' };
}

/**
 * Ingest one inbox document (raw research written by the worker) into stored records.
 * Uses a short lease so two open dashboards don't ingest the same result twice.
 */
export async function ingestInboxItem(store, item, ix, settings, holder) {
  if (!item || item.status !== 'new') return null;
  const path = `inbox/${item.id}`;
  const got = await store.acquire(path, holder, 120000);
  if (!got) return null;
  const fresh = store.get().inbox.find((x) => x.id === item.id);
  if (!fresh || fresh.status !== 'new') return null;
  const existing = {
    // Every stored record, including merged duplicates, so a refresh never drops an editor's merge.
    candidates: new Map((ix.allCandidates || ix.candidates).map((c) => [c.id, c])),
    evidence: [...ix.evidenceBy.values()].flat(),
  };
  let result;
  try {
    const raw = typeof fresh.raw === 'string' ? JSON.parse(fresh.raw) : fresh.raw;
    result = ingestResearch(raw, { runId: fresh.runId || fresh.id, jobId: fresh.jobId || null, existing, settings });
  } catch (e) {
    await store.update(path, { status: 'rejected', processedAt: new Date().toISOString(), error: String(e.message || e) });
    if (fresh.jobId) await safeUpdate(store, `jobs/${fresh.jobId}`, { ingest: { status: 'rejected', error: String(e.message || e) } });
    return { error: e };
  }
  await store.writeMany(result.docs);
  const summary = result.report.candidates.map(({ id, name, status, errors, warnings }) => ({ id, name, status, errors, warnings: warnings.length }));
  await store.update(path, { status: 'ingested', processedAt: new Date().toISOString(), report: summary });
  if (fresh.jobId) {
    // A job may file several inbox documents (one per candidate); accumulate their results.
    const job = store.get().jobs.find((j) => j.id === fresh.jobId);
    const prevCands = (job?.ingest?.candidates || []).filter((c) => !summary.some((x) => x.id === c.id));
    const prevIds = (job?.resultCandidateIds || []).filter((id) => !result.report.run.candidateIds.includes(id));
    await safeUpdate(store, `jobs/${fresh.jobId}`, {
      ingest: { status: 'ingested', at: new Date().toISOString(), candidates: [...prevCands, ...summary] },
      resultCandidateIds: [...prevIds, ...result.report.run.candidateIds],
    });
  }
  return result;
}

async function safeUpdate(store, path, data) {
  try {
    await store.update(path, data);
  } catch {
    /* the job may have been deleted */
  }
}
