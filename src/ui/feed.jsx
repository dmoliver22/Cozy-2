import { h } from 'preact';
import { ACTIONS, CATEGORIES, FORMATS, STAGES, EFFORT } from '../core/constants.js';
import { ActionChip, ConfidenceMark, StageTrack, ScoreMeter, Icon, relTime, catLabel, fmtLabel, shortTheme, Empty } from './bits.jsx';
import { AsymmetryChip } from './playbook.jsx';

export const EMPTY_FILTERS = { q: '', action: '', format: '', category: '', stage: '', confidence: '', effort: '', region: '', channel: '', sort: 'rank' };
const EFFORT_RANK = { low: 0, medium: 1, high: 2 };

export function applyFilters(items, f) {
  const q = f.q.trim().toLowerCase();
  const out = items.filter(({ c, a }) => {
    if (f.action && a.gate.action !== f.action) return false;
    if (f.format && !(c.formats || []).includes(f.format)) return false;
    if (f.category && c.category !== f.category) return false;
    if (f.stage && c.trajectory?.stage !== f.stage) return false;
    if (f.confidence && a.confidence.band !== f.confidence) return false;
    if (f.effort && !(c.products || []).some((p) => EFFORT_RANK[p.effort] <= EFFORT_RANK[f.effort])) return false;
    if (f.region && (c.region || 'US') !== f.region) return false;
    if (f.channel && !(c.channels || []).includes(f.channel)) return false;
    if (q) {
      const hay = [c.name, ...(c.aliases || []), c.summary, ...(c.products || []).map((p) => `${p.theme} ${p.buyer}`)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return out;
}

export function sortItems(items, sort, rankCompare) {
  const list = [...items];
  if (sort === 'score') list.sort((x, y) => y.a.opportunity.score - x.a.opportunity.score);
  else if (sort === 'confidence') list.sort((x, y) => y.a.confidence.score - x.a.confidence.score);
  else if (sort === 'asymmetry') list.sort((x, y) => (bestBet(y)?.asym.score ?? -1) - (bestBet(x)?.asym.score ?? -1));
  else if (sort === 'recent') list.sort((x, y) => Date.parse(y.c.researchedAt || 0) - Date.parse(x.c.researchedAt || 0));
  else list.sort((x, y) => rankCompare(x.a, y.a));
  return list;
}

export function bestBet(item) {
  return (item.bets || []).reduce((best, b) => (!best || b.asym.score > best.asym.score ? b : best), null);
}

function TopBet({ items }) {
  let best = null;
  for (const it of items) {
    if (!['test_now', 'prepare'].includes(it.a.gate.action)) continue;
    (it.bets || []).forEach((b, i) => {
      if (!best || b.asym.score > best.b.asym.score) best = { it, b, i };
    });
  }
  if (!best) return null;
  const name = best.b.playbook.productName || fmtLabel(best.it.c.products[best.i]?.format);
  return (
    <span class="sub">
      Most asymmetric bet: <b>{name}</b> ({best.it.c.name}) · {best.b.asym.label.toLowerCase()}
      {best.b.econ.primary && best.b.econ.primary.net != null ? `, ≈$${best.b.econ.primary.net.toFixed(2)} kept per sale` : ''}
    </span>
  );
}

export function DecisionStrip({ items, now, demo }) {
  const by = (k) => items.filter((i) => i.a.gate.action === k);
  const test = by('test_now');
  const prep = by('prepare');
  const rest = items.length - test.length - prep.length;
  const latest = items.reduce((m, i) => Math.max(m, Date.parse(i.c.researchedAt || 0) || 0), 0);
  const sources = items.reduce((n, i) => n + i.a.confidence.stats.independent, 0);
  let headline;
  if (!items.length) headline = 'No researched opportunities yet';
  else if (test.length) headline = `${test.length} worth testing now: ${test.slice(0, 2).map((i) => i.c.name).join(', ')}${test.length > 2 ? '…' : ''}`;
  else if (prep.length) headline = `Nothing clears the Test-now bar today. ${prep.length} to prepare.`;
  else headline = 'Nothing clears the Test-now bar today.';
  return (
    <section class="strip" aria-label="Summary">
      <div>
        <span class="label">{demo ? 'Demo summary' : 'What is worth testing now?'}</span>
        <span class="headline">{headline}</span>
        <span class="sub">
          {latest ? `Latest research ${relTime(new Date(latest).toISOString(), now)}` : 'Run “Discover trends” or “Analyze a topic” to start.'}
        </span>
        <TopBet items={items} />
      </div>
      <div>
        <span class="label">Prepare</span>
        <span class="figure">{prep.length}</span>
        <span class="sub">Promising, with a gap to close first</span>
      </div>
      <div>
        <span class="label">Watch or pass</span>
        <span class="figure">{rest}</span>
        <span class="sub">Too early, too thin, or not worth it</span>
      </div>
      <div>
        <span class="label">Evidence base</span>
        <span class="figure">{sources}</span>
        <span class="sub">independent sources across {items.length} trend{items.length === 1 ? '' : 's'}</span>
      </div>
    </section>
  );
}

function Sel({ id, value, onChange, label, options }) {
  return (
    <label>
      <span class="sr">{label}</span>
      <select id={id} class={`f${value ? ' active' : ''}`} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        <option value="">{label}</option>
        {options.map(([v, l]) => (
          <option value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

export function Filters({ filters, setFilters, items, shown }) {
  const set = (k) => (v) => setFilters({ ...filters, [k]: v });
  const regions = [...new Set(items.map((i) => i.c.region || 'US'))].map((r) => [r, r]);
  const channels = [...new Set(items.flatMap((i) => i.c.channels || []))].sort().map((c) => [c, c]);
  const formats = Object.entries(FORMATS).filter(([k]) => items.some((i) => (i.c.formats || []).includes(k)));
  const active = Object.entries(filters).filter(([k, v]) => k !== 'sort' && v).length;
  return (
    <div>
      <div class="filters" role="search">
        <label class="search">
          <span class="sr">Search opportunities</span>
          <Icon name="search" />
          <input id="f-q" type="search" placeholder="Search trends, buyers, products" value={filters.q} onInput={(e) => set('q')(e.currentTarget.value)} />
        </label>
        <Sel id="f-action" label="Any action" value={filters.action} onChange={set('action')} options={Object.entries(ACTIONS).map(([k, v]) => [k, v.label])} />
        <Sel id="f-format" label="Any format" value={filters.format} onChange={set('format')} options={formats} />
        <Sel id="f-category" label="Any category" value={filters.category} onChange={set('category')} options={Object.entries(CATEGORIES)} />
        <Sel id="f-stage" label="Any stage" value={filters.stage} onChange={set('stage')} options={Object.entries(STAGES).map(([k, v]) => [k, v.label])} />
        <Sel id="f-conf" label="Any confidence" value={filters.confidence} onChange={set('confidence')} options={[['high', 'High evidence'], ['medium', 'Medium evidence'], ['low', 'Low evidence']]} />
        <Sel id="f-effort" label="Any effort" value={filters.effort} onChange={set('effort')} options={Object.entries(EFFORT).map(([k, v]) => [k, `Effort: ${v}`])} />
        <Sel id="f-region" label="Any region" value={filters.region} onChange={set('region')} options={regions} />
        <Sel id="f-channel" label="Any channel" value={filters.channel} onChange={set('channel')} options={channels} />
        <label>
          <span class="sr">Sort</span>
          <select id="f-sort" class="f" value={filters.sort} onChange={(e) => set('sort')(e.currentTarget.value)}>
            <option value="rank">Sort: recommended</option>
            <option value="score">Sort: opportunity score</option>
            <option value="confidence">Sort: evidence confidence</option>
            <option value="recent">Sort: recently researched</option>
            <option value="asymmetry">Sort: most asymmetric bet</option>
          </select>
        </label>
      </div>
      <div class="filter-note">
        <span>
          Showing {shown} of {items.length}
        </span>
        {active ? (
          <button class="btn ghost small" onClick={() => setFilters({ ...filters, ...EMPTY_FILTERS, sort: filters.sort })}>
            Clear {active} filter{active === 1 ? '' : 's'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Ledger({ items, selected, onSelect, watch, onToggleWatch, now, canWrite }) {
  if (!items.length) return null;
  return (
    <ol class="ledger" aria-label="Ranked opportunities">
      {items.map(({ c, a, bets }, i) => {
        const p = (c.products || [])[0];
        const bet = bestBet({ bets });
        const watched = watch.has(c.id);
        return (
          <li class="row" key={c.id} aria-current={selected === c.id ? 'true' : undefined}>
            <span class="rank">{String(i + 1).padStart(2, '0')}</span>
            <div class="row-main">
              <div class="row-title">
                <h3>
                  <button class="stretch" onClick={() => onSelect(c.id)}>
                    {c.name}
                  </button>
                </h3>
                <span class="tag">{catLabel(c.category)}</span>
                {c.source === 'demo' ? <span class="tag demo">Demo</span> : null}
              </div>
              {c.summary ? <p class="row-summary">{c.summary}</p> : null}
              {p ? (
                <p class="row-product">
                  <span class="label">Sell</span>
                  <span>
                    {fmtLabel(p.format)}: {shortTheme(p.theme, 140)}
                  </span>
                </p>
              ) : (
                <p class="row-product muted">No product angle suggested</p>
              )}
              <div class="row-meta">
                <StageTrack stage={c.trajectory?.stage} />
                <ConfidenceMark confidence={a.confidence} showScore={false} />
                {bet ? (
                  <span class="bet" title="Best product bet for this trend">
                    <AsymmetryChip asym={bet.asym} />
                    {bet.econ.primary && bet.econ.primary.net != null ? <span class="mono"> ≈${bet.econ.primary.net.toFixed(2)}/sale</span> : null}
                  </span>
                ) : null}
                {p?.buyer ? <span title={p.buyer}>For: {p.buyer.length > 60 ? p.buyer.slice(0, 58) + '…' : p.buyer}</span> : null}
                <span class="muted">Researched {relTime(c.researchedAt, now)}</span>
              </div>
            </div>
            <div class="row-side">
              <div class="row-side-top">
                <ActionChip action={a.gate.action} />
                {canWrite ? (
                  <button
                    class="icon-btn lift"
                    aria-pressed={watched ? 'true' : 'false'}
                    aria-label={watched ? `Remove ${c.name} from watchlist` : `Save ${c.name} to watchlist`}
                    title={watched ? 'On your watchlist' : 'Save to watchlist'}
                    onClick={() => onToggleWatch(c)}
                  >
                    <Icon name={watched ? 'star-on' : 'star'} />
                  </button>
                ) : null}
              </div>
              <ScoreMeter score={a.opportunity.score} provisional={a.provisional} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function NoResults({ onClear }) {
  return (
    <Empty title="No opportunities match these filters" action={<button class="btn" onClick={onClear}>Clear filters</button>}>
      <p>Try removing a filter. Filters apply to researched candidates only; they never hide jobs that are still running.</p>
    </Empty>
  );
}
