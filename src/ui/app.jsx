import { h, render } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import { DEFAULT_PREFERENCES, DEFAULT_WEIGHTS } from '../core/constants.js';
import { assess, rankCompare } from '../core/scoring.js';
import { createDbStore, createLocalStore, indexState } from '../data/store.js';
import { planJob, ingestInboxItem, ACTIVE } from '../data/jobs.js';
import { createWorker, describeMcpError } from '../data/worker.js';
import { demoState } from '../data/demo.js';
import { DecisionStrip, Filters, Ledger, NoResults, applyFilters, sortItems, EMPTY_FILTERS } from './feed.jsx';
import { Dossier } from './detail.jsx';
import { WatchlistView, ResearchView, SettingsView } from './views.jsx';
import { Icon, Empty, relTime } from './bits.jsx';

const TABS = [
  ['opportunities', 'Opportunities'],
  ['watchlist', 'Watchlist'],
  ['research', 'Research'],
  ['settings', 'Settings'],
];

function readHash() {
  const t = (location.hash || '').replace('#', '');
  return TABS.some(([k]) => k === t) ? t : 'opportunities';
}

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(`trendjack.${key}`);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem(`trendjack.${key}`, JSON.stringify(value));
  } catch {
    /* per-viewer convenience only */
  }
}

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function App() {
  const [store, setStore] = useState(null);
  const [state, setState] = useState(null);
  const [connecting, setConnecting] = useState(true);
  const [mcp, setMcp] = useState(null);
  const [canWrite, setCanWrite] = useState(true);
  const [userId, setUserId] = useState(null);
  const [tab, setTab] = useState(readHash());
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, ...loadPref('filters', {}) }));
  const [demo, setDemo] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [trigger, setTrigger] = useState(null);
  const [scheduleTrigger, setScheduleTrigger] = useState(null);
  const [workerError, setWorkerError] = useState(null);
  const [scheduleState, setScheduleState] = useState(null);
  const holder = useRef(`view-${Math.random().toString(36).slice(2, 10)}`);
  const ingesting = useRef(new Set());
  const now = useNow();

  const toast = useCallback((text, tone = '') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // Connect storage: artifact db when the viewer serves it, otherwise this browser.
  useEffect(() => {
    let cancelled = false;
    let s = null;
    let off = null;
    (async () => {
      const claude = window.claude;
      const [db, user, m] = claude?.use ? await Promise.all([claude.use('db'), claude.use('user'), claude.use('mcp')]) : [null, null, null];
      if (cancelled) return;
      s = db ? createDbStore(db) : createLocalStore();
      setStore(s);
      setMcp(m || null);
      off = s.subscribe((st) => setState(st));
      setConnecting(false);
      if (user) {
        const [can, id] = await Promise.all([user.can('data.write'), user.id()]);
        if (!cancelled) {
          if (can === false) setCanWrite(false);
          setUserId(id || null);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (off) off();
      if (s) s.close();
    };
  }, []);

  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => savePref('filters', { ...filters, q: '' }), [filters]);

  const live = state || { ready: false };
  const view = demo ? demoState() : live;
  const ix = useMemo(() => indexState(view), [view]);
  const liveIx = useMemo(() => indexState(live), [live]);
  const settings = liveIx.settings || {};
  const prefs = { ...DEFAULT_PREFERENCES, ...(settings.preferences || {}) };
  const weights = { ...DEFAULT_WEIGHTS, ...(settings.weights || {}) };
  const settingsForScoring = { preferences: prefs, weights };

  const items = useMemo(
    () => ix.candidates.map((c) => ({ c, a: assess(c, ix.evidenceBy.get(c.id) || [], settingsForScoring, now) })),
    // eslint-disable-next-line
    [ix, JSON.stringify(settingsForScoring), Math.floor(now / 3600000)],
  );
  const filtered = useMemo(() => sortItems(applyFilters(items, filters), filters.sort, rankCompare), [items, filters]);
  const sel = selected ? items.find((i) => i.c.id === selected) : null;

  const worker = useMemo(() => createWorker(mcp), [mcp]);
  const workerConfig = liveIx.worker;
  const workerInfo = {
    configured: !!workerConfig?.triggerId,
    available: worker.available,
    worker: workerConfig,
    trigger,
    scheduleTrigger,
    error: workerError,
  };

  // File finished research from the inbox while the dashboard is open.
  useEffect(() => {
    if (!store || demo || !canWrite) return;
    for (const item of liveIx.inbox) {
      if (item.status !== 'new' || ingesting.current.has(item.id)) continue;
      ingesting.current.add(item.id);
      ingestInboxItem(store, item, liveIx, settingsForScoring, holder.current)
        .then((r) => {
          if (r?.report) {
            const names = r.report.candidates.filter((c) => c.status !== 'rejected').map((c) => c.name);
            toast(names.length ? `Filed new research: ${names.join(', ')}` : 'Research arrived, but no candidate passed validation.');
          }
        })
        .catch((e) => toast(`Could not file research: ${e?.message || e}`, 'bad'));
    }
  }, [liveIx.inbox, store, demo, canWrite]);

  const loadTriggers = useCallback(async () => {
    if (!workerConfig?.triggerId || !worker.available) return;
    setScheduleState('loading');
    setWorkerError(null);
    try {
      const t = await worker.get(workerConfig.triggerId);
      setTrigger(t?.trigger || t);
      if (workerConfig.scheduleTriggerId) {
        const st = await worker.get(workerConfig.scheduleTriggerId);
        setScheduleTrigger(st?.trigger || st);
      }
    } catch (e) {
      setWorkerError(describeMcpError(e).message);
    } finally {
      setScheduleState(null);
    }
  }, [workerConfig?.triggerId, workerConfig?.scheduleTriggerId, worker]);

  useEffect(() => {
    if (tab === 'settings' && workerConfig?.triggerId && worker.available && !trigger) loadTriggers();
  }, [tab, workerConfig?.triggerId, worker.available]);

  const saveSchedule = async (patch) => {
    setScheduleState('saving');
    setWorkerError(null);
    try {
      const t = await worker.update(workerConfig.scheduleTriggerId, patch);
      setScheduleTrigger(t?.trigger || t);
      toast(patch.enabled ? 'Schedule saved. Discovery will run on that timetable.' : 'Scheduled discovery turned off.');
      await loadTriggers();
    } catch (e) {
      setWorkerError(describeMcpError(e).message);
    } finally {
      setScheduleState(null);
    }
  };

  // ---- actions ----
  const toggleWatch = async (c) => {
    if (!store || c.source === 'demo') return toast('Demo examples cannot be saved.');
    const path = `watchlist/${c.id}`;
    try {
      if (liveIx.watch.has(c.id)) {
        await store.remove(path);
        toast(`Removed ${c.name} from your watchlist`);
      } else {
        const snaps = (liveIx.snapshotsBy.get(c.id) || []).sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
        await store.set(path, { candidateId: c.id, addedAt: new Date().toISOString(), addedBy: userId, baselineSnapshotId: snaps[0]?.id || null });
        toast(`Watching ${c.name}`);
      }
    } catch (e) {
      handleWriteError(e);
    }
  };

  const handleWriteError = (e) => {
    if (e?.code === 'invalid_argument') {
      setCanWrite(false);
      toast('You can view this dashboard but not change it.', 'bad');
    } else if (e?.code === 'quota_exceeded') toast('The dashboard database is full. Remove old jobs or candidates to make room.', 'bad');
    else toast(`Could not save: ${e?.message || 'unknown error'}`, 'bad');
  };

  const dispatch = async (job) => {
    if (!workerConfig?.triggerId) {
      await store.update(`jobs/${job.id}`, { dispatch: { status: 'not_connected', at: new Date().toISOString() } });
      return { ok: false, reason: 'not_connected' };
    }
    if (!worker.available) {
      await store.update(`jobs/${job.id}`, { dispatch: { status: 'not_connected', at: new Date().toISOString(), message: 'Connector not available in this view.' } });
      return { ok: false, reason: 'not_connected' };
    }
    try {
      await worker.fire(workerConfig.triggerId, job.id);
      await store.update(`jobs/${job.id}`, { dispatch: { status: 'sent', at: new Date().toISOString() }, progress: 'Research worker starting', updatedAt: new Date().toISOString() });
      return { ok: true };
    } catch (e) {
      const d = describeMcpError(e);
      await store.update(`jobs/${job.id}`, { dispatch: { status: 'failed', at: new Date().toISOString(), code: d.code, message: d.message } });
      return { ok: false, reason: d.message };
    }
  };

  const submit = async (req) => {
    if (demo) {
      toast('Turn off demo data to run research.');
      return { kind: 'invalid', message: 'Turn off demo data in Settings to run research.' };
    }
    if (!store) return { kind: 'invalid', message: 'Storage is still connecting.' };
    const plan = planJob(req, liveIx, prefs);
    if (plan.kind !== 'ok') return plan;
    try {
      await store.set(`jobs/${plan.job.id}`, plan.job);
    } catch (e) {
      handleWriteError(e);
      return { kind: 'invalid', message: 'Could not save the job.' };
    }
    const d = await dispatch(plan.job);
    if (d.ok) toast(`${req.type === 'discover' ? 'Discovery' : 'Research'} started. Progress appears under Research.`);
    else if (d.reason === 'not_connected') toast('Job queued. No research worker is connected in this view, so it will wait.', 'bad');
    else toast(`Job queued, but the worker did not start: ${d.reason}`, 'bad');
    return { kind: 'ok', job: plan.job, dispatched: d.ok };
  };

  const refreshCandidate = async (c) => {
    const r = await submit({ type: 'refresh', input: c.name, candidateId: c.id });
    if (r.kind === 'duplicate') toast(`A refresh for ${c.name} is already ${r.job.status}.`);
    else if (r.kind === 'limit' || r.kind === 'invalid') toast(r.message, 'bad');
  };
  const refreshAll = async (cs) => {
    for (const c of cs) {
      const r = await submit({ type: 'refresh', input: c.name, candidateId: c.id });
      if (r.kind === 'limit') {
        toast(r.message, 'bad');
        break;
      }
    }
  };
  const discover = async () => {
    const r = await submit({ type: 'discover' });
    if (r.kind === 'duplicate') toast(`Discovery is already ${r.job.status}.`);
    else if (r.kind === 'limit' || r.kind === 'invalid') toast(r.message, 'bad');
    if (r.kind !== 'invalid') location.hash = 'research';
  };
  const cancelJob = async (job) => {
    try {
      await store.update(`jobs/${job.id}`, { status: 'cancelled', updatedAt: new Date().toISOString(), error: 'Cancelled from the dashboard.' });
    } catch (e) {
      handleWriteError(e);
    }
  };
  const retryJob = async (job) => {
    await store.update(`jobs/${job.id}`, { updatedAt: new Date().toISOString() });
    const d = await dispatch(job);
    toast(d.ok ? 'Research worker started again.' : `The worker did not start: ${d.reason === 'not_connected' ? 'not connected in this view' : d.reason}`, d.ok ? '' : 'bad');
  };
  const dismissJob = async (job) => {
    try {
      await store.remove(`jobs/${job.id}`);
    } catch (e) {
      handleWriteError(e);
    }
  };
  const saveSettings = async (patch) => {
    try {
      await store.set('config/settings', { ...(liveIx.settings || {}), ...patch, updatedAt: new Date().toISOString() });
      toast('Settings saved');
    } catch (e) {
      handleWriteError(e);
    }
  };

  const refreshing = useMemo(() => {
    const out = {};
    for (const j of liveIx.jobs) if (j.type === 'refresh' && ACTIVE.includes(j.status) && j.candidateId) out[j.candidateId] = j.status === 'running' ? 'Researching…' : 'Queued';
    return out;
  }, [liveIx.jobs]);

  const go = (t) => {
    location.hash = t;
    setTab(t);
  };
  const openCandidate = (id) => {
    setSelected(id);
    if (tab !== 'opportunities') go('opportunities');
  };

  const activeJobs = liveIx.jobs.filter((j) => ACTIVE.includes(j.status));

  return (
    <div class="shell">
      <header class="top">
        <div class="top-inner">
          <div class="brand">
            <span class="wordmark">
              Trend<i>jack</i>
            </span>
            <span class="tagline">What to launch now, for whom, in what format, and why</span>
          </div>
          {canWrite ? (
            <div class="top-actions">
              {activeJobs.length ? (
                <button class="btn ghost small" onClick={() => go('research')} title="Research in progress">
                  <span class="spinner" /> {activeJobs.length} running
                </button>
              ) : null}
              <button class="btn" onClick={() => setAnalyzeOpen(true)}>
                <Icon name="search" /> Analyze a topic
              </button>
              <button class="btn primary" onClick={discover}>
                <Icon name="spark" /> Discover trends
              </button>
            </div>
          ) : null}
        </div>
        <nav class="tabs" role="tablist" aria-label="Sections">
          {TABS.map(([k, label]) => (
            <button class="tab" role="tab" aria-selected={tab === k ? 'true' : 'false'} onClick={() => go(k)}>
              {label}
              {k === 'watchlist' && liveIx.watch.size ? <span class="count">{liveIx.watch.size}</span> : null}
              {k === 'research' && activeJobs.length ? <span class="count">{activeJobs.length}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      {demo ? (
        <div class="banner demo" role="status">
          <span class="tag demo">Demo</span>
          <span class="grow">
            <b>You are looking at fictional demo examples.</b> They are not research and are never saved.{' '}
            <button class="btn small" onClick={() => setDemo(false)}>
              Show researched results
            </button>
          </span>
        </div>
      ) : null}
      {!connecting && store?.kind === 'local' && !demo ? (
        <div class="banner warn" role="status">
          <span class="grow">
            <b>Not connected to the Trendjack database.</b> This copy is running outside claude.ai, so it cannot read the shared research or start the research worker. Anything you change stays in this browser.{' '}
            {!ix.candidates.length ? (
              <button class="btn small" onClick={() => setDemo(true)}>
                Explore with demo data
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {live.error ? (
        <div class="banner bad" role="alert">
          <span class="grow">
            <b>Some research could not be loaded.</b> {live.error.message || live.error.code}. Reload the page to reconnect.
          </span>
        </div>
      ) : null}
      {!canWrite ? (
        <div class="banner" role="status">
          <span class="grow">You have view-only access. Research controls, the watchlist and settings are read-only.</span>
        </div>
      ) : null}

      {tab === 'opportunities' ? (
        <main>
          <DecisionStrip items={items} now={now} demo={demo} />
          {!live.ready && !demo ? (
            <div class="view">
              <Empty title="Loading research…">
                <p>Connecting to the Trendjack database.</p>
              </Empty>
            </div>
          ) : items.length === 0 ? (
            <div class="view">
              <Empty
                title="No researched opportunities yet"
                action={
                  canWrite ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button class="btn primary" onClick={discover}>
                        <Icon name="spark" /> Discover trends
                      </button>
                      <button class="btn" onClick={() => setAnalyzeOpen(true)}>
                        Analyze a topic
                      </button>
                      <button class="btn ghost" onClick={() => setDemo(true)}>
                        Explore demo data
                      </button>
                    </div>
                  ) : null
                }
              >
                <p>Researched candidates appear here, ranked by recommended action and opportunity score, each with its sources. Start a discovery scan, or analyze a phrase or URL you have spotted.</p>
              </Empty>
            </div>
          ) : (
            <>
              <Filters filters={filters} setFilters={setFilters} items={items} shown={filtered.length} />
              <div class={`desk${sel ? ' has-detail' : ''}`}>
                <div style={{ minWidth: 0 }}>
                  {filtered.length ? (
                    <Ledger items={filtered} selected={selected} onSelect={setSelected} watch={liveIx.watch} onToggleWatch={toggleWatch} now={now} canWrite={canWrite && !demo} />
                  ) : (
                    <NoResults onClear={() => setFilters({ ...EMPTY_FILTERS, sort: filters.sort })} />
                  )}
                </div>
                {sel ? (
                  <Dossier
                    c={sel.c}
                    a={sel.a}
                    evidence={ix.evidenceBy.get(sel.c.id) || []}
                    observations={ix.observationsBy.get(sel.c.id) || []}
                    snapshots={ix.snapshotsBy.get(sel.c.id) || []}
                    watched={liveIx.watch.has(sel.c.id)}
                    onClose={() => setSelected(null)}
                    onToggleWatch={toggleWatch}
                    onRefresh={refreshCandidate}
                    refreshState={refreshing[sel.c.id]}
                    canWrite={canWrite && !demo}
                    prefs={prefs}
                    now={now}
                  />
                ) : null}
              </div>
            </>
          )}
        </main>
      ) : null}

      {tab === 'watchlist' ? (
        <WatchlistView items={items} ix={liveIx} onOpen={openCandidate} onToggleWatch={toggleWatch} onRefresh={refreshCandidate} onRefreshAll={refreshAll} refreshing={refreshing} canWrite={canWrite && !demo} now={now} />
      ) : null}
      {tab === 'research' ? (
        <ResearchView ix={liveIx} onCancel={cancelJob} onRetry={retryJob} onDismiss={dismissJob} onOpen={openCandidate} canWrite={canWrite} now={now} workerInfo={workerInfo} onDiscover={discover} onAnalyze={() => setAnalyzeOpen(true)} />
      ) : null}
      {tab === 'settings' ? (
        <SettingsView settings={liveIx.settings} onSave={saveSettings} canWrite={canWrite} workerInfo={workerInfo} onLoadTrigger={loadTriggers} onSaveSchedule={saveSchedule} scheduleState={scheduleState} demo={demo} setDemo={setDemo} storeKind={store?.kind} />
      ) : null}

      <footer class="foot">
        <span>Scores are decision heuristics, not profit predictions. Search interest is not sales.</span>
        <span>{store?.kind === 'artifact-db' ? 'Stored in the artifact database' : 'Stored in this browser'}</span>
      </footer>

      {analyzeOpen ? <AnalyzeDialog onClose={() => setAnalyzeOpen(false)} onSubmit={submit} onOpen={openCandidate} goResearch={() => go('research')} /> : null}

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div class={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

function AnalyzeDialog({ onClose, onSubmit, onOpen, goResearch }) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const go = async (force = false) => {
    setBusy(true);
    const r = await onSubmit({ type: 'analyze', input: value, force });
    setBusy(false);
    if (r.kind === 'ok') {
      onClose();
      goResearch();
    } else setResult(r);
  };
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="analyze-title">
        <h2 id="analyze-title">Analyze a topic</h2>
        <p class="small ink2">Enter a phrase, meme, aesthetic, hobby or movement, or paste a URL to a post or article. The research worker checks whether it is a real, spreading trend with buying intent, and what you could sell.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(false);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          <label for="analyze-input" class="sr">
            Phrase or URL
          </label>
          <input ref={input} id="analyze-input" type="text" placeholder="e.g. a phrase you keep seeing, or https://…" value={value} onInput={(e) => setValue(e.currentTarget.value)} maxLength={500} />
          {result?.kind === 'invalid' || result?.kind === 'limit' ? <div class="notice bad">{result.message}</div> : null}
          {result?.kind === 'duplicate' ? (
            <div class="notice">
              <span>This topic is already {result.job.status === 'running' ? 'being researched' : 'queued'} (started {relTime(result.job.createdAt)}). A second job would duplicate the work.</span>
              <div>
                <button type="button" class="btn small" onClick={() => (onClose(), goResearch())}>
                  See progress
                </button>
              </div>
            </div>
          ) : null}
          {result?.kind === 'cached' ? (
            <div class="notice">
              <span>
                “{result.candidate.name}” was researched {Math.round(result.ageH)} hours ago. Open the cached result, or research it again now.
              </span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button type="button" class="btn small" onClick={() => (onClose(), onOpen(result.candidate.id))}>
                  Open cached result
                </button>
                <button type="button" class="btn small ghost" onClick={() => go(true)}>
                  Research again anyway
                </button>
              </div>
            </div>
          ) : null}
          <div class="row-actions">
            <button type="button" class="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" class="btn primary" disabled={busy || !value.trim()}>
              {busy ? <span class="spinner" /> : null} Start research
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const start = () => render(<App />, document.getElementById('app'));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
