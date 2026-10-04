import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { compact, fmtDate } from './bits.jsx';

/**
 * Single-series line chart for real, stored measurements only.
 * One axis, 2px line, 10% area wash, end-dot with surface ring, crosshair tooltip.
 */
export function LineChart({ series, height = 180 }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const W = 560;
  const H = height;
  const m = { t: 14, r: 16, b: 26, l: 44 };
  const pts = series.points.map((p) => ({ t: Date.parse(p.asOf), v: p.value, raw: p }));
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const vMax = niceMax(Math.max(...pts.map((p) => p.v)));
  const x = (t) => m.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / vMax) * (H - m.t - m.b);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(t1).toFixed(1)},${y(0)} L${x(t0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, vMax / 2, vMax];
  const last = pts[pts.length - 1];

  const onMove = (ev) => {
    const svg = ref.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
    });
    setHover(best);
  };
  const hp = hover === null ? null : pts[hover];
  return (
    <figure style={{ margin: 0, position: 'relative' }}>
      <svg
        ref={ref}
        class="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${series.metric} (${series.unit}), ${pts.length} measurements from ${fmtDate(series.points[0].asOf)} to ${fmtDate(last.raw.asOf)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((hh) => Math.min(pts.length - 1, (hh ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((hh) => Math.max(0, (hh ?? pts.length) - 1));
        }}
        onBlur={() => setHover(null)}
      >
        {ticks.map((tv) => (
          <g>
            <line class={tv === 0 ? 'axis' : 'grid'} x1={m.l} x2={W - m.r} y1={y(tv)} y2={y(tv)} />
            <text x={m.l - 6} y={y(tv) + 3} text-anchor="end">
              {compact(tv)}
            </text>
          </g>
        ))}
        <text x={m.l} y={H - 8} text-anchor="start">
          {fmtDate(series.points[0].asOf)}
        </text>
        <text x={W - m.r} y={H - 8} text-anchor="end">
          {fmtDate(last.raw.asOf)}
        </text>
        <path class="area" d={area} />
        <path class="line" d={line} />
        <circle class="dot" cx={x(last.t)} cy={y(last.v)} r="4" />
        {hp ? (
          <g>
            <line class="hair" x1={x(hp.t)} x2={x(hp.t)} y1={m.t} y2={H - m.b} />
            <circle class="dot" cx={x(hp.t)} cy={y(hp.v)} r="4.5" />
          </g>
        ) : null}
      </svg>
      {hp ? (
        <div class="chart-tip" style={{ left: `${(x(hp.t) / W) * 100}%`, top: '0', transform: `translateX(${x(hp.t) > W * 0.6 ? '-105%' : '8px'})` }}>
          <b>{hp.v.toLocaleString('en-US')}</b>
          {series.unit} · {fmtDate(hp.raw.asOf)}
        </div>
      ) : null}
      <figcaption class="small muted">
        {series.metric} ({series.unit}). Stored measurements only; no points are interpolated or estimated.
      </figcaption>
    </figure>
  );
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
