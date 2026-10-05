# Trendjack first-spark hunt (for research sessions)

You are one of several parallel research sessions hunting **early** trends for Trendjack: things
that started or broke out in roughly the last 3–6 weeks (since about late August 2026), before the
market fills up. Today is early October 2026; get the exact time with `date -u +%FT%TZ`.

Read these files in this repository first and follow them, except where this file overrides:
- `research/WORKER_PROMPT.md`: database access, job handling, evidence rules, candidate schema,
  playbook schema (section 5b). Follow its evidence rules exactly.
- `research/PLAYBOOK_BRIEF.md`: how to write a great super prompt and marketing plan.

Do not modify, commit or push anything in this repository. Your output goes to the database only.

## Your assignment
Your task message gives you a **job id** and a **lens**. Claim the job (`jobs/<id>`, pinned
update to status "running") and keep its `steps`, `progress` and `updatedAt` current as you go.

## What to find
- Screen at least 15 specific candidates inside your lens and record every one in `discovered`
  with why it was kept or rejected. Read the existing candidates first (ArtifactData list
  collection "candidates") and skip anything already covered.
- Deep-dive the best **4**. At least 2 should be `first_spark` (new, spreading in a few independent
  places, little or no product supply yet) and the rest `early_growth`. Prefer candidates that are
  product-friendly (a clear buyer and a digital or POD format), rights-clean (no celebrity, brand,
  film, song or character IP needed), and can be built in a few days.
- Early-signal tactics that work through web search: "new TikTok trend this week", Know Your Meme
  new entries and weekly roundups, r/OutOfTheLoop and "what is the X trend" explainers, trend
  newsletters and creator-economy roundups dated in the last 3 weeks, Pinterest/TikTok trend
  reports, "Google Trends breakout" mentions in reporting, niche community growth stories, and
  early Etsy/marketplace reporting. Many sites are blocked for direct fetching; record what you tried.

## Honesty for early trends
- First spark means thin evidence by definition. Do not inflate it: 2–4 independent sources is
  normal, purchase intent may be absent (then say so; buyerIntent gets a low score or null).
- Never invent numbers, dates, URLs or reach. If something has one viral post and nothing else,
  reject it in `discovered` ("single post, no independent spread").
- Recommended action for first-spark items is usually "prepare" (build cheap assets now, do not
  spend on ads until it spreads) or "watch". "test_now" still needs real demand evidence.
- In each first-spark candidate's `unresolved`, list the 1–3 signals that would confirm it is
  spreading, so the creator knows what to watch for.
- Label the stage from your own dates: `first_spark` only when the earliest dated evidence you
  found is within about 6 weeks. If your research shows the scene or term is older (a club scene
  since 2023, a format that peaked last January), it is `early_growth` or later even if products
  are still scarce. An editor will relabel inflated stages, so do not stretch.
- Skip anything built on a private person (a bystander, student or employee in a news clip or
  viral video), especially one tied to a crime, accident or tragedy. Reject it in `discovered`.
- Check for near-duplicates, not just exact names: if an existing candidate covers the same
  behavior under another name (for example "phone-free nights" vs "offline club"), skip it or
  file it only if it is clearly a different buyer and product.

## Lenses already covered (wave 1, 2026-10-04)
aesthetics, communities, food and home, hobbies, memes, seasonal moments, New Year planning,
consumer tech habits. Their 30+ candidates are in the database; do not re-file them.

## Output (overrides section 5 of WORKER_PROMPT.md)
Write **one inbox document per candidate** so no document gets too large:
action "set", collection "inbox", doc_id "<job id>-<n>" (n = 1..4), data:
`{"status":"new","jobId":"<job id>","runId":"run-<job id>-<n>","createdAt":"<now>","raw": RESULT}`
where RESULT has exactly one candidate in `candidates` (with a full playbook inside every product),
the same `sourcesTried`, and `discovered` included only in document 1. Keep each document under
200 KB (at most 20 evidence items, excerpts under 250 characters).

Then finish the job as section 6 of WORKER_PROMPT.md says, with a summary such as
"Screened 17 in <lens>; filed 4 (2 first spark, 2 early growth)."
