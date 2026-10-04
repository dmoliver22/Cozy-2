// Evidence handling: canonical URLs, syndication clustering, independence and intent tallies.
// Ten copies of one viral post are one signal, so every count here is over clusters.

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|igshid$|ref$|ref_src$|si$|s$|share$|cmpid$|ocid$)/i;
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i;

export function canonicalUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
  let segments = u.pathname.split('/').filter(Boolean);
  // Localized copies of one article (/fr/blog/x, /es/blog/x) are the same source.
  if (segments.length > 1 && LOCALE_SEGMENT.test(segments[0])) segments = segments.slice(1);
  if (segments[segments.length - 1] === 'amp') segments = segments.slice(0, -1);
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  return `${host}/${segments.join('/')}${query}`.toLowerCase();
}

export function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normTitle(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group evidence items into independent clusters.
 * Items join a cluster when they share a canonical URL, an explicit `syndicationOf`
 * link, or the same normalized title (syndicated wire copy usually keeps its headline).
 * Returns [{ key, primary, items }] with the earliest-published item as primary.
 */
export function clusterEvidence(items) {
  const list = (items || []).filter(Boolean);
  const parent = new Map();
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const byId = new Map();
  list.forEach((e, i) => {
    const id = e.id || `idx${i}`;
    byId.set(id, e);
    parent.set(id, id);
  });
  const seenUrl = new Map();
  const seenTitle = new Map();
  for (const [id, e] of byId) {
    const cu = canonicalUrl(e.url);
    if (cu) {
      if (seenUrl.has(cu)) union(seenUrl.get(cu), id);
      else seenUrl.set(cu, id);
    }
    const nt = normTitle(e.title);
    if (nt.length >= 24) {
      if (seenTitle.has(nt)) union(seenTitle.get(nt), id);
      else seenTitle.set(nt, id);
    }
    if (e.syndicationOf && byId.has(e.syndicationOf)) union(e.syndicationOf, id);
  }
  const groups = new Map();
  for (const id of byId.keys()) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(byId.get(id));
  }
  return [...groups.entries()].map(([key, groupItems]) => {
    const sorted = [...groupItems].sort((a, b) => dateValue(a.publishedAt) - dateValue(b.publishedAt));
    return { key, primary: sorted[0], items: sorted };
  });
}

function dateValue(d) {
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

/** Summary counts over independent clusters (one vote per cluster, from its primary item). */
export function evidenceStats(items, now = Date.now(), recentDays = 45) {
  const clusters = clusterEvidence(items);
  const primaries = clusters.map((c) => c.primary);
  const intents = { purchase: 0, utility: 0, curiosity: 0, criticism: 0, none: 0 };
  const signalTypes = new Set();
  const hosts = new Set();
  let recent = 0;
  let undated = 0;
  let fetched = 0;
  for (const p of primaries) {
    const intent = intents[p.intent] !== undefined ? p.intent : 'none';
    intents[intent] += 1;
    if (p.signalType) signalTypes.add(p.signalType);
    const h = hostOf(p.url);
    if (h) hosts.add(h);
    const t = Date.parse(p.publishedAt || '');
    if (Number.isFinite(t)) {
      if (now - t <= recentDays * 86400000) recent += 1;
    } else {
      undated += 1;
    }
    if (p.accessMethod && p.accessMethod !== 'web_search_result') fetched += 1;
  }
  return {
    total: (items || []).length,
    independent: clusters.length,
    duplicates: (items || []).length - clusters.length,
    distinctHosts: hosts.size,
    intents,
    signalTypes: [...signalTypes],
    recent,
    undated,
    fetched,
    searchOnly: clusters.length > 0 && fetched === 0,
    clusters,
  };
}

/** Evidence ordered newest first by publication date, falling back to retrieval time. */
export function timeline(items) {
  return [...(items || [])].sort((a, b) => {
    const ta = Date.parse(a.publishedAt || a.retrievedAt || '') || 0;
    const tb = Date.parse(b.publishedAt || b.retrievedAt || '') || 0;
    return tb - ta;
  });
}

/**
 * Observations can be charted only when they are the same metric, in the same unit,
 * absolute, and there are at least `min` distinct dated points.
 */
export function chartableSeries(observations, min = 3) {
  const groups = new Map();
  for (const o of observations || []) {
    if (!o || typeof o.value !== 'number' || !o.asOf || !o.isAbsolute) continue;
    const key = `${o.metric}||${o.unit}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const series = [];
  for (const [key, pts] of groups) {
    const byDate = new Map();
    for (const p of pts) byDate.set(p.asOf, p);
    const points = [...byDate.values()].sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
    if (points.length >= min) {
      const [metric, unit] = key.split('||');
      series.push({ metric, unit, points });
    }
  }
  return series;
}
