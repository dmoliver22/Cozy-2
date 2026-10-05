// End-to-end check of the built dashboard in Chromium with a mocked claude.ai runtime.
// The mock implements the db, user and mcp surfaces the page uses, persists the
// database across reloads, and can simulate the research worker.
// Usage: node scripts/verify-ui.mjs [screenshotDir]
import { chromium } from 'playwright-core';
import { readFile, readdir, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const shots = process.argv[2] || `${root}dist/shots`;
await mkdir(shots, { recursive: true });
const seedDir = `${root}research/seed/docs`;
const seed = {};
for (const f of await readdir(seedDir)) {
  const [col, id] = f.replace('.json', '').split('__');
  seed[`${col}/${id}`] = JSON.parse(await readFile(`${seedDir}/${f}`, 'utf8'));
}
const pbDir = `${root}research/seed/playbooks`;
for (const f of await readdir(pbDir).catch(() => [])) {
  if (!f.startsWith('playbooks__')) continue;
  const doc = JSON.parse(await readFile(`${pbDir}/${f}`, 'utf8'));
  seed[`playbooks/${doc.candidateId}`] = doc;
}
try {
  const fees = JSON.parse(await readFile(`${root}research/live/config/fees.json`, 'utf8'));
  seed['config/fees'] = fees.data || fees;
} catch {}
// Sample worker output used to simulate a finished "Analyze a topic" job.
const workerRaw = {
  lens: 'analyze: test topic',
  kind: 'analyze',
  researchedAt: new Date().toISOString(),
  sourcesTried: [{ source: 'Web search', method: 'search', status: 'ok', note: 'test' }, { source: 'Etsy', method: 'fetch', status: 'blocked', note: 'test' }],
  candidates: [
    {
      name: 'Verification Topic',
      category: 'hobby',
      summary: 'A test candidate produced by the simulated worker.',
      trajectory: { stage: 'first_spark', text: 'Test.', evidence: ['e1'] },
      scores: { timing: { score: 2, basis: 'qualitative' }, buyerIntent: { score: null, basis: 'unknown' } },
      recommendedAction: 'watch',
      products: [],
      evidence: [{ id: 'e1', url: 'https://example.org/a', title: 'Test source', publishedAt: '2026-10-01', retrievedAt: new Date().toISOString(), accessMethod: 'web_search_result', signalType: 'press', intent: 'curiosity', claim: 'Test claim.', kind: 'observed' }],
    },
  ],
};

const init = ({ seed, scenario, workerRaw }) => {
  const KEY = 'mockdb.v1';
  let store;
  try {
    store = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {}
  if (!store) {
    store = seed;
    localStorage.setItem(KEY, JSON.stringify(store));
  }
  const versions = {};
  const listeners = new Set();
  const save = () => localStorage.setItem(KEY, JSON.stringify(store));
  const emit = () => setTimeout(() => listeners.forEach((l) => l()), 0);
  const snapDoc = (path) => ({ id: path.split('/').pop(), exists: path in store, data: () => store[path], metadata: { fromCache: false, hasPendingWrites: false } });
  const merge = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? merge(a[k], v) : v;
    return o;
  };
  window.__mock = { store, writes: [], calls: [] };
  const docRef = (path) => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapDoc(path),
    set: async (data) => {
      store[path] = JSON.parse(JSON.stringify(data));
      window.__mock.writes.push(['set', path]);
      save();
      emit();
    },
    update: async (data) => {
      if (!(path in store)) throw { code: 'invalid_argument', message: 'missing' };
      store[path] = merge(store[path], JSON.parse(JSON.stringify(data)));
      window.__mock.writes.push(['update', path]);
      save();
      emit();
    },
    delete: async () => {
      delete store[path];
      window.__mock.writes.push(['delete', path]);
      save();
      emit();
    },
    acquire: async () => ({ acquired: true, version: (versions[path] = (versions[path] || 0) + 1) }),
  });
  const colRef = (col) => {
    const q = {
      limit: () => q,
      onSnapshot: (next) => {
        const fire = () => {
          const docs = Object.keys(store)
            .filter((p) => p.split('/')[0] === col)
            .sort()
            .map(snapDoc);
          next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } });
        };
        listeners.add(fire);
        setTimeout(fire, 10);
        return () => listeners.delete(fire);
      },
      doc: (id) => docRef(`${col}/${id}`),
    };
    return q;
  };
  const db = { doc: docRef, collection: colRef };
  const user = { can: async () => scenario.canWrite !== false, id: async () => 'u_test', isOwner: async () => true, canEdit: async () => true };
  const mcp = {
    callTool: async (server, tool, input) => {
      window.__mock.calls.push([tool, input]);
      if (scenario.mcp === 'not_connected') throw { code: 'server_not_connected', message: 'no connector' };
      // The first start fails the way claude.ai does while it confirms connector access.
      if (scenario.mcp === 'upstream_once' && tool === 'fire_trigger' && !window.__mock.failedOnce) {
        window.__mock.failedOnce = true;
        throw { code: 'upstream_error', message: "connector access isn't confirmed for this artifact right now", retryable: true, retryAfterMs: 1000 };
      }
      if (tool === 'fire_trigger') {
        const jobId = String(input.text).split(': ').pop();
        // Simulated worker: claim, progress, then hand results to the inbox.
        setTimeout(async () => {
          await docRef(`jobs/${jobId}`).update({ status: 'running', steps: [{ label: 'Queued', status: 'done' }, { label: 'Searching', status: 'active' }], updatedAt: new Date().toISOString() });
        }, 400);
        setTimeout(async () => {
          const job = store[`jobs/${jobId}`];
          if (job.type === 'analyze') {
            await docRef(`inbox/${jobId}`).set({ status: 'new', jobId, runId: `run-${jobId}`, raw: workerRaw, createdAt: new Date().toISOString() });
            await docRef(`jobs/${jobId}`).update({ status: 'done', steps: [{ label: 'Queued', status: 'done' }, { label: 'Searching', status: 'done' }, { label: 'Filed', status: 'done' }], summary: 'Found 1 candidate.', updatedAt: new Date().toISOString() });
          } else {
            await docRef(`jobs/${jobId}`).update({ status: 'failed', error: 'Simulated failure: search budget exhausted.', updatedAt: new Date().toISOString() });
          }
        }, 1200);
        return { payload: { ok: true } };
      }
      if (tool === 'get_trigger') return { payload: { trigger: { id: input.trigger_id, enabled: false, cron_expression: null, last_run: null } } };
      if (tool === 'update_trigger') return { payload: { trigger: { id: input.trigger_id, ...input } } };
      throw { code: 'bad_request', message: 'unknown tool' };
    },
  };
  window.claude = { use: async (name) => (name === 'db' ? db : name === 'user' ? user : name === 'mcp' && scenario.mcp !== 'none' ? mcp : null) };
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function newPage(scenario, viewport = { width: 1440, height: 1000 }, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.addInitScript(init, { seed, scenario, workerRaw });
  await page.goto(`file://${root}dist/preview.html`);
  return { ctx, page, errors };
}

