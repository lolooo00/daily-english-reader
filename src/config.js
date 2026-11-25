import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
export const DIST_DIR = process.env.DIST_DIR || join(ROOT, "dist");
export const FEEDS_PATH = join(ROOT, "config", "feeds.json");
export const SITE_DIR = join(ROOT, "site");
export const TEMPLATES_DIR = join(ROOT, "templates");

export const SITE_TITLE = "Daily Reader";
/** Issue dates follow this zone, so the 04:00 run is labelled with the day you read it. */
export const TIME_ZONE = "Asia/Shanghai";

export const CATEGORIES = [
  { id: "tech", label: "Technology", short: "Tech" },
  { id: "law", label: "Law", short: "Law" },
  { id: "gaming", label: "Gaming", short: "Gaming" },
  { id: "fun", label: "Interesting Reads", short: "Reads" },
];

export const WORDS = { min: 500, max: 1500 };
/** Used only when a category has nothing in the normal range: the closest fit wins. */
export const WORDS_RELAXED = { min: 400, max: 2000 };
export const WORDS_PER_MINUTE = 200;

export const LIMITS = {
  /** Whole fetch phase. The workflow step is killed at 8 minutes, so keep a wide margin. */
  runBudgetMs: 4 * 60_000,
  feedTimeoutMs: 15_000,
  articleTimeoutMs: 20_000,
  /** Parallel article downloads per category (4 categories run side by side). */
  extractConcurrency: 2,
  maxAttemptsPerCategory: 24,
  maxItemAgeDays: 21,
  seenKeep: 6000,
  bufferKeep: 24,
  bufferMaxAgeDays: 14,
  /** Show a "needs attention" notice once a feed fails this many runs in a row. */
  feedFailureWarnAfter: 3,
};

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Titles that are never worth a daily read, whatever the source. */
export const TITLE_BLOCKLIST = [
  /\bpromo codes?\b/i,
  /\bcoupons?\b/i,
  /\bdiscount codes?\b/i,
  /\b\d+\s?% off\b/i,
  /\bgift guide\b/i,
  /\bblack friday\b/i,
  /\bcyber monday\b/i,
  /\bprime day\b/i,
  /\bbest\b.*\bdeals?\b/i,
  /\bdeals? (on|for|we|i['’]d)\b/i,
  /\bwhere to (buy|watch|stream)\b/i,
  /\bpre-?order\b.*\bwhere\b/i,
  /\b(live ?blog|liveblog|live updates)\b/i,
  /\b(weekly|daily) (roundup|digest|briefing)\b/i,
  /\bpodcast\b/i,
  /^(watch|listen):/i,
];

/** Extra title filters for one category (on top of TITLE_BLOCKLIST and per-feed "exclude"). */
export const CATEGORY_EXCLUDES = {
  gaming: [
    /^(how to|best way to|where to)\b/i,
    /\b(walkthrough|tier list|all [\w\s-]+ locations|patch notes)\b/i,
    /\b(guide|explained|answers?|hints?)\s*[:(]/i,
    /\b(today['’]s )?(wordle|connections|quordle|strands)\b/i,
  ],
};

/** Paragraphs dropped from article bodies (newsletter plugs, affiliate notes, …). */
export const PARAGRAPH_BLOCKLIST = [
  /^(read more|related|see also|more from|recommended|further reading)\b/i,
  /^(sign up|subscribe|get the newsletter|join our newsletter)\b/i,
  /^advertisement$/i,
  /^this (article|story|piece) (was|is) (originally|first) (published|appeared)\b/i,
  /^(if you buy something|we may earn|when you buy through)\b/i,
  /^(follow|support) (us|our)\b/i,
  /^(image|photo|illustration|credit|photograph)( credit)?:/i,
];
