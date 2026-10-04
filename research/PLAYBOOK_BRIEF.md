# Trendjack playbook brief (for playbook writers)

You write the **make-and-sell playbook** for product ideas already researched by Trendjack.
Input: `research/playbooks/input.json` (each trend with its researched products, buyer, rights
notes, competition and window). Write only for the candidate IDs you are assigned.

The reader is a solo US creator with no audience, using AI tools (Claude or ChatGPT for text, an
image model such as Ideogram, Midjourney or ChatGPT images for art) plus Canva or Google Sheets.
They want to copy a prompt, get the finished product, list it, and market it this week.

## Hard rules
- Do not invent facts, statistics, sales figures, search volumes or reviews. Keywords are
  suggestions to test, not measured volumes. Prices and POD costs are estimates: say so in "basis".
- Respect every rights note in the input: no trademarks, brand names, film/IP references,
  celebrity names or likenesses, song lyrics, copied artwork, or copyrighted Bible translations
  (KJV or World English Bible text only, otherwise references only). Prompts must instruct the
  AI to keep everything original.
- No health, spiritual, financial or outcome promises in product or marketing copy.
- Stay in your lane: do not edit any other file.

## What a great super prompt looks like
A single block the creator pastes into Claude or ChatGPT that produces the complete sellable
content in one go. It must include:
1. Role and goal (one or two lines).
2. Buyer and the job the product does for them (use the researched buyer and whyBuy).
3. Exact deliverable spec: every page/section/tab/design with its contents, counts, page size
   (US Letter 8.5x11 in and A4 versions for printables; 6x9 in for KDP interiors; pixel sizes for
   POD art), layout notes, fonts and a named color palette with hex codes that fit the aesthetic.
4. Content requirements: original wording, accuracy checks the AI must apply, tone, reading level.
5. Differentiation: what makes this better than what already exists (use the input's gap and
   differentiation).
6. Constraints: rights limits, no IP, no claims.
7. Output format: a structured, page-by-page (or tab-by-tab) result ready to drop into Canva or
   Sheets, ending with a short self-check list the AI runs before answering.
Write it in second person to the AI ("You are…", "Produce…"). Typical length 350–700 words.
Use placeholders like [YOUR SHOP NAME] only where the creator must choose.

Image prompts: one per visual asset (cover, sticker art, poster art, mockup). Name the tool
family, give subject, style, composition, colors (hex), exact text to render (if any), aspect
ratio, background (transparent or solid), and negatives ("no logos, no real people, no
trademarked characters, no watermarks").

Assembly: the concrete build steps after the AI output (Canva template choice, page setup,
export settings: PDF Print at 300 DPI, PNG transparent 300 DPI, Google Sheets sharing as
"make a copy" link, Printify/Printful template sizes). Keep to 5–9 steps.

Listing prompt: a prompt that writes the listing for the primary platform: title under
140 characters front-loading the buyer's search phrase, 13 Etsy tags of 20 characters or fewer
(if Etsy), a description with what's included, file formats and sizes, how delivery works,
and a short FAQ. It must forbid trademarked terms.

## Marketing and platforms
Choose platforms that fit the format and the buyer (digital: Etsy primary, Gumroad or Payhip
secondary for direct links; KDP for low-content paperbacks; Printify or Printful connected to
Etsy for POD; Redbubble or TeePublic only as secondary for stickers or apparel). Pinterest is
usually the strongest free traffic source for printables with no audience; TikTok and Instagram
Reels for process or "what's inside" videos; niche communities (subreddits, Facebook groups,
Discords) only where self-promotion is allowed, and say "check the community rules".
Launch plan: 7–10 dated steps from Day 0 to about Day 21, ending in the go/pivot/stop check
from the input. Give a cadence for each channel.

## Pricing and costs (estimates)
Recommend a price and a low/high range with a one-line rationale (positioning vs the
competition described in the input). For POD give an estimated base cost and US shipping
for the named provider and item, marked as an estimate to verify in the provider catalog. Give a
small paid-test budget if useful (e.g. Etsy ads $1/day for 14 days), or 0.

## Asymmetry
Be blunt and specific: what the creator risks (cash, hours), how fast the test gives an
answer, what keeps the upside open (zero marginal cost, sells on several platforms, evergreen,
bundles or series, an email list), and what would make it a bad bet. If an idea is not
asymmetric (thin margins, hard deadline, crowded), say so plainly.

## Output
Write ONE JSON file at the path in your task (validate with `python3 -m json.tool`):

```json
{
  "writtenAt": "<ISO from date -u +%FT%TZ>",
  "playbooks": [
    {
      "candidateId": "",
      "products": [
        {
          "index": 0,
          "themeKey": "<first 60 characters of the input product's theme, copied exactly>",
          "productName": "short sellable product name",
          "superPrompt": "…",
          "imagePrompts": [{"tool": "", "purpose": "", "prompt": ""}],
          "assembly": ["…"],
          "listingPrompt": "…",
          "pricing": {"recommended": 0, "low": 0, "high": 0, "currency": "USD", "rationale": "", "basis": "estimate"},
          "costs": {"provider": null, "item": null, "baseCost": null, "shipping": null, "basis": "estimate: verify in the provider catalog", "testBudget": 0, "testBudgetNote": ""},
          "platforms": [{"name": "Etsy", "role": "primary|secondary|traffic", "why": ""}],
          "marketing": {
            "positioning": "",
            "launchPlan": [{"day": "Day 0", "action": ""}],
            "channels": [{"channel": "", "tactic": "", "cadence": ""}],
            "keywords": [""],
            "hooks": [""]
          },
          "extensions": [""],
          "asymmetry": {"downside": "", "upside": "", "badBetIf": ""},
          "risks": [""]
        }
      ]
    }
  ]
}
```

Cover every product of every assigned candidate, in input order. Your final message back is
SHORT (under 120 words): the file path and the product names. The JSON is the deliverable.
