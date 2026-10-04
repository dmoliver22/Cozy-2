# Trendjack

Trendjack finds emerging internet trends that a solo creator can monetize by adapting an
existing, easy-to-produce product (sticker, poster, printable, journal, template, ebook,
bundle, POD apparel) to a trending theme. It answers one question: **what should I launch
now, for whom, in what format, and what evidence supports doing it now?**

It runs as a claude.ai artifact (a single HTML page) backed by the artifact's shared
database, with research done by a Claude Code Routine that has web search.

## Architecture

```
research/            collection: brief, raw research results, editorial review, seed
  AGENT_BRIEF.md     research protocol and output schema (also used by the worker)
  WORKER_PROMPT.md   the research worker routine's standing instructions
  raw/*.json         research results exactly as researched
  curation.json      editorial review applied on top (every change is shown in the app)
src/core/            analysis: pure functions, run in Node and the browser
  constants.js       criteria, weights, stages, actions, vocabularies
  evidence.js        canonical URLs, syndication clustering, independence, chartable series
  scoring.js         opportunity score, evidence confidence, action gates, product timing
  changes.js         research snapshots and watchlist change detection
  ingest.js          validation and normalization of research results into documents
  normalize.js       topic keys for duplicate-job detection
src/data/            storage and jobs
  store.js           artifact-db backend + browser-only fallback behind one interface
  jobs.js            job planning (dedupe, cache, limits), stall detection, inbox ingestion
  worker.js          starts the research routine via the Claude Code Remote connector
  demo.js            fictional demo examples (never stored, always labeled)
src/ui/              presentation (Preact, bundled into one HTML file)
scripts/
  build.mjs          bundle → dist/trendjack.html (artifact) and dist/preview.html
  validate-research.mjs  check research files against the evidence rules
  seed.mjs           apply editorial review + ingest → research/seed/ (database writes)
  verify-ui.mjs      end-to-end browser checks with a mocked claude.ai runtime
tests/               unit tests for the analysis core and job planning
```

### Database layout (artifact db)

| Collection | Contents |
|---|---|
| `candidates/{slug}` | One analyzed trend: explanation, timing, demand, competition, window, rights, 0–5 criterion scores with basis, up to three products, open questions |
| `evidence/{candidate~hash}` | One source: URL, publisher, publication date, retrieval time, access method, signal type, intent, claim, observed/inference, syndication link, first/last run seen |
| `observations/{id}` | Numeric figures as reported by a source (charted only when 3+ comparable absolute points exist) |
| `snapshots/{candidate~run}` | The assessment at each research run; the watchlist compares the last two |
| `jobs/{id}` | Research requests and their progress, sources tried, errors |
| `inbox/{jobId}` | Raw research results from the worker, filed by the dashboard through `ingest.js` |
| `runs/{id}` | What each run screened, rejected and could reach |
| `watchlist/{candidate}` | Saved candidates and the snapshot they were saved at |
| `config/settings`, `config/worker`, `config/sources` | Preferences and weights, routine IDs, source availability |

## Scoring

Opportunity score (0–100) = weighted criteria, default weights: entry timing 25, buyer intent 20,
competition & supply gap 15, product fit 15, durability 15, economics 10. Criteria without
evidence count as zero, so missing evidence never raises a score. Evidence confidence is
computed separately from independent sources, signal diversity, recency, purchase-intent
evidence and how criteria were assessed. "Test now" is gated: it needs buyer intent ≥3 with at
least one independent purchase-intent source, a credible product, a launch stage, three or more
independent sources, medium confidence, and a product that can reach buyers inside any dated window.
These are decision heuristics, not a validated predictor of profit.

## Develop

```
npm install
npm test                       # analysis unit tests
npm run validate               # check research/raw against the evidence rules
npm run seed                   # rebuild research/seed from raw + curation
npm run build                  # dist/trendjack.html
node scripts/verify-ui.mjs     # browser checks (needs Chromium)
```

## Research worker

Research runs in Claude Code Routines with web search, not in the page:

| Routine | Trigger | Purpose |
|---|---|---|
| Trendjack research worker | `trig_01EGjcmjSKMe1QUixGLXKdyv` | Fired by the dashboard ("Discover trends", "Analyze a topic", "Refresh") with the job id |
| Trendjack scheduled discovery | `trig_01GSzZJ4dR52xSx7YUT5Jsaz` | Optional timetable (off by default); turn on or change it in Settings → Research worker |

Flow: the dashboard writes `jobs/{id}` (after duplicate, cache and limit checks) and calls `fire_trigger`
through the viewer's Claude Code Remote connector. The worker claims the job with a version-pinned
write, records progress, writes its raw result to `inbox/{id}`, and marks the job done, partial or
failed with the sources it tried. Any open dashboard validates the inbox result with `ingest.js` and
files it. If the connector is unavailable, jobs stay queued and say why; a scheduled run picks up
queued jobs.

Verified on 2026-10-04: an "Analyze a topic" job ("6-7 meme") was claimed, researched, filed and
shown in the dashboard within about two minutes.

## Known limits

- This environment's network policy blocks direct access to Google Trends, Reddit, Etsy, Pinterest,
  TikTok, YouTube, Wikipedia/Wikimedia and most publishers, so evidence comes from web-search results
  and confidence is discounted for it. Allowing those hosts (environment settings → Network access)
  and adding API credentials would let the worker fetch pages and real time series.
- No charts appear until three or more comparable absolute measurements are stored for a trend.
- Each Claude Code session has a web-search budget (200 by default); the initial research used it.
