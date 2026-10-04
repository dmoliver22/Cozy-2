// Normalizing user-submitted topics so duplicate research jobs can be detected.

const TRACKING = /^(utm_|fbclid$|gclid$|igshid$|si$|ref$|ref_src$|share$)/i;

export function isUrl(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const u = new URL(t);
    return !!u.hostname && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Returns { kind: 'url' | 'phrase', display, key } or null for unusable input.
 * The key is stable across casing, whitespace, quotes and tracking parameters.
 */
export function normalizeTopic(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim().slice(0, 500);
  if (!raw) return null;
  if (isUrl(raw)) {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const path = u.pathname.replace(/\/+$/, '');
    const q = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
    const display = `https://${u.hostname}${u.pathname}${q}`;
    return { kind: 'url', display, key: `url:${host}${path}${q}`.toLowerCase() };
  }
  const display = raw.replace(/\s+/g, ' ');
  const key = display
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[^a-z0-9#@ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return null;
  if (key.length < 2) return null;
  return { kind: 'phrase', display, key: `phrase:${key}` };
}

export function slugify(text) {
  return (
    String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

/** A db-safe id segment: letters, digits and - _ only. */
export function safeId(text) {
  return slugify(text).replace(/[^a-z0-9_-]/g, '');
}

export function newId(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