// ---- Scenario 1: connected worker, full flows ----
{
  const testPlaybook = {
    candidateId: 'american-mahjong-boom',
    products: [
      {
        index: 0,
        themeKey: seed['candidates/american-mahjong-boom'].products[0].theme.slice(0, 60),
        productName: 'Test Instructor Kit',
        superPrompt: 'You are a test super prompt. Produce the kit.',
        imagePrompts: [{ tool: 'Ideogram', purpose: 'cover', prompt: 'A test cover.' }],
        assembly: ['Open Canva', 'Export PDF'],
        listingPrompt: 'Write the listing.',
        pricing: { recommended: 19, low: 14, high: 29, currency: 'USD', rationale: 'test', basis: 'estimate' },
        costs: { provider: null, item: null, baseCost: null, shipping: null, basis: 'estimate', testBudget: 14, testBudgetNote: '' },
        platforms: [{ name: 'Etsy', role: 'primary', why: 'test' }, { name: 'Gumroad', role: 'secondary', why: 'test' }, { name: 'Pinterest', role: 'traffic', why: 'test' }],
        marketing: { positioning: 'Test positioning', launchPlan: [{ day: 'Day 0', action: 'List it' }, { day: 'Day 21', action: 'Decide' }], channels: [{ channel: 'Pinterest', tactic: 'Pins', cadence: 'daily' }], keywords: ['mahjong teacher'], hooks: ['Hook one'] },
        extensions: ['Bundle', 'Series', 'Upsell'],
        asymmetry: { downside: 'Small', upside: 'Open', badBetIf: 'Crowded' },
        risks: ['Test risk'],
        source: 'written',
      },
    ],
  };
  const withWorker = { ...seed, 'config/worker': { triggerId: 'trig_test', scheduleTriggerId: 'trig_sched' }, 'playbooks/american-mahjong-boom': testPlaybook };
  const { ctx, page, errors } = await newPage({ mcp: 'ok' });
  await page.evaluate((s) => localStorage.setItem('mockdb.v1', JSON.stringify(s)), withWorker);
  await page.reload();
  await page.waitForSelector('.row');
  const rows = await page.locator('.row').count();
  check('feed renders all researched candidates', rows === 12, `${rows} rows`);
  const strip = await page.locator('.strip .headline').innerText();
  check('decision strip answers "worth testing now"', /worth testing now/i.test(strip), strip);
  const firstAction = await page.locator('.row').first().locator('.chip').innerText();
  check('ranking puts Test now first', /Test now/.test(firstAction), firstAction);
  await page.screenshot({ path: `${shots}/feed.png`, fullPage: false });

  await page.click('.preset:has-text("Early bets")');
  const earlyRows = await page.locator('.row').count();
  const earlyCount = Number((await page.locator('.preset:has-text("Early bets") .count').innerText()).trim());
  check('Early bets preset filters to early-stage trends', earlyRows === earlyCount && earlyRows > 0 && earlyRows < 12, `${earlyRows} rows`);
  await page.click('.preset:has-text("Strongly asymmetric")');
  check('Strongly asymmetric preset works', (await page.locator('.row').count()) > 0);
  await page.click('.preset:has-text("All")');
  check('All preset restores the feed', (await page.locator('.row').count()) === 12);
  await page.selectOption('#f-action', 'prepare');
  const prepRows = await page.locator('.row').count();
  check('action filter narrows the feed', prepRows > 0 && prepRows < 12, `${prepRows} rows`);
  await page.selectOption('#f-action', '');
  await page.selectOption('#f-format', 'journal');
  const jRows = await page.locator('.row').count();
  check('format filter works', jRows > 0 && jRows < 12, `${jRows} rows`);
  await page.click('text=Clear 1 filter');
  await page.fill('#f-q', 'mahjong');
  check('search filter works', (await page.locator('.row').count()) === 1);
  await page.fill('#f-q', 'zzzz-nothing');
  check('no-results state shows', await page.locator('text=No opportunities match').isVisible());
  await page.fill('#f-q', '');

  await page.locator('.row .stretch').first().click();
  await page.waitForSelector('.dossier');
  const dossierText = await page.locator('.dossier').innerText();
  check('detail shows the five questions', ['why now?', 'what could i sell?', 'how strong is the evidence?', 'what should i do next?'].every((q) => dossierText.toLowerCase().includes(q)));
  check('detail lists sources with links', (await page.locator('.dossier .ev a.ev-title').count()) > 5);
  check('detail shows score breakdown and confidence factors', dossierText.includes('Score breakdown') && dossierText.includes('Independent sources'));
  check('history shows dated timeline (no fabricated chart)', /dated evidence timeline/i.test(dossierText) && (await page.locator('.dossier svg.chart').count()) === 0);
  await page.screenshot({ path: `${shots}/detail.png`, fullPage: false });

  // Playbook: tabs, copy, profit, asymmetry
  check('written playbook shows on the product', (await page.locator('.dossier .pb').count()) >= 1 && /Test Instructor Kit/.test(await page.locator('.dossier .pb').first().innerText()));
  await page.locator('.dossier .pb').first().locator('button:has-text("Copy")').first().click();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('super prompt copies to the clipboard', clip.includes('test super prompt'), clip.slice(0, 40));
  await page.locator('.dossier .pb').first().locator('.pb-tab:has-text("Profit")').click();
  const profit = await page.locator('.dossier .pb').first().innerText();
  check('profit tab shows per-channel net and break-even', /You keep/i.test(profit) && /Gumroad/.test(profit) && /Break-even/i.test(profit));
  const before = await page.locator('.dossier .pb').first().locator('tbody tr').first().innerText();
  await page.locator('.dossier .pb').first().locator('input[type=number]').fill('29');
  const after = await page.locator('.dossier .pb').first().locator('tbody tr').first().innerText();
  check('changing the price updates the profit table', before !== after && after.includes('$29.00'), after.replace(/\s+/g, ' '));
  await page.locator('.dossier .pb').first().locator('.pb-tab:has-text("Asymmetry")').click();
  const asymText = await page.locator('.dossier .pb').first().innerText();
  check('asymmetry tab shows rating, downside and factors', /asymmetric|Roughly even|Unfavorable/i.test(asymText) && /Risk \$/.test(asymText) && /Zero marginal cost/.test(asymText));
  check('every mahjong product shows a playbook', (await page.locator('.dossier .pb').count()) === 3);
  check('ledger rows show the best bet asymmetry', (await page.locator('.row .bet').count()) > 0);

  // Gate explanation on a downgraded candidate
  await page.click('text=Back to list');
  await page.fill('#f-q', 'Kitchen Witch');
  await page.locator('.row .stretch').first().click();
  const kw = await page.locator('.dossier').innerText();
  check('gate explains a downgraded Test now', /evidence gates cap it/i.test(kw) && /purchase intent/i.test(kw));
  check('editorial review notes are visible', /editorial review changes/i.test(kw));
  check('real written playbook loads for Kitchen Witch', /Kitchen Witch Pantry/i.test(kw) && /Written playbook/i.test(kw));
  await page.locator('.dossier .pb').first().scrollIntoViewIfNeeded();
  await page.locator('.dossier .pb').first().screenshot({ path: `${shots}/playbook-make.png` });
  await page.locator('.dossier .pb').first().locator('.pb-tab:has-text("Sell it")').click();
  await page.locator('.dossier .pb').first().screenshot({ path: `${shots}/playbook-sell.png` });
  await page.locator('.dossier .pb').first().locator('.pb-tab:has-text("Profit")').click();
  await page.locator('.dossier .pb').first().screenshot({ path: `${shots}/playbook-profit.png` });
  await page.locator('.dossier .pb').first().locator('.pb-tab:has-text("Asymmetry")').click();
  await page.locator('.dossier .pb').first().screenshot({ path: `${shots}/playbook-asym.png` });
  await page.click('text=Back to list');
  await page.fill('#f-q', '');

  // Watchlist + persistence
  await page.locator('.row').first().locator('button[aria-label^="Save"]').click();
  await page.waitForTimeout(100);
  check('watch toggle writes to the database', await page.evaluate(() => Object.keys(window.__mock.store).some((k) => k.startsWith('watchlist/'))));
  await page.reload();
  await page.waitForSelector('.row');
  await page.click('role=tab[name=/Watchlist/]');
  const wl = await page.locator('.view').innerText();
  check('watchlist persists across reload', /Only one snapshot so far/.test(wl), wl.slice(0, 80));
  await page.screenshot({ path: `${shots}/watchlist.png` });

  // Analyze a topic: cached result for a recent candidate
  await page.click('.top-actions >> text=Analyze a topic');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.fill('#analyze-input', 'mahjong');
  await page.click('text=Start research');
  const cachedNotice = await page.locator('.modal').innerText();
  check('analyze offers cached result for a recently researched topic', /researched .* hours ago/i.test(cachedNotice) || /Open cached result/.test(cachedNotice), cachedNotice.slice(0, 120));
  await page.fill('#analyze-input', '   ');
  check('submit disabled for empty input', await page.locator('button:has-text("Start research")').isDisabled());
  await page.fill('#analyze-input', 'verification topic');
  await page.click('text=Start research');
  await page.waitForSelector('.tab[aria-selected="true"]:has-text("Research")');
  await page.waitForTimeout(200);
  const jobsText = await page.locator('.view').innerText();
  check('job appears in progress after submit', /verification topic/i.test(jobsText));
  check('worker was dispatched via fire_trigger', await page.evaluate(() => window.__mock.calls.some((c) => c[0] === 'fire_trigger')));

  // Duplicate prevention while queued/running
  await page.click('.top-actions >> text=Analyze a topic');
  await page.fill('#analyze-input', 'Verification  Topic');
  await page.click('text=Start research');
  const dup = await page.locator('.modal').innerText();
  check('duplicate job is prevented', /already/i.test(dup), dup.slice(0, 100));
  await page.click('.modal >> text=Cancel');

  // Simulated worker completes, inbox is ingested
  await page.waitForTimeout(2500);
  const done = await page.locator('.view').innerText();
  check('finished research is filed from the inbox', /Verification Topic \(created\)/.test(done), done.match(/Results:.*$/m)?.[0] || '');
  await page.screenshot({ path: `${shots}/research.png`, fullPage: true });

  // Discover → simulated failure shows reason
  await page.click('.top-actions >> text=Discover trends');
  await page.waitForTimeout(2000);
  const failed = await page.locator('.view').innerText();
  check('failed job shows what went wrong', /Simulated failure/.test(failed));

  await page.click('role=tab[name=/Opportunities/]');
  check('new candidate appears in the feed', (await page.locator('.row').count()) === 13);

  // Settings: weights change ranking and persist
  await page.click('role=tab[name=/Settings/]');
  await page.fill('#pref-pod', '14');
  await page.click('text=Save preferences');
  await page.waitForTimeout(100);
  const savedPrefs = await page.evaluate(() => window.__mock.store['config/settings']?.preferences?.podDeliveryDays);
  check('preferences save to the database', savedPrefs === 14, String(savedPrefs));
  await page.locator('#w-timing').fill('0');
  await page.click('text=Save weights');
  await page.waitForTimeout(100);
  check('weights save to the database', (await page.evaluate(() => window.__mock.store['config/settings']?.weights?.timing)) === 0);
  check('selling costs panel lists fee assumptions', /Selling costs/.test(await page.locator('.view').innerText()) && (await page.locator('input[id^="fee-"]').count()) > 5);
  check('worker schedule status loads', await page.evaluate(() => window.__mock.calls.some((c) => c[0] === 'get_trigger')));
  await page.screenshot({ path: `${shots}/settings.png`, fullPage: true });

  await page.click('role=tab[name=/Opportunities/]');
  await page.selectOption('#f-sort', 'asymmetry');
  check('sorting by most asymmetric bet works', (await page.locator('.row').count()) === 13);
  await page.selectOption('#f-sort', 'rank');
  await page.click('role=tab[name=/Settings/]');

  // Demo mode is labeled and separate
  await page.check('#demo-toggle');
  await page.click('role=tab[name=/Opportunities/]');
  const demoBanner = await page.locator('.banner.demo').isVisible();
  const demoRows = await page.locator('.row').count();
  check('demo data is labeled and replaces (not mixes with) research', demoBanner && demoRows === 2, `${demoRows} rows`);
  check('no runtime errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Scenario 2: no worker connector; queued job explains itself ----
{
  const { ctx, page, errors } = await newPage({ mcp: 'not_connected' });
  await page.evaluate((s) => localStorage.setItem('mockdb.v1', JSON.stringify({ ...s, 'config/worker': { triggerId: 'trig_test' } })), seed);
  await page.reload();
  await page.waitForSelector('.row');
  await page.click('.top-actions >> text=Discover trends');
  await page.waitForTimeout(300);
  const txt = await page.locator('.view').innerText();
  check('dispatch failure is explained on the job', /Claude Code Remote connector/.test(txt), txt.match(/Add the.*$/m)?.[0] || '');
  check('no runtime errors (no connector)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Scenario 2b: a temporary connector error is retried once automatically ----
{
  const { ctx, page, errors } = await newPage({ mcp: 'upstream_once' });
  await page.evaluate((s) => localStorage.setItem('mockdb.v1', JSON.stringify({ ...s, 'config/worker': { triggerId: 'trig_test' } })), seed);
  await page.reload();
  await page.waitForSelector('.row');
  await page.click('.top-actions >> text=Discover trends');
  await page.waitForFunction(() => window.__mock.calls.filter(([t]) => t === 'fire_trigger').length >= 2, null, { timeout: 8000 }).catch(() => {});
  const fires = await page.evaluate(() => window.__mock.calls.filter(([t]) => t === 'fire_trigger').length);
  await page.waitForTimeout(300);
  const toastTxt = await page.locator('body').innerText();
  check('temporary connector error is retried once and the worker starts', fires === 2 && /Discovery started/.test(toastTxt), `${fires} start attempts`);
  check('no runtime errors (connector retry)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Scenario 2c: a duplicate marked by an editor folds into its survivor ----
{
  const dupe = { ...seed['candidates/american-mahjong-boom'], id: 'mahjong-night-dupe', name: 'Mahjong night craze', topicKeys: ['phrase:mahjong night craze'], duplicateOf: 'american-mahjong-boom' };
  const withDupe = { ...seed, 'candidates/mahjong-night-dupe': dupe };
  const { ctx, page, errors } = await newPage({ mcp: 'ok' });
  await page.evaluate((s) => localStorage.setItem('mockdb.v1', JSON.stringify(s)), withDupe);
  await page.reload();
  await page.waitForSelector('.row');
  check('merged duplicate stays out of the feed', (await page.locator('.row').count()) === 12, `${await page.locator('.row').count()} rows`);
  await page.locator('.row:has-text("American mahjong boom") .stretch').first().click();
  await page.waitForSelector('.dossier');
  check('survivor names the merged duplicate', /Merged duplicate research: Mahjong night craze/.test(await page.locator('.dossier').innerText()));
  check('no runtime errors (duplicates)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Scenario 3: outside claude.ai (no runtime), phone width, dark ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`file://${root}dist/preview.html`);
  await page.waitForSelector('.banner.warn');
  check('standalone copy explains it is not connected', /Not connected to the Trendjack database/.test(await page.locator('.banner.warn').innerText()));
  await page.click('.banner.warn >> text=Explore with demo data');
  await page.waitForSelector('.row');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal scroll at phone width', overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: `${shots}/phone-dark.png`, fullPage: false });
  await page.locator('.row .stretch').first().click();
  await page.waitForSelector('.dossier');
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('detail fits phone width', overflow2 <= 0, `${overflow2}px`);
  await page.screenshot({ path: `${shots}/phone-detail.png`, fullPage: false });
  check('no runtime errors (standalone)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Scenario 4: view-only viewer ----
{
  const { ctx, page, errors } = await newPage({ mcp: 'none', canWrite: false });
  await page.waitForSelector('.row');
  check('view-only hides research controls', (await page.locator('.top-actions').count()) === 0 && (await page.locator('button[aria-label^="Save"]').count()) === 0);
  check('no runtime errors (view-only)', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
