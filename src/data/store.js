// Evidence storage. Two interchangeable backends with one interface:
//   - artifact db: the claude.ai artifact's shared document store (persistent, live)
//   - local: browser storage, for previews outside claude.ai (per browser only)
// The UI only talks to this interface, never to a backend directly.

export const COLLECTIONS = ['candidates', 'evidence', 'observations', 'snapshots', 'jobs', 'runs', 'watchlist', 'inbox', 'config'];

function emptyState() {
  const s = { ready: false, error: null };
  for (const c of COLLECTIONS) s[c] = [];
  return s;
}

function splitPath(path) {
  const parts = path.split('/');
  if (parts.length !== 2) throw new TypeError(`Expected collection/doc path, got "${path}"`);
  return parts;
}

class Emitter {
  constructor() {
    this.listeners = new Set();
    this.queued = false;
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(state) {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      for (const fn of this.listeners) fn(state());
    });
  }
}

// Per-document write chains: one write at a time per document, as the store requires.
function writeQueue() {
  const chains = new Map();
  return (path, fn) => {
    const prev = chains.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    chains.set(path, next);
    next.finally(() => {
      if (chains.get(path) === next) chains.delete(path);
    });
    return next;
  };
}

export function createDbStore(db) {
  const state = emptyState();
  const emitter = new Emitter();
  const unsubs = [];
  const loaded = new Set();
  const enqueue = writeQueue();
  const snapshot = () => ({ ...state });

  for (const name of COLLECTIONS) {
    const q = db.collection(name).limit(1000);
    unsubs.push(
      q.onSnapshot(
        (snap) => {
          state[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          loaded.add(name);
          state.ready = loaded.size === COLLECTIONS.length;
          emitter.emit(snapshot);
        },
        (err) => {
          state.error = err;
          state.ready = true;
          emitter.emit(snapshot);
        },
      ),
    );
  }

  async function retryOnce(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e && e.code === 'unavailable') {
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
        return fn();
      }
      throw e;
    }
  }

  return {
    kind: 'artifact-db',
    persistent: true,
    subscribe(fn) {
      const off = emitter.on(fn);
      fn(snapshot());
      return off;
    },
    get: () => snapshot(),
    set(path, data) {
      splitPath(path);
      return enqueue(path, () => retryOnce(() => db.doc(path).set(data)));
    },
    update(path, data) {
      splitPath(path);
      return enqueue(path, () => retryOnce(() => db.doc(path).update(data)));
    },
    remove(path) {
      splitPath(path);
      return enqueue(path, () => retryOnce(() => db.doc(path).delete()));
    },
    async writeMany(docs, onProgress) {
      let done = 0;
      for (const d of docs) {
        await this.set(d.path, d.data);
        done += 1;
        if (onProgress) onProgress(done, docs.length);
      }
    },
    async acquire(path, holder, ttlMs = 60000) {
      try {
        const r = await db.doc(path).acquire({ holder, ttlMs });
        return !!r.acquired;
      } catch {
        return false;
      }
    },
    close() {
      unsubs.forEach((u) => u());
    },
  };
}

const LOCAL_KEY = 'trendjack.local.v1';

export function createLocalStore() {
  const state = emptyState();
  const emitter = new Emitter();
  const snapshot = () => ({ ...state });
  let storageOk = true;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      for (const c of COLLECTIONS) if (Array.isArray(parsed[c])) state[c] = parsed[c];
    }
  } catch {
    storageOk = false;
  }
  state.ready = true;

  const persist = () => {
    try {
      const out = {};
      for (const c of COLLECTIONS) out[c] = state[c];
      localStorage.setItem(LOCAL_KEY, JSON.stringify(out));
    } catch {
      storageOk = false;
    }
  };

  const write = (path, fn) => {
    const [col, id] = splitPath(path);
    const list = state[col] || [];
    const idx = list.findIndex((d) => d.id === id);
    const next = fn(idx >= 0 ? list[idx] : null, id);
    const copy = [...list];
    if (next === null) {
      if (idx >= 0) copy.splice(idx, 1);
    } else if (idx >= 0) copy[idx] = next;
    else copy.push(next);
    state[col] = copy;
    persist();
    emitter.emit(snapshot);
  };

  const merge = (a, b) => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
    }
    return out;
  };

  return {
    kind: 'local',
    persistent: storageOk,
    subscribe(fn) {
      const off = emitter.on(fn);
      fn(snapshot());
      return off;
    },
    get: () => snapshot(),
    async set(path, data) {
      write(path, (_, id) => ({ ...JSON.parse(JSON.stringify(data)), id }));
    },
    async update(path, data) {
      let missing = false;
      write(path, (prev, id) => {
        if (!prev) {
          missing = true;
          return null;
        }
        return merge(prev, { ...JSON.parse(JSON.stringify(data)), id });
      });
      if (missing) throw { code: 'invalid_argument', message: `No document at ${path}` };
    },
    async remove(path) {
      write(path, () => null);
    },
    async writeMany(docs, onProgress) {
      let done = 0;
      for (const d of docs) {
        await this.set(d.path, d.data);
        done += 1;
        if (onProgress) onProgress(done, docs.length);
      }
    },
    async acquire() {
      return true;
    },
    close() {},
  };
}

/** Group a flat state into lookups the UI uses everywhere. */
export function indexState(state) {
  const byCandidate = (list) => {
    const m = new Map();
    for (const x of list) {
      if (!x.candidateId) continue;
      if (!m.has(x.candidateId)) m.set(x.candidateId, []);
      m.get(x.candidateId).push(x);
    }
    return m;
  };
  const config = Object.fromEntries((state.config || []).map((d) => [d.id, d]));
  return {
    candidates: state.candidates || [],
    evidenceBy: byCandidate(state.evidence || []),
    observationsBy: byCandidate(state.observations || []),
    snapshotsBy: byCandidate(state.snapshots || []),
    watch: new Map((state.watchlist || []).map((w) => [w.id, w])),
    jobs: [...(state.jobs || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)),
    runs: [...(state.runs || [])].sort((a, b) => Date.parse(b.researchedAt || 0) - Date.parse(a.researchedAt || 0)),
    inbox: state.inbox || [],
    settings: config.settings || null,
    worker: config.worker || null,
    sources: config.sources || null,
  };
}
