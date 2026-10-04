// Shared vocabulary for research, analysis and presentation.
// Everything here is plain data so the scoring core can run in Node and the browser.

export const CRITERIA = [
  {
    key: 'timing',
    label: 'Entry timing',
    weight: 25,
    help: 'Is there enough time left to make, list, get discovered and deliver this product while interest lasts?',
  },
  {
    key: 'buyerIntent',
    label: 'Buyer intent',
    weight: 20,
    help: 'Evidence that people want to buy related products, not just watch or argue about the topic.',
  },
  {
    key: 'supplyGap',
    label: 'Competition & supply gap',
    weight: 15,
    help: 'How crowded existing supply is, and whether a useful or appealing product is missing.',
  },
  {
    key: 'productFit',
    label: 'Product fit & ease',
    weight: 15,
    help: 'How naturally the trend maps to a format a solo, AI-assisted creator can make in days.',
  },
  {
    key: 'durability',
    label: 'Expected durability',
    weight: 15,
    help: 'How likely interest is to persist long enough to recover the effort.',
  },
  {
    key: 'economics',
    label: 'Plausible economics',
    weight: 10,
    help: 'Whether typical price points leave a margin after POD or platform costs. Not a revenue forecast.',
  },
];

export const DEFAULT_WEIGHTS = Object.fromEntries(CRITERIA.map((c) => [c.key, c.weight]));

export const BASIS = {
  measured: { label: 'Measured', weight: 1, help: 'A direct numeric measurement retrieved from a source.' },
  reported: { label: 'Reported', weight: 0.8, help: 'A figure or fact stated by a cited source, not independently measured.' },
  qualitative: { label: 'Judgment', weight: 0.5, help: 'An analyst judgment based on cited evidence.' },
  unknown: { label: 'Not assessed', weight: 0, help: 'No usable evidence. Counts as zero in the score.' },
};

export const STAGES = {
  first_spark: { label: 'First spark', order: 0, help: 'Interesting, but not enough validation yet.' },
  early_growth: { label: 'Early growth', order: 1, help: 'Spreading interest with emerging product demand.' },
  mainstream_surge: { label: 'Mainstream surge', order: 2, help: 'Strong attention, usually more competition.' },
  established_niche: { label: 'Established niche', order: 3, help: 'Persistent demand that may support a differentiated offer.' },
  declining: { label: 'Declining', order: 4, help: 'Weakening interest or a shrinking practical window.' },
  insufficient_evidence: { label: 'Insufficient evidence', order: 5, help: 'Timing cannot be responsibly assessed.' },
};

export const ACTIONS = {
  test_now: { label: 'Test now', rank: 3, help: 'Demand evidence, a credible product angle, and enough time left to reach buyers.' },
  prepare: { label: 'Prepare', rank: 2, help: 'Promising. Build assets or close an evidence gap before launching.' },
  watch: { label: 'Watch', rank: 1, help: 'Not enough evidence or timing yet. Re-check later.' },
  pass: { label: 'Pass', rank: 0, help: 'Weak, fading, crowded or blocked by rights. Skip it.' },
};

export const ACTION_BY_RANK = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [v.rank, k]));

export const CATEGORIES = {
  meme: 'Meme / phrase',
  aesthetic: 'Aesthetic',
  hobby: 'Hobby / practice',
  belief: 'Belief / spiritual',
  character: 'Character / fandom',
  movement: 'Movement',
  subculture: 'Subculture',
  seasonal: 'Seasonal twist',
  other: 'Other',
};

export const FORMATS = {
  tshirt: 'T-shirt',
  sticker: 'Sticker',
  poster: 'Poster / wall art',
  printable: 'Printable',
  journal: 'Journal',
  planner: 'Planner',
  ebook: 'Ebook / guide',
  template: 'Template',
  bundle: 'Content bundle',
  mug: 'Mug',
  tote: 'Tote',
  other: 'Other',
};

export const COMPETITION = {
  none_found: { label: 'None found', gap: 'open' },
  low: { label: 'Low', gap: 'open' },
  moderate: { label: 'Moderate', gap: 'some' },
  high: { label: 'High', gap: 'crowded' },
  saturated: { label: 'Saturated', gap: 'crowded' },
  unknown: { label: 'Unknown', gap: 'unknown' },
};

export const COMPETITION_ORDER = ['none_found', 'low', 'moderate', 'high', 'saturated'];

export const SIGNAL_TYPES = {
  social: 'Social posts',
  search: 'Search behavior',
  creator: 'Creator content',
  marketplace: 'Marketplace',
  press: 'Reporting',
  community: 'Community',
};

export const INTENTS = {
  purchase: 'Purchase intent',
  utility: 'Seeking help / how-to',
  curiosity: 'Curiosity',
  criticism: 'Criticism / outrage',
  none: 'Context only',
};

export const ACCESS_METHODS = {
  web_search_result: { label: 'Search result', help: 'Seen through a web search result (title, URL and summary). The page itself was not fetched.' },
  fetched_page: { label: 'Fetched page', help: 'The page was retrieved and read directly.' },
  api: { label: 'API', help: 'Retrieved from a structured API response.' },
};

export const EFFORT = {
  low: 'Low (under a day)',
  medium: 'Medium (1–3 days)',
  high: 'High (4+ days)',
};

export const DEFAULT_PREFERENCES = {
  region: 'US',
  language: 'English',
  creator: 'Solo creator using AI and common design tools',
  budget: 'low',
  inventory: 'none',
  fulfillment: ['digital', 'pod'],
  maxBuildDays: 4,
  audience: 'none',
  podDeliveryDays: 10,
  discoveryDays: { none: 21, small: 10, large: 3 },
  cacheHours: 24,
  maxActiveJobs: 3,
};

export const AUDIENCE = {
  none: 'No existing audience',
  small: 'Small audience (under 5k)',
  large: 'Established audience',
};
