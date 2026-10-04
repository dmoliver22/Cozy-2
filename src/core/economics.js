// Unit economics and bet asymmetry for a product idea.
// Every figure is either a verified fee (with source and date, from config/fees), a user
// override (Settings), or a labeled default assumption. Nothing here forecasts revenue:
// it is per-sale arithmetic and break-even counts.

// Defaults are assumptions from published fee schedules known before this research and are
// shown as "not verified" until config/fees confirms them.
export const DEFAULT_FEES = {
  etsy_listing_fee: { value: 0.2, unit: 'usd', label: 'Etsy listing / auto-renew fee (per sale)' },
  etsy_transaction_pct: { value: 6.5, unit: 'percent', label: 'Etsy transaction fee (item + shipping)' },
  etsy_processing_pct: { value: 3, unit: 'percent', label: 'Etsy payment processing (US)' },
  etsy_processing_fixed: { value: 0.25, unit: 'usd', label: 'Etsy payment processing fixed (US)' },
  etsy_offsite_ads_pct: { value: 15, unit: 'percent', label: 'Etsy Offsite Ads (only on ad-attributed sales)' },
  gumroad_pct: { value: 10, unit: 'percent', label: 'Gumroad fee (direct sales)' },
  gumroad_fixed: { value: 0.5, unit: 'usd', label: 'Gumroad fixed fee per sale' },
  payhip_free_pct: { value: 5, unit: 'percent', label: 'Payhip free-plan fee' },
  processor_pct: { value: 2.9, unit: 'percent', label: 'Card processor (Stripe/PayPal) for Payhip' },
  processor_fixed: { value: 0.3, unit: 'usd', label: 'Card processor fixed fee for Payhip' },
  kdp_royalty_pct: { value: 60, unit: 'percent', label: 'Amazon KDP paperback royalty (list price $9.99+)' },
  kdp_royalty_low_pct: { value: 50, unit: 'percent', label: 'Amazon KDP paperback royalty (list price $9.98 or less)' },
  kdp_bw_flat_short: { value: 2.3, unit: 'usd', label: 'KDP black-and-white print cost, flat for 24–109 pages' },
  kdp_bw_fixed: { value: 1.0, unit: 'usd', label: 'KDP black-and-white print cost, fixed' },
  kdp_bw_per_page: { value: 0.012, unit: 'usd_per_page', label: 'KDP black-and-white print cost, per page' },
};

// POD item -> fee keys that a verification run may fill in.
// Base-cost keys are tried in order (Printify first, then Printful); shipping is Printify only.
const POD_KEYS = {
  sticker: { base: ['printify_sticker_3x3_base', 'printful_sticker_3x3_base'], shipping: 'printify_sticker_shipping' },
  mug: { base: ['printify_mug_11oz_base', 'printful_mug_11oz_base'], shipping: 'printify_mug_shipping' },
  tshirt: { base: ['printify_tee_3001_base', 'printful_tee_3001_base'], shipping: 'printify_tee_shipping' },
  tote: { base: ['printify_tote_base', 'printful_tote_base'], shipping: 'printify_tote_shipping' },
  poster: { base: ['printify_poster_18x24_base'], shipping: 'printify_poster_shipping' },
  ornament: { base: ['printify_ornament_base'], shipping: 'printify_ornament_shipping' },
};

/**
 * Merge defaults, verified figures and user overrides into one table:
 * { key: { value, unit, label, status: 'default' | 'verified' | 'override' | 'unavailable', source, retrievedAt, note } }
 */
