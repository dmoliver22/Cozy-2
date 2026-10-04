import { h } from 'preact';
import { useMemo } from 'preact/hooks';
import { BASIS, COMPETITION, STAGES, INTENTS } from '../core/constants.js';
import { clusterEvidence, timeline, chartableSeries } from '../core/evidence.js';
import { latestChanges } from '../core/changes.js';
import { timeToBuyer } from '../core/scoring.js';
import { ActionChip, ConfidenceMark, StageTrack, ScoreMeter, Icon, Cites, shortTheme, relTime, fmtDate, fmtDateTime, catLabel, fmtLabel, intentLabel, signalLabel, accessLabel, safeHref } from './bits.jsx';
import { LineChart } from './charts.jsx';

function numberEvidence(evidence) {
  // Stable numbering: oldest publication first, undated last.
  const sorted = [...evidence].sort((a, b) => (Date.parse(a.publishedAt || '') || 9e15) - (Date.parse(b.publishedAt || '') || 9e15) || a.id.localeCompare(b.id));
  const byId = new Map();
  sorted.forEach((e, i) => byId.set(e.id, { ...e, n: i + 1 }));
  return byId;
}

function Section({ title, extra, children, id }) {
  return (
    <section class="sec" id={id}>
      <h3>
        {title}
        {extra}
      </h3>
      {children}
    </section>
  );
}

function Para({ text, ids, byId, inference }) {
  if (!text) return <p class="muted small">Not researched.</p>;
  return (
    <p>
      {inference ? <span class="tag outline" style={{ marginRight: '6px' }}>Inference</span> : null}
      {text}
      <Cites ids={ids} evidenceById={byId} />
    </p>
  );
}

function nextStep(c, a) {
  const p = (c.products || [])[0];
  if (a.gate.action === 'test_now' && p?.validationTest) return p.validationTest;
  if (a.gate.action === 'prepare') {
    const gap = a.gate.reasons[0]?.reason;
    return p?.validationTest ? `Prepare: ${p.validationTest}${gap ? ` Before launch, close this gap: ${gap}` : ''}` : gap || 'Close the evidence gaps listed below.';
  }
  if (a.gate.action === 'pass') return 'Skip it. Spend the effort on a stronger candidate.';
  return c.unresolved?.[0] ? `Re-check later. Key open question: ${c.unresolved[0]}` : 'Re-check later with a refresh.';
}

