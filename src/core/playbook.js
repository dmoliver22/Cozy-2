// Make-and-sell playbooks: validation of stored playbooks and a template fallback so every
// product idea has a usable super prompt, even before a written playbook exists.
// Playbooks are guidance, not evidence: prices and costs inside them are estimates.

const s = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v, max = 20, len = 600) => (Array.isArray(v) ? v.map((x) => s(x, len)).filter(Boolean).slice(0, max) : []);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const ROLES = ['primary', 'secondary', 'traffic'];

export function themeKey(theme) {
  return s(theme, 60);
}

/** Validate one product playbook from a writer or the research worker. */
export function cleanPlaybookProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const superPrompt = s(raw.superPrompt, 12000);
  if (!superPrompt) return null;
  const pricing = raw.pricing || {};
  const costs = raw.costs || {};
  const m = raw.marketing || {};
  return {
    index: Number.isInteger(raw.index) ? raw.index : 0,
    themeKey: s(raw.themeKey, 60),
    productName: s(raw.productName, 120),
    superPrompt,
    imagePrompts: (Array.isArray(raw.imagePrompts) ? raw.imagePrompts : [])
      .map((x) => ({ tool: s(x?.tool, 80), purpose: s(x?.purpose, 120), prompt: s(x?.prompt, 3000) }))
      .filter((x) => x.prompt)
      .slice(0, 8),
    assembly: list(raw.assembly, 12, 500),
    listingPrompt: s(raw.listingPrompt, 5000),
    pricing: {
      recommended: num(pricing.recommended),
      low: num(pricing.low),
      high: num(pricing.high),
      currency: s(pricing.currency, 3) || 'USD',
      rationale: s(pricing.rationale, 600),
      basis: s(pricing.basis, 120) || 'estimate',
    },
    costs: {
      provider: s(costs.provider, 60) || null,
      item: s(costs.item, 120) || null,
      baseCost: num(costs.baseCost),
      shipping: num(costs.shipping),
      pages: num(costs.pages),
      basis: s(costs.basis, 200) || 'estimate',
      testBudget: num(costs.testBudget) ?? 0,
      testBudgetNote: s(costs.testBudgetNote, 300),
    },
    platforms: (Array.isArray(raw.platforms) ? raw.platforms : [])
      .map((p) => ({ name: s(p?.name, 60), role: ROLES.includes(p?.role) ? p.role : 'secondary', why: s(p?.why, 400) }))
      .filter((p) => p.name)
      .slice(0, 8),
    marketing: {
      positioning: s(m.positioning, 400),
      launchPlan: (Array.isArray(m.launchPlan) ? m.launchPlan : [])
        .map((x) => ({ day: s(x?.day, 30), action: s(x?.action, 600) }))
        .filter((x) => x.action)
        .slice(0, 14),
      channels: (Array.isArray(m.channels) ? m.channels : [])
        .map((x) => ({ channel: s(x?.channel, 60), tactic: s(x?.tactic, 600), cadence: s(x?.cadence, 160) }))
        .filter((x) => x.channel)
        .slice(0, 10),
      keywords: list(m.keywords, 20, 60),
      hooks: list(m.hooks, 8, 300),
    },
    extensions: list(raw.extensions, 8, 300),
    asymmetry: { downside: s(raw.asymmetry?.downside, 600), upside: s(raw.asymmetry?.upside, 600), badBetIf: s(raw.asymmetry?.badBetIf, 600) },
    risks: list(raw.risks, 8, 400),
    source: s(raw.source, 30) || 'written',
  };
}

/** Pair a candidate's products with stored playbooks by index, checking the theme still matches. */
export function matchPlaybooks(candidate, doc) {
  const stored = Array.isArray(doc?.products) ? doc.products : [];
  return (candidate?.products || []).map((p, i) => {
    const pb = stored.find((x) => x.index === i) || null;
    if (!pb) return { playbook: fallbackPlaybook(p, candidate), stale: false, fallback: true };
    const stale = !!pb.themeKey && !String(p.theme || '').startsWith(pb.themeKey.slice(0, 40));
    return { playbook: pb, stale, fallback: false };
  });
}