export function feeTable(verified, overrides = {}) {
  const table = {};
  for (const [k, d] of Object.entries(DEFAULT_FEES)) table[k] = { ...d, status: 'default', source: null, retrievedAt: null, note: '' };
  for (const it of verified?.items || []) {
    if (!it || !it.key) continue;
    const base = table[it.key] || { label: `${it.platform || ''} ${it.item || it.key}`.trim(), unit: it.unit };
    const value = typeof it.value === 'number' && Number.isFinite(it.value) ? it.value : null;
    table[it.key] = {
      ...base,
      value: value ?? base.value ?? null,
      unit: it.unit || base.unit,
      status: value === null ? (base.value != null ? 'default' : 'unavailable') : 'verified',
      source: it.source || null,
      retrievedAt: it.retrievedAt || null,
      publishedAt: it.publishedAt || null,
      note: it.note || '',
    };
  }
  for (const [k, v] of Object.entries(overrides || {})) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    table[k] = { ...(table[k] || { label: k, unit: 'usd' }), value: n, status: 'override' };
  }
  return table;
}

const fee = (t, k) => (t[k] && Number.isFinite(t[k].value) ? t[k].value : 0);
const round2 = (n) => Math.round(n * 100) / 100;

function podItem(product) {
  const f = product?.format;
  if (POD_KEYS[f]) return f;
  const theme = `${product?.theme || ''}`.toLowerCase();
  if (theme.includes('ornament')) return 'ornament';
  if (theme.includes('sticker')) return 'sticker';
  if (theme.includes('mug')) return 'mug';
  if (theme.includes('tote')) return 'tote';
  if (theme.includes('poster') || theme.includes('print')) return 'poster';
  return null;
}

/** Product cost per unit for POD: verified figures first, then the playbook estimate. */
export function productCost(product, playbook, table) {
  if (product?.fulfillment !== 'pod') return { base: 0, shipping: 0, basis: 'digital', item: null };
  const item = podItem(product);
  const keys = item ? POD_KEYS[item] : null;
  const baseKey = keys ? keys.base.find((k) => table[k]?.status === 'verified') : null;
  const vb = baseKey ? table[baseKey].value : null;
  const vs = keys && table[keys.shipping]?.status === 'verified' ? table[keys.shipping].value : null;
  const toNum = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const base = vb ?? toNum(playbook?.costs?.baseCost);
  const shipping = vs ?? toNum(playbook?.costs?.shipping);
  const verifiedProvider = baseKey ? (baseKey.startsWith('printful') ? 'Printful' : 'Printify') : null;
  let basis = 'unknown';
  if (base != null && shipping != null) basis = vb != null && vs != null ? 'verified' : vb != null || vs != null ? 'mixed' : 'estimate';
  return { base, shipping, item, basis, baseVerified: vb != null, shippingVerified: vs != null, provider: verifiedProvider || playbook?.costs?.provider || null };
}

function channelKey(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('etsy')) return 'etsy';
  if (n.includes('gumroad')) return 'gumroad';
  if (n.includes('payhip')) return 'payhip';
  if (n.includes('kdp') || n.includes('amazon')) return 'kdp';
  if (n.includes('redbubble') || n.includes('teepublic')) return 'marketplace_pod';
  return null;
}

/**
 * Per-sale arithmetic for one channel. Shipping on POD orders is assumed to be charged to the
 * buyer at cost, so it passes through but still attracts percentage fees.
 */
