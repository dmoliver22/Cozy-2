import { h, Fragment } from 'preact';
import { ACTIONS, STAGES, CATEGORIES, FORMATS, ACCESS_METHODS, INTENTS, SIGNAL_TYPES } from '../core/constants.js';

// ---------- formatting ----------
const DAY = 86400000;
export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return 'unknown';
  const d = now - t;
  if (d < 0) {
    const ahead = -d;
    if (ahead < 5 * 60000) return 'just now';
    if (ahead < 3600000) return `in ${Math.max(1, Math.round(ahead / 60000))} min`;
    if (ahead < DAY) return `in ${Math.round(ahead / 3600000)} h`;
    return `in ${Math.round(ahead / DAY)} days`;
  }
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.round(d / 60000)} min ago`;
  if (d < DAY) return `${Math.round(d / 3600000)} h ago`;
  if (d < 30 * DAY) return `${Math.round(d / DAY)} d ago`;
  return fmtDate(iso);
}
export function fmtDate(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  const onlyDate = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: onlyDate ? 'UTC' : undefined });
}
export function fmtDateTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function compact(n) {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
/** The first clause of a long product theme, for summaries. */
export function shortTheme(t, max = 110) {
  const s = String(t || '');
  const colon = s.indexOf(':');
  const head = colon >= 12 && colon <= max ? s.slice(0, colon) : s;
  return head.length > max ? head.slice(0, max - 1).trimEnd() + '…' : head;
}
export const safeHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : undefined);

// ---------- icons (inline, 16px, stroke) ----------
const P = {
  search: 'M11 11l4 4M7 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z',
  star: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  spark: 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2 2M10.6 10.6l2 2M3.4 12.6l2-2M10.6 5.4l2-2',
  plus: 'M8 3v10M3 8h10',
  link: 'M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8',
  back: 'M10 3L5 8l5 5',
  check: 'M3 8.5l3 3 7-7',
  alert: 'M8 1.8l6.5 12H1.5zM8 6.5v3.2M8 11.6v.1',
  clock: 'M8 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM8 4.5V8l2.5 1.5',
};
export function Icon({ name, title }) {
  return (
    <svg class="i" viewBox="0 0 16 16" fill={name === 'star-on' ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={P[name === 'star-on' ? 'star' : name]} />
    </svg>
  );
}

// ---------- state chips ----------
const ACTION_GLYPH = {
  test_now: <path d="M2 10l4-4 3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />,
  prepare: <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 0v12" fill="none" stroke="currentColor" stroke-width="1.6" />,
  watch: (
    <g fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </g>
  ),
  pass: <path d="M3.5 3.5l9 9M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8z" fill="none" stroke="currentColor" stroke-width="1.5" />,
};
export function ActionChip({ action, big }) {
  const a = ACTIONS[action] || ACTIONS.watch;
  return (
    <span class={`chip ${action}${big ? ' big' : ''}`} title={a.help}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{ACTION_GLYPH[action]}</svg>
      {a.label}
    </span>
  );
}

export function ConfidenceMark({ confidence, showScore = true }) {
  const band = confidence.band;
  const label = band === 'high' ? 'High' : band === 'medium' ? 'Medium' : 'Low';
  return (
    <span class="conf" title={`Evidence confidence ${confidence.score}/100`}>
      <span class={`bars ${band}`} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>
        {label} evidence{showScore ? <span class="mono muted"> {confidence.score}</span> : null}
      </span>
    </span>
  );
}

const TRACK_STOPS = ['first_spark', 'early_growth', 'mainstream_surge', 'established_niche', 'declining'];
// A tiny lifecycle curve: spark → growth → surge → plateau → decline.
const TRACK_Y = [11, 7, 2, 4, 10];
export function StageTrack({ stage, withLabel = true }) {
  const idx = TRACK_STOPS.indexOf(stage);
  const pts = TRACK_STOPS.map((_, i) => [4 + i * 12.5, TRACK_Y[i]]);
  return (
    <span class="track" title={STAGES[stage]?.help}>
      <svg viewBox="0 0 58 14" aria-hidden="true">
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--line-strong)" stroke-width="1.5" />
        {pts.map(([x, y], i) => (
          <circle cx={x} cy={y} r={i === idx ? 3.5 : 2} fill={i === idx ? 'var(--accent)' : 'var(--panel)'} stroke={i === idx ? 'var(--panel)' : 'var(--line-strong)'} stroke-width={i === idx ? 1.5 : 1.2} />
        ))}
        {idx < 0 ? (
          <text x="29" y="11" text-anchor="middle" font-size="9" fill="var(--muted)">
            ?
          </text>
        ) : null}
      </svg>
      {withLabel ? <span>{STAGES[stage]?.label || 'Unknown'}</span> : null}
    </span>
  );
}

export function ScoreMeter({ score, provisional }) {
  return (
    <div class="scoreline-wrap" title="Opportunity score (0–100). A heuristic, not a profit prediction.">
      <div class="scoreline">
        <span class="score-num">
          {score}
          <small>/100</small>
        </span>
        {provisional ? <span class="tag warn">Provisional</span> : null}
      </div>
      <div class="meter" aria-hidden="true">
        <i style={{ width: `${Math.max(2, score)}%` }} />
      </div>
    </div>
  );
}

export const catLabel = (k) => CATEGORIES[k] || 'Other';
export const fmtLabel = (k) => FORMATS[k] || 'Other';
export const intentLabel = (k) => INTENTS[k] || 'Context';
export const signalLabel = (k) => SIGNAL_TYPES[k] || 'Source';
export const accessLabel = (k) => ACCESS_METHODS[k]?.label || 'Source';

/** Inline citation markers that link to sources. */
export function Cites({ ids, evidenceById, onJump }) {
  if (!ids || !ids.length) return null;
  return (
    <span class="cite">
      {ids.map((id) => {
        const e = evidenceById.get(id);
        if (!e) return null;
        return (
          <a
            href={safeHref(e.url)}
            target="_blank"
            rel="noopener noreferrer"
            title={`${e.publisher || ''} · ${e.title || e.url}`}
            onClick={(ev) => {
              if (onJump && ev.altKey) {
                ev.preventDefault();
                onJump(id);
              }
            }}
          >
            {e.n ?? '·'}
          </a>
        );
      })}
    </span>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div class="empty">
      <h3>{title}</h3>
      {children}
      {action}
    </div>
  );
}

export { Fragment };