const FORMAT_SPECS = {
  printable: 'A print-ready PDF set: US Letter (8.5x11 in) and A4 versions, 0.5 in margins, high-contrast text that prints well in black and white as well as color.',
  planner: 'A dated planner as a printable PDF (US Letter and A4) plus a hyperlinked tablet PDF (landscape, tabs for each month) for GoodNotes or Notability.',
  journal: 'A 6x9 in paperback interior for Amazon KDP (0.375 in inside margins, 0.25 in outer, no bleed, black and white) plus a printable PDF version.',
  ebook: 'A 20–40 page guide as a PDF (US Letter), with a cover, contents page, short chapters, checklists and a one-page summary.',
  template: 'A Google Sheets template (shared as a "make a copy" link) with an Instructions tab, protected formula cells and example rows the buyer can clear.',
  bundle: 'A zipped bundle of editable Canva templates and print-ready PDFs (US Letter and A4), each file named clearly, plus a one-page start-here guide.',
  poster: 'Wall-art files at 300 DPI in 2:3 (24x36 in), 3:4 (18x24 in), 4:5 (16x20 in), ISO A1 and 11x14 in ratios.',
  sticker: 'Die-cut sticker art: transparent PNG at 300 DPI, at least 1500x1500 px, a 0.125 in white border, bold shapes that read at 3 inches.',
  tshirt: 'Front print art: transparent PNG 4500x5400 px at 300 DPI, legible at arm’s length, limited to 3–4 flat colors.',
  mug: 'An 11 oz mug wrap: 2475x1155 px PNG at 300 DPI, artwork kept clear of the handle area, readable from both sides.',
  tote: 'Tote print art: transparent PNG 3600x3600 px at 300 DPI, high-contrast line art that prints well on natural canvas.',
  other: 'Production-ready files at 300 DPI in the sizes the chosen marketplace or print provider requires.',
};

/** A template super prompt built from the product's own research fields. */
export function fallbackPlaybook(product, candidate) {
  const format = product?.format || 'other';
  const spec = FORMAT_SPECS[format] || FORMAT_SPECS.other;
  const rights = [candidate?.rights?.note, product?.rightsNote].filter(Boolean).join(' ');
  const superPrompt = [
    `You are a product designer and writer creating a ${format === 'other' ? 'product' : format} to sell online to US buyers.`,
    '',
    `PRODUCT: ${product?.theme || 'Untitled product'}`,
    `TREND CONTEXT: ${candidate?.name || ''}. ${candidate?.summary || ''}`,
    `BUYER: ${product?.buyer || 'Not specified'}`,
    `WHY THEY BUY: ${product?.whyBuy || 'Not specified'}`,
    `HOW IT MUST STAND OUT: ${product?.differentiation || 'Make it clearly more useful or more beautiful than generic alternatives.'}`,
    '',
    `DELIVERABLE: ${spec}`,
    '',
    'PRODUCE:',
    '1. A product name and a one-sentence promise of what it helps the buyer do (no outcome guarantees).',
    '2. The complete content, page by page (or tab by tab, or design by design): every heading, label, prompt, instruction and example, written in full and ready to paste into Canva or Google Sheets.',
    '3. A design system: two font pairings available in Canva, a five-color palette with hex codes that fits the trend, and layout notes for each page type.',
    '4. Image-generation prompts for every illustration or cover, each with style, composition, colors, aspect ratio and background, and ending with "no logos, no real people, no trademarked characters, no watermarks".',
    '5. A short "how to use" page for the buyer.',
    '',
    `RULES: Everything must be original. ${rights || 'Do not use trademarks, brand names, celebrity names or copyrighted artwork.'} Make no health, financial, spiritual or outcome claims. Keep reading level around grade 8.`,
    '',
    'Before answering, check: every page is fully written (no placeholders except [SHOP NAME]); nothing references a brand, film, celebrity or trademark; sizes match the deliverable spec.',
  ].join('\n');
  const listingPrompt = [
    `Write an Etsy listing for: ${product?.theme || 'this product'}. Buyer: ${product?.buyer || 'see above'}.`,
    'Give: a title under 140 characters that starts with the phrase a buyer would search; 13 tags of 20 characters or fewer; a description with what is included, file formats and sizes, how delivery works (instant download or made to order), and a 4-question FAQ.',
    'Do not use trademarked terms, brand names or celebrity names. No outcome claims.',
  ].join('\n');
  const digital = product?.fulfillment !== 'pod';
  return {
    index: 0,
    themeKey: themeKey(product?.theme),
    productName: '',
    superPrompt,
    imagePrompts: [],
    assembly: [],
    listingPrompt,
    pricing: { recommended: null, low: null, high: null, currency: 'USD', rationale: '', basis: 'not set' },
    costs: { provider: digital ? null : 'Printify', item: null, baseCost: null, shipping: null, pages: null, basis: 'not set', testBudget: 0, testBudgetNote: '' },
    platforms: (product?.channels || []).map((name, i) => ({ name, role: i === 0 ? 'primary' : 'secondary', why: 'Suggested in research.' })),
    marketing: { positioning: '', launchPlan: [], channels: [], keywords: [], hooks: [] },
    extensions: [],
    asymmetry: { downside: '', upside: '', badBetIf: '' },
    risks: [],
    source: 'template',
  };
}