export function channelEconomics(channel, { price, cost, table, pages = 120 }) {
  const p = Number(price) || 0;
  const pod = cost.basis !== 'digital';
  const base = pod ? cost.base : 0;
  const ship = pod ? cost.shipping ?? 0 : 0;
  const unknownCost = pod && (cost.base == null || cost.shipping == null);
  if (channel === 'etsy') {
    const total = p + ship;
    const fees = fee(table, 'etsy_listing_fee') + (total * (fee(table, 'etsy_transaction_pct') + fee(table, 'etsy_processing_pct'))) / 100 + fee(table, 'etsy_processing_fixed');
    if (unknownCost) return { channel, label: 'Etsy', price: p, fees: round2(fees), cost: null, net: null, marginPct: null, unknownCost };
    const net = p + ship - fees - base - ship;
    return { channel, label: 'Etsy', price: p, fees: round2(fees), cost: round2(base + ship), net: round2(net), marginPct: p ? Math.round((net / p) * 100) : 0, unknownCost };
  }
  if (channel === 'gumroad' && !pod) {
    const fees = (p * fee(table, 'gumroad_pct')) / 100 + fee(table, 'gumroad_fixed');
    return { channel, label: 'Gumroad', price: p, fees: round2(fees), cost: 0, net: round2(p - fees), marginPct: p ? Math.round(((p - fees) / p) * 100) : 0, unknownCost: false };
  }
  if (channel === 'payhip' && !pod) {
    const fees = (p * (fee(table, 'payhip_free_pct') + fee(table, 'processor_pct'))) / 100 + fee(table, 'processor_fixed');
    return { channel, label: 'Payhip', price: p, fees: round2(fees), cost: 0, net: round2(p - fees), marginPct: p ? Math.round(((p - fees) / p) * 100) : 0, unknownCost: false };
  }
  if (channel === 'kdp') {
    const print = pages < 110 ? fee(table, 'kdp_bw_flat_short') : fee(table, 'kdp_bw_fixed') + fee(table, 'kdp_bw_per_page') * pages;
    const rate = p >= 9.99 ? fee(table, 'kdp_royalty_pct') : fee(table, 'kdp_royalty_low_pct');
    const royalty = (p * rate) / 100 - print;
    return { channel, label: `Amazon KDP (${pages}-page B&W, ${rate}% royalty)`, price: p, fees: round2(p - (p * rate) / 100), cost: round2(print), net: round2(royalty), marginPct: p ? Math.round((royalty / p) * 100) : 0, unknownCost: false };
  }
  return null;
}

/** Everything the profit table needs for one product. */
export function productEconomics(product, playbook, table, priceOverride) {
  const price = Number(priceOverride ?? playbook?.pricing?.recommended) || null;
  const cost = productCost(product, playbook, table);
  const named = (playbook?.platforms || []).filter((x) => x.role !== 'traffic');
  let keys = [...new Set(named.map((x) => channelKey(x.name)).filter(Boolean))];
  if (!keys.length) keys = product?.fulfillment === 'pod' ? ['etsy'] : ['etsy', 'gumroad'];
  const pages = Number(playbook?.costs?.pages) || 120;
  // Journals, planners and ebooks sell as a printable/digital file everywhere except KDP,
  // where Amazon prints the paperback and deducts its own print cost.
  const paper = ['journal', 'planner', 'ebook'].includes(product?.format);
  const DIGITAL = { base: 0, shipping: 0, basis: 'digital', item: null };
  const costFor = (k) => (paper && k !== 'kdp' ? DIGITAL : cost);
  const rows = price ? keys.map((k) => channelEconomics(k, { price, cost: costFor(k), table, pages })).filter(Boolean) : [];
  const notModeled = keys.includes('marketplace_pod');
  const primaryName = named.find((x) => x.role === 'primary')?.name;
  const primary = rows.find((r) => r.channel === channelKey(primaryName)) || rows[0] || null;
  const testBudget = Math.max(0, Number(playbook?.costs?.testBudget) || 0);
  const primaryCost = costFor(primary?.channel || keys[0]);
  const sample = primaryCost.basis === 'digital' || primary?.channel === 'kdp' ? 0 : (primaryCost.base || 0) + (primaryCost.shipping || 0);
  const listing = keys.includes('etsy') ? fee(table, 'etsy_listing_fee') : 0;
  const cashAtRisk = round2(testBudget + sample + listing);
  const breakEven = primary && primary.net != null && primary.net > 0 ? Math.max(1, Math.ceil(cashAtRisk / primary.net)) : null;
  return { price, cost: primaryCost, podCost: cost, rows, primary, notModeled, cashAtRisk, testBudget, sample: round2(sample), listing, breakEven, pages, paper };
}

const HOURS_BY_EFFORT = { low: 6, medium: 14, high: 30 };
const DAY = 86400000;

/**
 * How lopsided the bet is: a small, capped downside against an open upside.
 * Returns a 0–100 score, a label, and every factor so the UI can show its working.
 */
