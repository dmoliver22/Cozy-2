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
