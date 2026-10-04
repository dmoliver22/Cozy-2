import { h } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { productEconomics, asymmetry } from '../core/economics.js';
import { fmtDate, safeHref } from './bits.jsx';

const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');

function PromptBlock({ title, text, note }) {
  const pre = useRef(null);
  const [state, setState] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('Copied');
    } catch {
      if (pre.current) window.getSelection()?.selectAllChildren(pre.current);
      setState('Selected: press Ctrl+C or ⌘C');
    }
    setTimeout(() => setState(''), 2500);
  };
  return (
    <div class="prompt-block">
      <div class="prompt-head">
        <span class="label">{title}</span>
        {note ? <span class="small muted">{note}</span> : null}
        <button class="btn small" onClick={copy} aria-label={`Copy ${title}`}>
          {state || 'Copy'}
        </button>
      </div>
      <pre ref={pre} class="prompt" tabIndex={0}>
        {text}
      </pre>
    </div>
  );
}

export function AsymmetryChip({ asym }) {
  if (!asym) return null;
  return (
    <span class={`tag ${asym.tone}`} title={`Asymmetry ${asym.score}/100: how small and capped the downside is compared with how open the upside is.`}>
      {asym.label}
    </span>
  );
}

export function Playbook({ product, candidate, bet, table, index = 0 }) {
  const [tab, setTab] = useState('make');
  const [price, setPrice] = useState(null);
  const pb = bet.playbook;
  const econ = price == null ? bet.econ : productEconomics(product, pb, table, price);
  const asym = price == null ? bet.asym : asymmetry({ product, candidate, econ, playbook: pb });
  const tabs = [
    ['make', 'Make it'],
    ['sell', 'Sell it'],
    ['profit', 'Profit'],
    ['asym', 'Asymmetry'],
  ];
  return (
    <section class="pb" aria-label="Make and sell playbook">
      <div class="pb-head">
        <span class="label">Make &amp; sell playbook</span>
        {pb.productName ? <b>{pb.productName}</b> : null}
        <AsymmetryChip asym={asym} />
        {econ.primary && econ.primary.net != null ? <span class="small ink2">≈ {money(econ.primary.net)} kept per sale on {econ.primary.label}</span> : null}
        {bet.fallback ? <span class="tag warn">Template: no written playbook yet</span> : <span class="tag outline">Written playbook</span>}
      </div>
      {bet.stale ? <p class="small notice warn">This playbook was written for an earlier version of this product. Check it against the product above.</p> : null}
      <div class="pb-tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button role="tab" aria-selected={tab === k ? 'true' : 'false'} class="pb-tab" onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'make' ? (
        <div class="pb-body">
          <PromptBlock title="Super prompt" note="Paste into Claude or ChatGPT" text={pb.superPrompt} />
          {pb.imagePrompts.map((ip, i) => (
            <PromptBlock title={`Image prompt ${i + 1}: ${ip.purpose || 'artwork'}`} note={ip.tool} text={ip.prompt} />
          ))}
          {pb.assembly.length ? (
            <div>
              <span class="label">Build and export</span>
              <ol class="steps-list">
                {pb.assembly.map((s) => (
                  <li>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
          {pb.listingPrompt ? <PromptBlock title="Listing copy prompt" note="Title, tags, description" text={pb.listingPrompt} /> : null}
          <p class="small muted">Review everything the AI produces before selling: check accuracy, spelling and that nothing copies a brand, film, person or existing design.</p>
        </div>
      ) : null}

      {tab === 'sell' ? (
        <div class="pb-body">
          {pb.marketing.positioning ? <p><b>Positioning:</b> {pb.marketing.positioning}</p> : null}
          {pb.platforms.length ? (
            <div class="table-wrap">
              <table class="t">
                <thead>
                  <tr>
                    <th>Where to list</th>
                    <th>Role</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {pb.platforms.map((p) => (
                    <tr>
                      <td>{p.name}</td>
                      <td>
                        <span class={`tag ${p.role === 'primary' ? 'accent' : 'outline'}`}>{p.role}</span>
                      </td>
                      <td class="small ink2">{p.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p class="small muted">No platform plan yet.</p>
          )}
          {pb.marketing.launchPlan.length ? (
            <div>
              <span class="label">Launch plan</span>
              <ol class="timeline">
                {pb.marketing.launchPlan.map((s) => (
                  <li>
                    <span class="mono">{s.day}</span>
                    <span>{s.action}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {pb.marketing.channels.length ? (
            <div class="table-wrap">
              <table class="t">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>What to do</th>
                    <th>How often</th>
                  </tr>
                </thead>
                <tbody>
                  {pb.marketing.channels.map((c) => (
                    <tr>
                      <td>{c.channel}</td>
                      <td class="small">{c.tactic}</td>
                      <td class="small ink2">{c.cadence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {pb.marketing.keywords.length ? (
            <PromptBlock title="Search phrases to test" note="Suggestions, not measured volumes" text={pb.marketing.keywords.join(', ')} />
          ) : null}
          {pb.marketing.hooks.length ? (
            <div>
              <span class="label">Post and video hooks</span>
              <ul class="small" style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {pb.marketing.hooks.map((x) => (
                  <li>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'profit' ? (
        <div class="pb-body">
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label class="field">
              <span>Your price (USD)</span>
              <input
                type="number"
                min="0"
                step="0.5"
                id={`price-${candidate.id}-${index}`}
                value={price ?? pb.pricing.recommended ?? ''}
                onInput={(e) => setPrice(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
              />
            </label>
            {pb.pricing.low != null ? (
              <span class="small ink2">
                Suggested {money(pb.pricing.low)}–{money(pb.pricing.high)} ({pb.pricing.basis}). {pb.pricing.rationale}
              </span>
            ) : null}
          </div>
          {econ.rows.length ? (
            <div class="table-wrap">
              <table class="t">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Price</th>
                    <th>Fees</th>
                    <th>Product + shipping</th>
                    <th>You keep</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {econ.rows.map((r) => (
                    <tr>
                      <td>{r.label}</td>
                      <td class="mono">{money(r.price)}</td>
                      <td class="mono">{money(r.fees)}</td>
                      <td class="mono">{r.unknownCost ? 'unknown' : money(r.cost)}</td>
                      <td class="mono">
                        <b>{money(r.net)}</b>
                      </td>
                      <td class="mono">{r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p class="small muted">Set a price to see what you keep per sale.</p>
          )}
          <dl class="kv">
            <dt>Product cost</dt>
            <dd>
              {econ.cost.basis === 'digital'
                ? 'None: digital download.'
                : econ.cost.basis === 'verified'
                  ? `${money(econ.cost.base)} base + ${money(econ.cost.shipping)} US shipping (verified ${econ.cost.provider || 'provider'} pricing).`
                  : econ.cost.basis === 'mixed'
                    ? `${money(econ.cost.base)} base (${econ.cost.baseVerified ? `verified ${econ.cost.provider} price` : 'estimate'}) + ${money(econ.cost.shipping)} US shipping (${econ.cost.shippingVerified ? 'verified Printify rate' : 'estimate'}). Shipping is assumed to be charged to the buyer at cost.`
                  : econ.cost.basis === 'estimate'
                    ? `${money(econ.cost.base)} base + ${money(econ.cost.shipping)} shipping: an estimate for ${econ.cost.provider || 'a POD provider'}; check the catalog before pricing. Shipping is assumed to be charged to the buyer at cost.`
                    : 'Unknown: add the provider base cost before trusting the margin.'}
            </dd>
            <dt>Cash at risk</dt>
            <dd>
              {money(econ.cashAtRisk)}
              <span class="muted small">
                {' '}
                ({[econ.testBudget ? `${money(econ.testBudget)} test ads` : null, econ.sample ? `${money(econ.sample)} sample order` : null, econ.listing ? `${money(econ.listing)} listing fee` : null].filter(Boolean).join(' + ') || 'nothing beyond your time'})
              </span>
            </dd>
            <dt>Break-even</dt>
            <dd>{econ.breakEven ? `${econ.breakEven} sale${econ.breakEven === 1 ? '' : 's'} on ${econ.primary.label}` : 'Not computable until price and costs are set.'}</dd>
          </dl>
          {econ.notModeled ? <p class="small muted">Redbubble and TeePublic set their own base prices and pay you a markup, so they are not modeled here.</p> : null}
          <FeeNotes table={table} rows={econ.rows} />
          <p class="small muted">Per-sale arithmetic only. It is not a forecast of how many you will sell.</p>
        </div>
      ) : null}

      {tab === 'asym' ? (
        <div class="pb-body">
          <div class="asym-head">
            <span class={`asym-score ${asym.tone}`}>{asym.score}</span>
            <div>
              <b>{asym.label}</b>
              <p class="small ink2">
                Risk {money(asym.downside.cash)} and about {asym.downside.hours} hours.{' '}
                {asym.downside.breakEven ? `${asym.downside.breakEven} sale${asym.downside.breakEven === 1 ? '' : 's'} pays it back. ` : ''}
                The test answers in about {asym.downside.killDays} days.
              </p>
            </div>
          </div>
          <div class="crit">
            {asym.factors.map((f) => (
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
          <p class="small ink2">
            Downside is <b>{asym.downside.label.toLowerCase()}</b>
            {asym.multiplier < 1 ? `, so the upside score of ${asym.upside} is discounted ×${asym.multiplier}.` : ': the upside score stands.'}
          </p>
          {pb.asymmetry.downside || pb.asymmetry.upside ? (
            <dl class="kv">
              {pb.asymmetry.downside ? (
                <>
                  <dt>What you risk</dt>
                  <dd>{pb.asymmetry.downside}</dd>
                </>
              ) : null}
              {pb.asymmetry.upside ? (
                <>
                  <dt>What stays open</dt>
                  <dd>{pb.asymmetry.upside}</dd>
                </>
              ) : null}
              {pb.asymmetry.badBetIf ? (
                <>
                  <dt>Bad bet if</dt>
                  <dd>{pb.asymmetry.badBetIf}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {pb.extensions.length ? (
            <div>
              <span class="label">Ways to extend the upside</span>
              <ul class="small" style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {pb.extensions.map((x) => (
                  <li>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {pb.risks.length ? (
            <div>
              <span class="label">Risks</span>
              <ul class="small" style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {pb.risks.map((x) => (
                  <li>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p class="small muted">A heuristic about the shape of the risk, not a prediction of profit.</p>
        </div>
      ) : null}
    </section>
  );
}

function FeeNotes({ table, rows }) {
  const used = new Set();
  for (const r of rows) {
    if (r.channel === 'etsy') ['etsy_listing_fee', 'etsy_transaction_pct', 'etsy_processing_pct', 'etsy_processing_fixed'].forEach((k) => used.add(k));
    if (r.channel === 'gumroad') ['gumroad_pct', 'gumroad_fixed'].forEach((k) => used.add(k));
    if (r.channel === 'payhip') ['payhip_free_pct', 'processor_pct', 'processor_fixed'].forEach((k) => used.add(k));
    if (r.channel === 'kdp') ['kdp_royalty_pct', 'kdp_royalty_low_pct', 'kdp_bw_fixed', 'kdp_bw_per_page', 'kdp_bw_flat_short'].forEach((k) => used.add(k));
  }
  const items = [...used].map((k) => ({ k, ...table[k] })).filter((x) => x.label);
  if (!items.length) return null;
  return (
    <details class="small">
      <summary class="muted">Fee assumptions used ({items.filter((x) => x.status === 'verified').length} of {items.length} verified)</summary>
      <ul>
        {items.map((x) => (
          <li>
            {x.label}: <span class="mono">{x.unit === 'percent' ? `${x.value}%` : x.unit === 'usd_per_page' ? `$${x.value}/page` : money(x.value)}</span>{' '}
            {x.status === 'verified' ? (
              <span>
                <span class="tag good">verified</span>{' '}
                {x.source ? (
                  <a href={safeHref(x.source)} target="_blank" rel="noopener noreferrer">
                    source
                  </a>
                ) : null}{' '}
                {x.retrievedAt ? `· checked ${fmtDate(x.retrievedAt)}` : ''}
              </span>
            ) : x.status === 'override' ? (
              <span class="tag accent">your setting</span>
            ) : (
              <span class="tag warn">default assumption, not verified</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