export function asymmetry({ product, candidate, econ, playbook, now = Date.now() }) {
  const digital = product?.fulfillment === 'digital';
  const hours = Number.isFinite(product?.effortHours) && product.effortHours > 0 ? product.effortHours : HOURS_BY_EFFORT[product?.effort] || 14;
  const net = econ?.primary?.net ?? null;
  const price = econ?.price || null;
  const durability = Number(candidate?.scores?.durability?.score);
  const sellChannels = new Set((playbook?.platforms || []).filter((x) => x.role !== 'traffic').map((x) => channelKey(x.name) || x.name)).size || 1;
  const extensions = (playbook?.extensions || []).length;
  const deadline = Date.parse(candidate?.window?.sellBy || '');
  const daysLeft = Number.isFinite(deadline) ? Math.floor((deadline - now) / DAY) : null;
  const factors = [
    { key: 'marginal', label: 'Zero marginal cost', weight: 0.25, value: digital ? 1 : 0.3, detail: digital ? 'Digital file: every extra sale costs nothing to make.' : 'Print on demand: each sale carries a base cost.' },
    { key: 'margin', label: 'Margin per sale', weight: 0.2, value: net != null && price ? Math.max(0, Math.min(1, net / price)) : 0, detail: net != null && price ? `About ${Math.round((net / price) * 100)}% of the price is kept after fees and costs.` : 'Unknown until a price and costs are set.' },
    { key: 'durability', label: 'Shelf life', weight: 0.2, value: Number.isFinite(durability) ? durability / 5 : 0, detail: Number.isFinite(durability) ? `Durability scored ${durability} of 5 in research.` : 'Durability not assessed (counts as zero).' },
    { key: 'reuse', label: 'Sells in several places', weight: 0.15, value: Math.min(sellChannels / 3, 1), detail: `${sellChannels} sales channel${sellChannels === 1 ? '' : 's'} planned; 3+ counts as full.` },
    { key: 'extensions', label: 'Room to extend', weight: 0.1, value: Math.min(extensions / 3, 1), detail: `${extensions} bundle, series or upsell idea${extensions === 1 ? '' : 's'}.` },
    { key: 'window', label: 'No hard deadline', weight: 0.1, value: daysLeft == null ? 1 : daysLeft >= 60 ? 0.8 : daysLeft >= 30 ? 0.5 : 0.2, detail: daysLeft == null ? 'No fixed sell-by date.' : `${daysLeft} days until the fixed deadline.` },
  ];
  const upside = factors.reduce((a, f) => a + f.weight * f.value, 0) * 100;
  const cash = econ?.cashAtRisk ?? 0;
  const be = econ?.breakEven ?? Infinity;
  let multiplier = 0.7;
  let downsideLabel = 'Large';
  if (cash <= 30 && hours <= 10 && be <= 5) {
    multiplier = 1;
    downsideLabel = 'Small';
  } else if (cash <= 60 && hours <= 20 && be <= 15) {
    multiplier = 0.85;
    downsideLabel = 'Moderate';
  }
  const score = Math.round(upside * multiplier);
  const label = score >= 70 ? 'Strongly asymmetric' : score >= 55 ? 'Asymmetric' : score >= 40 ? 'Roughly even' : 'Unfavorable';
  const tone = score >= 70 ? 'good' : score >= 55 ? 'good' : score >= 40 ? 'warn' : 'bad';
  return {
    score,
    label,
    tone,
    factors,
    upside: Math.round(upside),
    multiplier,
    downside: { label: downsideLabel, cash, hours, breakEven: Number.isFinite(be) ? be : null, killDays: killDays(playbook) },
  };
}

/** Days until the validation test gives an answer: the last numbered day of the launch plan, or 21. */
export function killDays(playbook) {
  const days = (playbook?.marketing?.launchPlan || []).map((s) => Number(String(s.day || '').match(/\d+/)?.[0])).filter((n) => Number.isFinite(n));
  return days.length ? Math.max(...days) : 21;
}