export function Dossier({ c, a, evidence, observations, snapshots, watched, onClose, onToggleWatch, onRefresh, refreshState, canWrite, prefs, now }) {
  const byId = useMemo(() => numberEvidence(evidence), [evidence]);
  const clusters = useMemo(() => clusterEvidence(evidence), [evidence]);
  const series = useMemo(() => chartableSeries(observations), [observations]);
  const changes = useMemo(() => latestChanges(snapshots), [snapshots]);
  const stats = a.confidence.stats;
  const top = (c.products || [])[0];
  const multiRun = (c.runIds || []).length > 1;
  const newCount = evidence.filter((e) => e.firstSeenRunId === c.lastRunId).length;
  const cachedCount = evidence.filter((e) => e.lastSeenRunId !== c.lastRunId).length;

  return (
    <article class="dossier" aria-label={`Opportunity detail: ${c.name}`}>
      <header class="dossier-head">
        <div class="dossier-tools">
          <button class="btn ghost small" onClick={onClose} aria-label="Close detail">
            <Icon name="back" /> Back to list
          </button>
          <span style={{ flex: 1 }} />
          {canWrite ? (
            <button class="btn small" onClick={() => onToggleWatch(c)} aria-pressed={watched ? 'true' : 'false'}>
              <Icon name={watched ? 'star-on' : 'star'} /> {watched ? 'Watching' : 'Watch'}
            </button>
          ) : null}
          {canWrite && c.source !== 'demo' ? (
            <button class="btn small" onClick={() => onRefresh(c)} disabled={!!refreshState}>
              {refreshState ? <span class="spinner" /> : <Icon name="refresh" />} {refreshState || 'Refresh research'}
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span class="tag">{catLabel(c.category)}</span>
          {c.source === 'demo' ? <span class="tag demo">Demo data</span> : null}
          <span class="tag outline">{c.region || 'US'}</span>
          <StageTrack stage={c.trajectory?.stage} />
        </div>
        <h2>{c.name}</h2>
        {c.aliases?.length ? <p class="aka">Also called: {c.aliases.join(' · ')}</p> : null}
        <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
          <ActionChip action={a.gate.action} big />
          <ScoreMeter score={a.opportunity.score} provisional={a.provisional} />
          <ConfidenceMark confidence={a.confidence} />
        </div>
        <p class="small muted">
          Researched {fmtDateTime(c.researchedAt)} ({relTime(c.researchedAt, now)}) · {stats.independent} independent sources
          {multiRun ? ` · ${newCount} new this run, ${cachedCount} carried from earlier runs` : ''}
          {stats.searchOnly ? ' · from search results; pages not fetched' : ''}
        </p>
      </header>

      <div class="dossier-body">
        <section class="sec">
          <div class="callout">
            <div>
              <span class="q">Why now?</span>
              <span>{c.scores?.timing?.rationale || c.trajectory?.text || 'Timing not assessed.'}</span>
            </div>
            <div>
              <span class="q">What could I sell?</span>
              <span>{top ? `${fmtLabel(top.format)}: ${shortTheme(top.theme)}${top.buyer ? `. Buyer: ${shortTheme(top.buyer, 90)}` : ''}` : 'No product angle yet.'}</span>
            </div>
            <div>
              <span class="q">How strong is the evidence?</span>
              <span>
                {a.confidence.band === 'high' ? 'Strong' : a.confidence.band === 'medium' ? 'Moderate' : 'Weak'}: {stats.independent} independent sources, {stats.intents.purchase} showing purchase intent, {stats.intents.criticism} critical.
              </span>
            </div>
            <div>
              <span class="q">What should I do next?</span>
              <span>{nextStep(c, a)}</span>
            </div>
          </div>
          {a.gate.downgraded ? (
            <div class="gate" role="note">
              <b>
                Research recommended “{a.gate.analyst.replace('_', ' ')}”; the evidence gates cap it at “{a.gate.action.replace('_', ' ')}”.
              </b>
              <ul>
                {a.gate.reasons.map((r) => (
                  <li>{r.reason}</li>
                ))}
              </ul>
            </div>
          ) : a.gate.reasons.length && a.gate.action !== 'test_now' ? (
            <details class="small">
              <summary class="muted">What stops this from being “Test now”</summary>
              <ul>
                {a.gate.reasons.map((r) => (
                  <li>{r.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {c.actionRationale ? <p class="small ink2">{c.actionRationale}</p> : null}
        </section>

        <Section title="What it is">
          <p>{c.what || c.summary}</p>
          <dl class="kv">
            <dt>Origin</dt>
            <dd>
              {c.origin?.date ? <span class="mono">{fmtDate(c.origin.date)} · </span> : null}
              {c.origin?.text || 'Unknown'}
              <Cites ids={c.origin?.evidence} evidenceById={byId} />
            </dd>
            <dt>Who is adopting it</dt>
            <dd>
              {c.adopters?.text || 'Unknown'}
              <Cites ids={c.adopters?.evidence} evidenceById={byId} />
            </dd>
          </dl>
        </Section>

        <Section title="Timing" extra={<span class="tag accent">{STAGES[c.trajectory?.stage]?.label || 'Unknown stage'}</span>}>
          <Para text={c.trajectory?.text} ids={c.trajectory?.evidence} byId={byId} />
          <dl class="kv">
            <dt>Spreading beyond its source?</dt>
            <dd>
              {c.spread?.text || 'Not researched.'}
              <Cites ids={c.spread?.evidence} evidenceById={byId} />
            </dd>
            <dt>Entry window</dt>
            <dd>
              {c.window?.estimate ? (
                <span>
                  <span class="tag outline">Estimate</span> {c.window.estimate}
                </span>
              ) : (
                <span class="muted">No estimate. The evidence does not support one.</span>
              )}
            </dd>
            {c.window?.reasoning ? (
              <>
                <dt>Reasoning</dt>
                <dd>{c.window.reasoning}</dd>
              </>
            ) : null}
            {c.window?.invalidators?.length ? (
              <>
                <dt>What would invalidate it</dt>
                <dd>{c.window.invalidators.join(' · ')}</dd>
              </>
            ) : null}
            {c.window?.seasonality ? (
              <>
                <dt>Seasonality</dt>
                <dd>{c.window.seasonality}</dd>
              </>
            ) : null}
            {c.window?.sellBy ? (
              <>
                <dt>Fixed deadline</dt>
                <dd class="mono">{fmtDate(c.window.sellBy)}</dd>
              </>
            ) : null}
          </dl>
        </Section>

        <Section title="Demand evidence" extra={<span class="small muted">counted once per independent source</span>}>
          <Para text={c.productDemand?.text} ids={c.productDemand?.evidence} byId={byId} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }} aria-label="Signals by intent">
            {Object.keys(INTENTS).map((k) => {
              const n = stats.intents[k] || 0;
              return (
                <div class="intent-row">
                  <span>{INTENTS[k]}</span>
                  <span class="bar">
                    <i class={k === 'purchase' ? 'purchase' : ''} style={{ width: `${stats.independent ? (n / stats.independent) * 100 : 0}%` }} />
                  </span>
                  <span class="mono">{n}</span>
                </div>
              );
            })}
          </div>
          <p class="small muted">Search interest is not sales, and attention from criticism is not demand.</p>
        </Section>

        <Section title="Competition and gap" extra={<span class="tag">{COMPETITION[c.competition?.level]?.label || 'Unknown'} competition</span>}>
          <Para text={c.competition?.text} ids={c.competition?.evidence} byId={byId} />
          <div>
            <span class="label">What is missing</span>
            <Para text={c.gap?.text} inference={c.gap?.isInference} />
          </div>
          <p class="small muted">Marketplace listings show supply, not proof of demand.</p>
        </Section>

        <Section title={`What to sell (${(c.products || []).length})`}>
          {(c.products || []).length === 0 ? <p class="muted">No product suggested. The research did not find a credible angle.</p> : null}
          <div class="products">
            {(c.products || []).map((p, i) => (
              <Product p={p} i={i} c={c} fit={a.gate.productFits[i]} byId={byId} prefs={prefs} />
            ))}
          </div>
        </Section>

        <Section title="Score breakdown" extra={<span class="small muted">heuristic, not a profit prediction</span>}>
          <div class="crit">
            {a.opportunity.breakdown.map((b) => (
              <>
                <span>
                  {b.label} <span class="muted mono small">{Math.round(b.weight)}%</span>
                </span>
                <span class={`bar${b.value === null ? ' unknown' : ''}`} title={b.value === null ? 'Not assessed: counts as zero' : `${b.value} of 5`}>
                  {b.value !== null ? <i style={{ width: `${(b.value / 5) * 100}%` }} /> : null}
                </span>
                <span class="mono">{b.value === null ? '—' : `${b.value}/5`}</span>
                <span class="why">
                  <span class={`tag ${b.basis === 'unknown' ? 'warn' : 'outline'}`}>{BASIS[b.basis]?.label}</span> {b.rationale || (b.value === null ? 'No usable evidence; counts as zero.' : '')}
                </span>
              </>
            ))}
          </div>
          {a.opportunity.unassessed.length ? (
            <p class="small ink2">
              {a.opportunity.unassessed.length} criteria not assessed. They count as zero, so the score can only stay the same or rise if evidence for them turns up (ceiling {a.opportunity.ceiling}).
            </p>
          ) : null}
        </Section>

        <Section title="Evidence confidence" extra={<span class="mono small muted">{a.confidence.score}/100</span>}>
          <div class="crit">
            {a.confidence.factors.map((f) => (
              <>
                <span>
                  {f.label} <span class="muted mono small">{Math.round(f.weight * 100)}%</span>
                </span>
                <span class="bar">
                  <i style={{ width: `${f.value * 100}%` }} />
                </span>
                <span class="mono">{Math.round(f.value * 100)}</span>
                <span class="why">{f.detail}</span>
              </>
            ))}
          </div>
          {a.confidence.adjustments.map((x) => (
            <p class="small ink2">{x}</p>
          ))}
        </Section>

        <Section title="History">
          {series.length ? (
            series.map((s) => <LineChart series={s} />)
          ) : (
            <p class="small muted">No chart: there are not yet three or more comparable stored measurements for this trend. The timeline below lists dated evidence instead.</p>
          )}
          <ReportedFigures observations={observations} byId={byId} />
          <SnapshotHistory snapshots={snapshots} changes={changes} />
          <EvidenceTimeline evidence={evidence} byId={byId} />
        </Section>

        <Section title={`Sources (${stats.independent} independent of ${stats.total})`} id="sources">
          <div class="evidence">
            {clusters
              .sort((x, y) => byId.get(x.primary.id).n - byId.get(y.primary.id).n)
              .map((cl) => (
                <EvidenceItem e={byId.get(cl.primary.id)} dupes={cl.items.slice(1).map((d) => byId.get(d.id))} c={c} multiRun={multiRun} />
              ))}
          </div>
        </Section>

        <Section title="Rights and open questions">
          <p>
            <span class={`tag ${c.rights?.risk === 'high' ? 'bad' : c.rights?.risk === 'medium' ? 'warn' : 'good'}`}>{c.rights?.risk || 'unknown'} rights risk</span> {c.rights?.note}
          </p>
          {c.unresolved?.length ? (
            <ul class="small" style={{ margin: 0, paddingLeft: '18px' }}>
              {c.unresolved.map((u) => (
                <li>{u}</li>
              ))}
            </ul>
          ) : (
            <p class="small muted">No open questions recorded.</p>
          )}
          {c.editorialNotes?.length ? (
            <details class="small">
              <summary class="muted">{c.editorialNotes.length} editorial review changes</summary>
              <ul>
                {c.editorialNotes.map((q) => (
                  <li>{q}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {c.qualityFlags?.length ? (
            <details class="small">
              <summary class="muted">{c.qualityFlags.length} data-quality notes from ingestion</summary>
              <ul>
                {c.qualityFlags.map((q) => (
                  <li>{q}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </Section>
      </div>
    </article>
  );
}

function Product({ p, i, c, fit, byId, prefs }) {
  const ttb = timeToBuyer(p, prefs);
  const total = Math.max(1, ttb.total);
  return (
    <div class="product">
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span class="tag accent">Option {i + 1}</span>
        <span class="tag">{fmtLabel(p.format)}</span>
        <span class="tag outline">{p.fulfillment === 'pod' ? 'Print on demand' : 'Digital download'}</span>
        <span class="tag outline">Effort: {p.effort}{p.effortHours ? ` · ~${p.effortHours} h` : ''}</span>
      </div>
      <h4>{p.theme}</h4>
      <div class="grid">
        <div>
          <span class="label">Buyer</span>
          {p.buyer || '—'}
        </div>
        <div>
          <span class="label">Why they would buy</span>
          {p.whyBuy || '—'}
          <Cites ids={p.evidence} evidenceById={byId} />
        </div>
        <div>
          <span class="label">Differentiation</span>
          {p.differentiation || '—'}
        </div>
        <div>
          <span class="label">Where buyers find it</span>
          {(p.channels || []).join(', ') || '—'}
        </div>
      </div>
      <div class="ttb">
        <span class="label">Time to first buyer (estimate)</span>
        <div class="ttb-bar" role="img" aria-label={`Build ${ttb.build} days, discovery ${ttb.discovery} days, delivery ${ttb.delivery} days`}>
          {ttb.build ? <i class="b" style={{ width: `${(ttb.build / total) * 100}%` }} /> : null}
          <i class="d" style={{ width: `${(ttb.discovery / total) * 100}%` }} />
          {ttb.delivery ? <i class="p" style={{ width: `${(ttb.delivery / total) * 100}%` }} /> : null}
        </div>
        <div class="ttb-legend">
          <span class="b">Build {ttb.build} d</span>
          <span class="d">Discovery {ttb.discovery} d</span>
          {ttb.delivery ? <span class="p">POD delivery {ttb.delivery} d</span> : null}
          <span>≈ {ttb.total} days</span>
        </div>
        <span class="small">
          {fit?.verdict === 'fits' && <span class="tag good">Fits window</span>}
          {fit?.verdict === 'tight' && <span class="tag warn">Tight</span>}
          {fit?.verdict === 'misses' && <span class="tag bad">Misses window</span>}
          {fit?.verdict === 'unknown' ? (
            <span class="muted">No dated window, so no fit verdict.</span>
          ) : (
            <span class="muted">
              {' '}
              {fit.remaining} days until {fit.estimated ? 'the estimated end' : 'the deadline'} ({fmtDate(fit.deadline)}).
            </span>
          )}
        </span>
        <span class="small muted">Discovery time assumes {prefs.audience === 'none' ? 'no existing audience' : `a ${prefs.audience} audience`}; change it in Settings.</span>
      </div>
      <div>
        <span class="label">Smallest useful test</span>
        <p class="small">{p.validationTest || '—'}</p>
      </div>
      <div class="plan">
        <div class="go">
          <span class="label">Continue if</span>
          <p>{p.continueIf || '—'}</p>
        </div>
        <div class="turn">
          <span class="label">Change direction if</span>
          <p>{p.pivotIf || '—'}</p>
        </div>
        <div class="stop">
          <span class="label">Stop if</span>
          <p>{p.stopIf || '—'}</p>
        </div>
      </div>
      {p.rightsNote ? (
        <p class="small">
          <span class="tag warn">Rights</span> {p.rightsNote}
        </p>
      ) : null}
    </div>
  );
}

function EvidenceItem({ e, dupes, c, multiRun }) {
  if (!e) return null;
  const isNew = e.firstSeenRunId === c.lastRunId;
  const carried = e.lastSeenRunId !== c.lastRunId;
  return (
    <div class="ev" id={`ev-${e.n}`}>
      <div class="ev-date">
        <span class="mono">[{e.n}]</span>
        <br />
        {e.publishedAt ? fmtDate(e.publishedAt) : 'Undated'}
      </div>
      <div class="ev-main">
        <a class="ev-title" href={safeHref(e.url)} target="_blank" rel="noopener noreferrer">
          {e.title || e.url}
        </a>
        <div class="ev-tags">
          <span class={`tag ${e.kind === 'observed' ? 'accent' : 'outline'}`}>{e.kind === 'observed' ? 'Observed' : 'Inference'}</span>
          <span class={`tag ${e.intent === 'purchase' ? 'good' : e.intent === 'criticism' ? 'bad' : ''}`}>{intentLabel(e.intent)}</span>
          <span class="tag">{signalLabel(e.signalType)}</span>
          <span class="tag outline" title="How this source was accessed">{accessLabel(e.accessMethod)}</span>
          {multiRun ? carried ? <span class="tag outline">Cached</span> : isNew ? <span class="tag good">New</span> : <span class="tag outline">Re-confirmed</span> : null}
        </div>
        <p class="ev-claim">{e.claim}</p>
        {e.excerpt ? <p class="ev-meta">Source said: {e.excerpt}</p> : null}
        <p class="ev-meta">
          {e.publisher ? `${e.publisher} · ` : ''}Retrieved {fmtDateTime(e.retrievedAt)}
        </p>
        {dupes.length ? (
          <div class="ev-dupes">
            Same story, not counted again:{' '}
            {dupes.map((d, i) => (
              <span>
                {i ? ', ' : ''}
                <a href={safeHref(d.url)} target="_blank" rel="noopener noreferrer">
                  {d.publisher || d.title || d.url}
                </a>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReportedFigures({ observations, byId }) {
  if (!observations.length) return null;
  return (
    <div>
      <span class="label">Reported figures (as stated by sources, not measured here)</span>
      <div class="table-wrap">
        <table class="t">
          <thead>
            <tr>
              <th>Figure</th>
              <th>Value</th>
              <th>As of</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {[...observations]
              .sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf))
              .map((o) => {
                const e = byId.get(o.evidenceId);
                return (
                  <tr>
                    <td>
                      {o.metric}
                      {o.note ? <div class="muted small">{o.note}</div> : null}
                    </td>
                    <td class="mono">
                      {o.value.toLocaleString('en-US')} {o.unit}
                      {!o.isAbsolute ? <div class="muted small">relative</div> : null}
                    </td>
                    <td class="mono">{fmtDate(o.asOf)}</td>
                    <td>
                      {e ? (
                        <a href={safeHref(e.url)} target="_blank" rel="noopener noreferrer">
                          [{e.n}] {e.publisher || 'source'}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SnapshotHistory({ snapshots, changes }) {
  const sorted = [...snapshots].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
  return (
    <div>
      <span class="label">Research snapshots ({sorted.length})</span>
      {sorted.length < 2 ? (
        <p class="small muted">One stored snapshot ({sorted[0] ? fmtDateTime(sorted[0].takenAt) : 'none'}). Changes appear after the next refresh is stored.</p>
      ) : (
        <div class="table-wrap">
          <table class="t">
            <thead>
              <tr>
                <th>Researched</th>
                <th>Score</th>
                <th>Confidence</th>
                <th>Stage</th>
                <th>Action</th>
                <th>Competition</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr>
                  <td class="mono">{fmtDateTime(s.takenAt)}</td>
                  <td class="mono">{s.score}</td>
                  <td class="mono">{s.confidence}</td>
                  <td>{STAGES[s.stage]?.label || s.stage}</td>
                  <td>{s.action?.replace('_', ' ')}</td>
                  <td>{COMPETITION[s.competition]?.label || s.competition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changes.comparable && changes.changes.length ? (
        <div class="changes" style={{ marginTop: '8px' }}>
          {changes.changes.map((ch) => (
            <ChangeLine ch={ch} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChangeLine({ ch }) {
  const arrow = typeof ch.delta === 'number' ? (ch.delta > 0 ? '▲' : '▼') : '→';
  return (
    <div class={`change ${ch.tone}`}>
      <span class="arrow" aria-hidden="true">
        {arrow}
      </span>
      <span>
        <b>{ch.label}</b>: {String(ch.from)} → {String(ch.to)}
        {typeof ch.delta === 'number' ? ` (${ch.delta > 0 ? '+' : ''}${ch.delta})` : ''}
      </span>
    </div>
  );
}

function EvidenceTimeline({ evidence, byId }) {
  const items = timeline(evidence).filter((e) => e.publishedAt);
  if (!items.length) return null;
  return (
    <div>
      <span class="label">Dated evidence timeline</span>
      <ol class="small" style={{ margin: '6px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {items.map((e) => (
          <li style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr)', gap: '10px' }}>
            <span class="mono ink2">{fmtDate(e.publishedAt)}</span>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <span class="mono muted">[{byId.get(e.id)?.n}]</span> {e.publisher ? `${e.publisher}: ` : ''}
              {e.title}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
