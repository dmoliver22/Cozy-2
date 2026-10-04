import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { CRITERIA, DEFAULT_WEIGHTS, DEFAULT_PREFERENCES, AUDIENCE } from '../core/constants.js';
import { normalizeWeights } from '../core/scoring.js';
import { latestChanges, diffSnapshots } from '../core/changes.js';
import { JOB_TYPES, jobHealth } from '../data/jobs.js';
import { SCHEDULES, scheduleFromCron, cronFor, runStatus } from '../data/worker.js';
import { ActionChip, ConfidenceMark, ScoreMeter, Icon, Empty, relTime, fmtDateTime } from './bits.jsx';
import { ChangeLine } from './detail.jsx';

// ---------------- Watchlist ----------------
export function WatchlistView({ items, ix, onOpen, onToggleWatch, onRefresh, onRefreshAll, refreshing, canWrite, now }) {
  const watched = items.filter((i) => ix.watch.has(i.c.id));
  if (!watched.length) {
    return (
      <div class="view">
        <Empty title="Your watchlist is empty">
          <p>Save a candidate with the star on its row or in its detail view. Trendjack stores a research snapshot each time a candidate is researched, and the watchlist shows what changed between the last two stored snapshots. Nothing is inferred between snapshots.</p>
        </Empty>
      </div>
    );
  }
  return (
    <div class="view">
      <div class="panel">
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ marginRight: 'auto', fontFamily: 'var(--font-display)', fontStretch: '112%', fontSize: 'var(--step-2)' }}>Watchlist</h2>
          {canWrite ? (
            <button class="btn" onClick={() => onRefreshAll(watched.map((w) => w.c))}>
              <Icon name="refresh" /> Refresh all watched
            </button>
          ) : null}
        </div>
        <p class="lede">Changes are shown only between genuinely stored research snapshots. A refresh queues new research; results replace the current analysis and add a snapshot, and earlier evidence is kept as cached findings.</p>
      </div>
      {watched.map(({ c, a }) => {
        const snaps = ix.snapshotsBy.get(c.id) || [];
        const lc = latestChanges(snaps);
        const w = ix.watch.get(c.id);
        const base = w?.baselineSnapshotId ? snaps.find((s) => s.id === w.baselineSnapshotId) : null;
        const sinceSaved = base && lc.curr && base.id !== lc.curr.id ? diffSnapshots(base, lc.curr) : null;
        return (
          <div class="panel watch-item">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button class="btn ghost" style={{ padding: '2px 4px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--step-1)' }} onClick={() => onOpen(c.id)}>
                  {c.name}
                </button>
                <ActionChip action={a.gate.action} />
                <ConfidenceMark confidence={a.confidence} />
              </div>
              <p class="small muted">
                Saved {relTime(w?.addedAt, now)} · last researched {fmtDateTime(c.researchedAt)} · {snaps.length} stored snapshot{snaps.length === 1 ? '' : 's'}
              </p>
              {lc.comparable ? (
                lc.changes.length ? (
                  <div class="changes">
                    <span class="label">
                      Since {fmtDateTime(lc.prev.takenAt)}
                    </span>
                    {lc.changes.map((ch) => (
                      <ChangeLine ch={ch} />
                    ))}
                  </div>
                ) : (
                  <p class="small">No meaningful change between the last two snapshots ({fmtDateTime(lc.prev.takenAt)} and {fmtDateTime(lc.curr.takenAt)}).</p>
                )
              ) : (
                <p class="small ink2">Only one snapshot so far. Refresh to record a second one; changes appear once there are two to compare.</p>
              )}
              {sinceSaved && sinceSaved.length ? (
                <div class="changes">
                  <span class="label">Since you saved it</span>
                  {sinceSaved.map((ch) => (
                    <ChangeLine ch={ch} />
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
              <ScoreMeter score={a.opportunity.score} provisional={a.provisional} />
              {canWrite ? (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button class="btn small" onClick={() => onRefresh(c)} disabled={!!refreshing[c.id]}>
                    {refreshing[c.id] ? <span class="spinner" /> : <Icon name="refresh" />} {refreshing[c.id] || 'Refresh'}
                  </button>
                  <button class="btn small ghost" onClick={() => onToggleWatch(c)}>
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Research log ----------------
function stepClass(s) {
  return s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : s.status === 'failed' ? 'failed' : 'skipped';
}

export function JobCard({ job, onCancel, onRetry, onDismiss, onOpen, canWrite, now }) {
  const health = jobHealth(job, now);
  const active = job.status === 'queued' || job.status === 'running';
  const statusTag = {
    queued: <span class="tag outline">Queued</span>,
    running: <span class="tag accent">Running</span>,
    done: <span class="tag good">Done</span>,
    partial: <span class="tag warn">Partial results</span>,
    failed: <span class="tag bad">Failed</span>,
    cancelled: <span class="tag">Cancelled</span>,
  }[job.status] || <span class="tag">{job.status}</span>;
  return (
    <div class="job">
      <div class="job-head">
        {active ? <span class="spinner" aria-hidden="true" /> : null}
        {statusTag}
        <span class="tag">{JOB_TYPES[job.type] || job.type}</span>
        <b>{job.input}</b>
        <span class="small muted" style={{ marginLeft: 'auto' }}>
          {relTime(job.updatedAt || job.createdAt, now)}
        </span>
      </div>
      {job.steps?.length ? (
        <ol class="steps" aria-label="Progress">
          {job.steps.map((s) => (
            <li class={stepClass(s)}>{s.label}</li>
          ))}
        </ol>
      ) : null}
      {job.progress && active ? <p class="small ink2">{job.progress}</p> : null}
      {health.state !== 'ok' && active ? (
        <div class={`notice ${health.state === 'waiting' ? '' : 'warn'}`}>
          <span>{health.note}</span>
          {canWrite ? (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {health.state !== 'waiting' ? (
                <button class="btn small" onClick={() => onRetry(job)}>
                  Try starting the worker again
                </button>
              ) : null}
              <button class="btn small ghost" onClick={() => onCancel(job)}>
                Cancel job
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {job.status === 'failed' || job.status === 'partial' ? (
        <p class="small">
          <b>{job.status === 'failed' ? 'What went wrong:' : 'What is missing:'}</b> {job.error || 'No reason recorded.'}
        </p>
      ) : null}
      {job.summary && !active ? <p class="small ink2">{job.summary}</p> : null}
      {job.sourcesTried?.length ? (
        <details class="small">
          <summary class="muted">Sources tried ({job.sourcesTried.length})</summary>
          <SourceTable sources={job.sourcesTried} />
        </details>
      ) : null}
      {job.ingest?.candidates?.length ? (
        <div class="small" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span class="muted">Results:</span>
          {job.ingest.candidates.map((r) =>
            r.status === 'rejected' ? (
              <span class="tag bad" title={(r.errors || []).join(' ')}>
                {r.name}: rejected
              </span>
            ) : (
              <button class="btn small" onClick={() => onOpen(r.id)}>
                {r.name} ({r.status})
              </button>
            ),
          )}
        </div>
      ) : job.status === 'done' && !job.ingest ? (
        <p class="small muted">Waiting to file the results. They are filed automatically while this dashboard is open.</p>
      ) : null}
      {!active && canWrite ? (
        <div>
          <button class="btn small ghost" onClick={() => onDismiss(job)}>
            Remove from log
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SourceTable({ sources }) {
  const tone = { ok: 'good', blocked: 'bad', error: 'bad', unavailable: 'warn', partial: 'warn', not_tried: '' };
  return (
    <div class="table-wrap">
      <table class="t">
        <thead>
          <tr>
            <th>Source</th>
            <th>Method</th>
            <th>Status</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr>
              <td>{s.source}</td>
              <td class="mono small">{s.method}</td>
              <td>
                <span class={`tag ${tone[s.status] || ''}`}>{(s.status || '').replace('_', ' ')}</span>
              </td>
              <td class="small ink2">{s.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResearchView({ ix, onCancel, onRetry, onDismiss, onOpen, canWrite, now, workerInfo, onDiscover, onAnalyze }) {
  const active = ix.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const past = ix.jobs.filter((j) => !(j.status === 'queued' || j.status === 'running')).slice(0, 30);
  const sources = ix.sources?.sources || [];
  return (
    <div class="view">
      <div class="panel">
        <h2>Research</h2>
        <p class="lede">
          Research runs as queued jobs. A research worker with web search picks each job up, records every source it tried, and writes structured, cited findings back. Trendjack then validates the findings and files them. Nothing is scored from sources the worker could not reach.
        </p>
        <WorkerStatusLine workerInfo={workerInfo} />
        {canWrite ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button class="btn primary" onClick={onDiscover}>
              <Icon name="spark" /> Discover trends
            </button>
            <button class="btn" onClick={onAnalyze}>
              <Icon name="search" /> Analyze a topic
            </button>
          </div>
        ) : null}
      </div>
      <div class="cols">
        <div class="panel">
          <h2>In progress ({active.length})</h2>
          {active.length ? active.map((j) => <JobCard job={j} onCancel={onCancel} onRetry={onRetry} onDismiss={onDismiss} onOpen={onOpen} canWrite={canWrite} now={now} />) : <p class="small muted">No research running.</p>}
        </div>
        <div class="panel">
          <h2>Finished ({past.length})</h2>
          {past.length ? past.map((j) => <JobCard job={j} onCancel={onCancel} onRetry={onRetry} onDismiss={onDismiss} onOpen={onOpen} canWrite={canWrite} now={now} />) : <p class="small muted">No finished jobs yet.</p>}
        </div>
      </div>
      <div class="panel">
        <h2>Research runs</h2>
        <p class="lede">Each run lists what was screened, what was rejected and why, and which sources were reachable.</p>
        {ix.runs.length ? (
          ix.runs.map((r) => (
            <details class="job">
              <summary style={{ cursor: 'pointer' }}>
                <b>{r.lens || r.kind}</b> <span class="muted small">· {fmtDateTime(r.researchedAt)} · {(r.candidateIds || []).length} filed · {(r.discovered || []).length} screened</span>
              </summary>
              {r.discovered?.length ? (
                <div class="table-wrap">
                  <table class="t">
                    <thead>
                      <tr>
                        <th>Screened</th>
                        <th>Outcome</th>
                        <th>Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.discovered.map((d) => (
                        <tr>
                          <td>{d.name}</td>
                          <td>
                            <span class={`tag ${d.disposition === 'deep_dived' ? 'accent' : ''}`}>{d.disposition === 'deep_dived' ? 'Researched' : 'Rejected'}</span>
                          </td>
                          <td class="small ink2">{d.disposition === 'deep_dived' ? d.whyConsidered : d.rejectReason || d.whyConsidered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {r.sourcesTried?.length ? <SourceTable sources={r.sourcesTried} /> : null}
            </details>
          ))
        ) : (
          <p class="small muted">No runs recorded.</p>
        )}
      </div>
      <div class="panel">
        <h2>Source availability</h2>
        <p class="lede">
          What the research worker could actually reach{ix.sources?.checkedAt ? `, last checked ${fmtDateTime(ix.sources.checkedAt)}` : ''}. Blocked sources are never filled in from memory.
        </p>
        {sources.length ? <SourceTable sources={sources} /> : <p class="small muted">No source check recorded yet.</p>}
      </div>
    </div>
  );
}

function WorkerStatusLine({ workerInfo }) {
  const { configured, available, trigger, error } = workerInfo;
  if (!configured) return <div class="notice warn">No research worker is set up. Jobs will wait in the queue until a worker runs. See Settings → Research worker.</div>;
  if (!available) return <div class="notice warn">The research worker can only be started from the claude.ai page with the Claude Code Remote connector allowed. Jobs you queue here wait until a worker runs.</div>;
  if (error) return <div class="notice warn">{error}</div>;
  return (
    <div class="notice">
      <span>
        Research worker connected.{' '}
        {trigger?.last_run ? `Last run ${relTime(trigger.last_run.fired_at)} (${runStatus(trigger.last_run.status)}).` : 'No runs recorded yet.'}
      </span>
    </div>
  );
}

// ---------------- Settings ----------------
export function SettingsView({ settings, feeTable = {}, feesDoc, onSave, canWrite, workerInfo, onLoadTrigger, onSaveSchedule, scheduleState, demo, setDemo, storeKind }) {
  const prefs = { ...DEFAULT_PREFERENCES, ...(settings?.preferences || {}) };
  const [draft, setDraft] = useState(prefs);
  const [weights, setWeights] = useState({ ...DEFAULT_WEIGHTS, ...(settings?.weights || {}) });
  const [saved, setSaved] = useState('');
  // Reload the form only when stored settings change after mount, so typing is never clobbered.
  const seen = useRef(settings?.updatedAt);
  useEffect(() => {
    if (seen.current === settings?.updatedAt) return;
    seen.current = settings?.updatedAt;
    setDraft({ ...DEFAULT_PREFERENCES, ...(settings?.preferences || {}) });
    setWeights({ ...DEFAULT_WEIGHTS, ...(settings?.weights || {}) });
  }, [settings?.updatedAt]);
  const norm = normalizeWeights(weights);
  const sum = Object.values(weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const set = (k, v) => setDraft({ ...draft, [k]: v });
  const save = async (patch, label) => {
    await onSave(patch);
    setSaved(label);
    setTimeout(() => setSaved(''), 2500);
  };
  return (
    <div class="view">
      <div class="panel">
        <h2>Launch preferences</h2>
        <p class="lede">These defaults shape timing estimates and what counts as a practical product. They apply to every candidate.</p>
        <div class="form-grid">
          <label class="field">
            <span>Buyer region</span>
            <input id="pref-region" type="text" value={draft.region} onInput={(e) => set('region', e.currentTarget.value)} disabled={!canWrite} />
            <span class="hint">New research targets this region. Existing results keep the region they were researched for.</span>
          </label>
          <label class="field">
            <span>Product language</span>
            <input id="pref-language" type="text" value={draft.language} onInput={(e) => set('language', e.currentTarget.value)} disabled={!canWrite} />
          </label>
          <label class="field">
            <span>Existing audience</span>
            <select id="pref-audience" class="f" value={draft.audience} onChange={(e) => set('audience', e.currentTarget.value)} disabled={!canWrite}>
              {Object.entries(AUDIENCE).map(([k, v]) => (
                <option value={k}>{v}</option>
              ))}
            </select>
            <span class="hint">Sets how long a new listing takes to be discovered.</span>
          </label>
          <label class="field">
            <span>Most days to build a product</span>
            <input id="pref-build" type="number" min="1" max="30" value={draft.maxBuildDays} onInput={(e) => set('maxBuildDays', Number(e.currentTarget.value))} disabled={!canWrite} />
          </label>
          <label class="field">
            <span>Print-on-demand delivery (days)</span>
            <input id="pref-pod" type="number" min="0" max="45" value={draft.podDeliveryDays} onInput={(e) => set('podDeliveryDays', Number(e.currentTarget.value))} disabled={!canWrite} />
            <span class="hint">Production plus US shipping. An assumption; check your provider.</span>
          </label>
          <div class="field">
            <span>Discovery time for a new listing (days)</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['none', 'small', 'large'].map((k) => (
                <label class="field">
                  <span class="hint">{k === 'none' ? 'No audience' : k === 'small' ? 'Small' : 'Established'}</span>
                  <input
                    id={`pref-disc-${k}`}
                    type="number"
                    min="0"
                    max="120"
                    value={draft.discoveryDays?.[k]}
                    onInput={(e) => set('discoveryDays', { ...draft.discoveryDays, [k]: Number(e.currentTarget.value) })}
                    disabled={!canWrite}
                  />
                </label>
              ))}
            </div>
            <span class="hint">An assumption, not a measurement. Publishing a listing does not create visibility on its own.</span>
          </div>
          <div class="field">
            <span>Fulfillment</span>
            <div class="checks">
              {[
                ['digital', 'Digital downloads'],
                ['pod', 'Print on demand'],
              ].map(([k, l]) => (
                <label>
                  <input
                    id={`pref-ful-${k}`}
                    type="checkbox"
                    checked={(draft.fulfillment || []).includes(k)}
                    onChange={(e) => set('fulfillment', e.currentTarget.checked ? [...new Set([...(draft.fulfillment || []), k])] : (draft.fulfillment || []).filter((x) => x !== k))}
                    disabled={!canWrite}
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>
          <label class="field">
            <span>Reuse research younger than (hours)</span>
            <input id="pref-cache" type="number" min="0" max="720" value={draft.cacheHours} onInput={(e) => set('cacheHours', Number(e.currentTarget.value))} disabled={!canWrite} />
            <span class="hint">Analyzing a topic researched more recently shows the cached result first.</span>
          </label>
          <label class="field">
            <span>Most research jobs at once</span>
            <input id="pref-maxjobs" type="number" min="1" max="5" value={draft.maxActiveJobs} onInput={(e) => set('maxActiveJobs', Number(e.currentTarget.value))} disabled={!canWrite} />
          </label>
        </div>
        {canWrite ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button class="btn primary" onClick={() => save({ preferences: draft }, 'Preferences saved')}>
              Save preferences
            </button>
            <button class="btn ghost" onClick={() => setDraft({ ...DEFAULT_PREFERENCES })}>
              Reset to defaults
            </button>
            {saved === 'Preferences saved' ? <span class="small" role="status">Saved</span> : null}
          </div>
        ) : null}
      </div>

      <div class="panel">
        <h2>Scoring rubric</h2>
        <p class="lede">
          Weights decide how the six criteria combine into the 0–100 opportunity score. They are decision heuristics, not a validated predictor of profit. Criteria without evidence count as zero. Evidence confidence is calculated separately and never changes the score.
        </p>
        <div class="weights">
          {CRITERIA.map((c) => (
            <div class="weight">
              <label for={`w-${c.key}`} title={c.help}>
                {c.label}
              </label>
              <input id={`w-${c.key}`} type="range" min="0" max="50" step="1" value={weights[c.key]} onInput={(e) => setWeights({ ...weights, [c.key]: Number(e.currentTarget.value) })} disabled={!canWrite} />
              <span class="mono">{Math.round(norm[c.key])}%</span>
            </div>
          ))}
        </div>
        <p class="small muted">Raw total {sum}; shown as normalized percentages.</p>
        {canWrite ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button class="btn primary" onClick={() => save({ weights }, 'Weights saved')}>
              Save weights
            </button>
            <button class="btn ghost" onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>
              Restore defaults (25/20/15/15/15/10)
            </button>
            {saved === 'Weights saved' ? <span class="small" role="status">Saved. Rankings updated.</span> : null}
          </div>
        ) : null}
      </div>

      <FeeSettings table={feeTable} feesDoc={feesDoc} settings={settings} onSave={onSave} canWrite={canWrite} />

      <WorkerSettings workerInfo={workerInfo} onLoad={onLoadTrigger} onSaveSchedule={onSaveSchedule} scheduleState={scheduleState} canWrite={canWrite} />

      <div class="panel">
        <h2>Data</h2>
        <dl class="kv">
          <dt>Storage</dt>
          <dd>{storeKind === 'artifact-db' ? 'Artifact database (shared, persistent, live)' : 'This browser only (not connected to the artifact database)'}</dd>
          <dt>Demo data</dt>
          <dd>
            <label class="checks">
              <label>
                <input id="demo-toggle" type="checkbox" checked={demo} onChange={(e) => setDemo(e.currentTarget.checked)} />
                Show fictional demo examples instead of researched results
              </label>
            </label>
            <span class="small muted">Demo examples are never saved and are labeled on every screen.</span>
          </dd>
        </dl>
      </div>
    </div>
  );
}

function WorkerSettings({ workerInfo, onLoad, onSaveSchedule, scheduleState, canWrite }) {
  const { configured, available, worker, trigger, scheduleTrigger, error } = workerInfo;
  const [choice, setChoice] = useState(scheduleTrigger ? (scheduleTrigger.enabled ? scheduleFromCron(scheduleTrigger.cron_expression) : 'off') : 'off');
  useEffect(() => {
    if (scheduleTrigger) setChoice(scheduleTrigger.enabled ? scheduleFromCron(scheduleTrigger.cron_expression) : 'off');
  }, [scheduleTrigger?.cron_expression, scheduleTrigger?.enabled]);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div class="panel">
      <h2>Research worker</h2>
      <p class="lede">
        The worker is a Claude Code Routine with web search. “Discover trends”, “Analyze a topic” and refreshes start it through your Claude Code Remote connector. A separate scheduled routine can run discovery on a timetable. Both write results back to this dashboard.
      </p>
      {!configured ? (
        <div class="notice warn">
          <span>No worker is registered for this dashboard. Ask Claude in a Claude Code session to “set up the Trendjack research worker”. That creates the routines and stores their IDs here. Until then, queued jobs wait.</span>
        </div>
      ) : (
        <dl class="kv">
          <dt>On-demand routine</dt>
          <dd class="mono small">{worker.triggerId}</dd>
          <dt>Scheduled routine</dt>
          <dd class="mono small">{worker.scheduleTriggerId || 'Not set up'}</dd>
          <dt>Connector</dt>
          <dd>{available ? 'Available in this view' : 'Not available in this view (open the dashboard on claude.ai and allow Claude Code Remote)'}</dd>
          {trigger ? (
            <>
              <dt>Last on-demand run</dt>
              <dd>{trigger.last_run ? `${fmtDateTime(trigger.last_run.fired_at)} · ${runStatus(trigger.last_run.status)}` : 'None recorded'}</dd>
            </>
          ) : null}
          {scheduleTrigger ? (
            <>
              <dt>Schedule</dt>
              <dd>
                {scheduleTrigger.enabled ? `${scheduleTrigger.cron_expression}` : 'Off'}
                {scheduleTrigger.enabled && scheduleTrigger.next_run_at ? ` · next run ${fmtDateTime(scheduleTrigger.next_run_at)}` : ''}
              </dd>
              <dt>Last scheduled run</dt>
              <dd>{scheduleTrigger.last_run ? `${fmtDateTime(scheduleTrigger.last_run.fired_at)} · ${runStatus(scheduleTrigger.last_run.status)}` : 'None recorded'}</dd>
            </>
          ) : null}
        </dl>
      )}
      {error ? <div class="notice warn">{error}</div> : null}
      {configured && available ? (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <button class="btn" onClick={onLoad} disabled={scheduleState === 'loading'}>
            {scheduleState === 'loading' ? <span class="spinner" /> : <Icon name="refresh" />} Check status
          </button>
          {worker.scheduleTriggerId && canWrite ? (
            <>
              <label class="field">
                <span>Scheduled discovery</span>
                <select id="sched-choice" class="f" value={choice} onChange={(e) => setChoice(e.currentTarget.value)}>
                  {SCHEDULES.map((s) => (
                    <option value={s.id}>{s.label}</option>
                  ))}
                  {choice === 'custom' ? <option value="custom">Custom (set elsewhere)</option> : null}
                </select>
              </label>
              <button class="btn primary" disabled={choice === 'custom' || scheduleState === 'saving'} onClick={() => onSaveSchedule(choice === 'off' ? { enabled: false } : { enabled: true, cron_expression: cronFor(choice, tz) })}>
                {scheduleState === 'saving' ? <span class="spinner" /> : null} Save schedule
              </button>
              <span class="small muted">Times use your time zone ({tz}). Each scheduled run uses your Claude usage.</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FeeSettings({ table, feesDoc, settings, onSave, canWrite }) {
  const [draft, setDraft] = useState({});
  const keys = Object.keys(table);
  const verified = keys.filter((k) => table[k].status === 'verified').length;
  const fmt = (x) => (x.value == null ? '—' : x.unit === 'percent' ? `${x.value}%` : x.unit === 'usd_per_page' ? `$${x.value}/page` : x.unit === 'text' ? String(x.value) : `$${Number(x.value).toFixed(2)}`);
  return (
    <div class="panel">
      <h2>Selling costs</h2>
      <p class="lede">
        Platform fees and print-on-demand costs used in every profit table. {verified} of {keys.length} figures are verified against published sources
        {feesDoc?.checkedAt ? ` (checked ${fmtDateTime(feesDoc.checkedAt)})` : ''}; the rest are labeled default assumptions. Your own numbers override both.
      </p>
      <div class="table-wrap">
        <table class="t">
          <thead>
            <tr>
              <th>Cost</th>
              <th>Value</th>
              <th>Status</th>
              {canWrite ? <th>Your value</th> : null}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const x = table[k];
              return (
                <tr>
                  <td>
                    {x.label}
                    {x.note ? <div class="small muted">{x.note}</div> : null}
                  </td>
                  <td class="mono">{fmt(x)}</td>
                  <td>
                    {x.status === 'verified' ? (
                      <span>
                        <span class="tag good">Verified</span>{' '}
                        {x.source ? (
                          <a class="small" href={/^https?:/.test(x.source) ? x.source : undefined} target="_blank" rel="noopener noreferrer">
                            source
                          </a>
                        ) : null}
                      </span>
                    ) : x.status === 'override' ? (
                      <span class="tag accent">Your value</span>
                    ) : x.status === 'unavailable' ? (
                      <span class="tag bad">Not found</span>
                    ) : (
                      <span class="tag warn">Default, not verified</span>
                    )}
                  </td>
                  {canWrite ? (
                    <td>
                      {x.unit === 'text' ? null : (
                        <input
                          id={`fee-${k}`}
                          type="number"
                          step="0.01"
                          style={{ width: '90px' }}
                          value={draft[k] ?? settings?.fees?.[k] ?? ''}
                          placeholder={x.value == null ? '' : String(x.value)}
                          onInput={(e) => setDraft({ ...draft, [k]: e.currentTarget.value })}
                        />
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canWrite ? (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            class="btn primary"
            onClick={() => {
              const merged = { ...(settings?.fees || {}) };
              for (const [k, v] of Object.entries(draft)) {
                if (v === '' || v == null) delete merged[k];
                else merged[k] = Number(v);
              }
              onSave({ fees: merged });
              setDraft({});
            }}
          >
            Save costs
          </button>
          <button
            class="btn ghost"
            onClick={() => {
              onSave({ fees: {} });
              setDraft({});
            }}
          >
            Clear my values
          </button>
        </div>
      ) : null}
    </div>
  );
}
