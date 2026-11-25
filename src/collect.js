import { CATEGORIES, CATEGORY_EXCLUDES, LIMITS, WORDS, WORDS_PER_MINUTE, WORDS_RELAXED } from "./config.js";
import {
  buildSeenIndex,
  compileExcludes,
  filterCandidates,
  inWordRange,
  interleaveBySource,
  isSeen,
} from "./select.js";
import { ageInDays, articleId, errorMessage, normalizeTitle, normalizeUrl, shuffle } from "./util.js";

export function toIssueArticle(candidate, extracted, category) {
  return {
    id: articleId(candidate.link),
    url: candidate.link,
    title: extracted.title || candidate.title,
    source: candidate.source,
    author: extracted.author || null,
    category,
    wordCount: extracted.wordCount,
    minutes: Math.max(1, Math.round(extracted.wordCount / WORDS_PER_MINUTE)),
    published: candidate.published || extracted.published || null,
    content: extracted.content,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Builds one issue: one article per category, topped up from the buffer or
 * from other categories when a category comes back empty.
 *
 * Network access is injected (`fetchFeed`, `extractArticle`) so the whole
 * selection logic can be tested offline. Mutates `state` (feed health,
 * buffer, seen list, category misses).
 */
export async function collectIssue({
  date,
  feedsConfig,
  state,
  fetchFeed,
  extractArticle,
  perCategory = 1,
  budgetMs = LIMITS.runBudgetMs,
  rand = Math.random,
  log = console.log,
}) {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const timeLeft = () => deadline - Date.now();

  // 1. All feeds in parallel.
  const feedEntries = CATEGORIES.flatMap(({ id }) =>
    (feedsConfig[id] || []).map((feed) => ({ category: id, feed })),
  );
  const feedReport = await Promise.all(
    feedEntries.map(async ({ category, feed }) => {
      try {
        const items = await fetchFeed(feed);
        return { category, feed, items, ok: true };
      } catch (err) {
        return { category, feed, items: [], ok: false, error: errorMessage(err) };
      }
    }),
  );
  updateFeedHealth(state, feedReport, date);
  for (const r of feedReport) {
    log(`feed ${r.ok ? "ok  " : "FAIL"} ${r.feed.name}: ${r.ok ? `${r.items.length} items` : r.error}`);
  }

  // 2. Candidates per category.
  // Buffered articles are not downloaded again; they are used directly as fallbacks.
  const seenIndex = buildSeenIndex(state.seen);
  const candidateIndex = buildSeenIndex(state.seen, state.buffer.map((a) => a.url));
  const workers = new Map();
  for (const { id } of CATEGORIES) {
    const pool = [];
    for (const r of feedReport.filter((x) => x.category === id)) {
      const { kept } = filterCandidates(r.items, {
        seenIndex: candidateIndex,
        excludes: [...compileExcludes(r.feed), ...(CATEGORY_EXCLUDES[id] || [])],
        maxAgeDays: LIMITS.maxItemAgeDays,
      });
      pool.push(...kept);
    }
    workers.set(id, makeWorker(id, interleaveBySource(pool, rand), { extractArticle, timeLeft, log }));
  }

  // 3. One article per category, categories side by side.
  const newlyBuffered = [];
  const picked = new Map();
  await Promise.all(
    CATEGORIES.map(async ({ id }) => {
      const { articles, extras } = await workers.get(id).take(perCategory);
      picked.set(id, articles);
      newlyBuffered.push(...extras);
    }),
  );

  // 4. Empty category → buffered article of the same category.
  const pickedIds = () => new Set([...picked.values()].flat().map((a) => a.id));
  const freshBuffer = () =>
    [...state.buffer, ...newlyBuffered].filter(
      (a) =>
        !pickedIds().has(a.id) &&
        !isSeen(seenIndex, { link: a.url, title: a.title }) &&
        (ageInDays(a.fetchedAt) ?? 0) <= LIMITS.bufferMaxAgeDays,
    );
  const missed = [];
  for (const { id } of CATEGORIES) {
    if (picked.get(id).length > 0) continue;
    const fallback = freshBuffer().find((a) => a.category === id);
    if (fallback) {
      log(`category ${id}: using buffered "${fallback.title}"`);
      picked.set(id, [fallback]);
    } else {
      missed.push(id);
    }
  }

  // 5. Still short → top up from other categories (buffer first, then more downloads).
  const target = CATEGORIES.length * perCategory;
  const total = () => [...picked.values()].flat().length;
  for (const id of missed) {
    if (total() >= target) break;
    const fromBuffer = freshBuffer()[0];
    if (fromBuffer) {
      log(`category ${id} empty: filling with buffered ${fromBuffer.category} article`);
      picked.get(fromBuffer.category).push(fromBuffer);
      continue;
    }
    for (const other of shuffle(CATEGORIES.map((c) => c.id).filter((c) => !missed.includes(c)), rand)) {
      const { articles, extras } = await workers.get(other).take(1);
      newlyBuffered.push(...extras);
      if (articles.length) {
        log(`category ${id} empty: filling with extra ${other} article`);
        picked.get(other).push(...articles);
        break;
      }
    }
  }

  const articles = CATEGORIES.flatMap(({ id }) => picked.get(id));

  // 6. Bookkeeping.
  for (const { id } of CATEGORIES) {
    state.categoryMisses[id] = missed.includes(id) ? (state.categoryMisses[id] || 0) + 1 : 0;
  }
  if (articles.length > 0) markSeen(state, articles, date);
  state.buffer = nextBuffer([...state.buffer, ...newlyBuffered], articles, state);

  const notices = buildNotices(state, missed);
  const report = {
    date,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    articles: articles.map((a) => ({ category: a.category, source: a.source, words: a.wordCount, title: a.title })),
    missedCategories: missed,
    attempts: Object.fromEntries([...workers].map(([id, w]) => [id, w.stats()])),
    feeds: feedReport.map((r) => ({ name: r.feed.name, ok: r.ok, items: r.items.length, error: r.error || null })),
    buffer: state.buffer.length,
  };
  return { articles, notices, report };
}

function makeWorker(category, candidates, { extractArticle, timeLeft, log }) {
  let pos = 0;
  let attempts = 0;
  let failures = 0;
  let outOfRange = 0;
  const nearMisses = [];
  const distance = (a) => (a.wordCount < WORDS.min ? WORDS.min - a.wordCount : a.wordCount - WORDS.max);
  const concurrency = LIMITS.extractConcurrency;
  return {
    stats: () => ({ candidates: candidates.length, attempts, failures, outOfRange }),
    async take(needed) {
      const articles = [];
      const extras = [];
      while (
        articles.length < needed &&
        pos < candidates.length &&
        attempts < LIMITS.maxAttemptsPerCategory &&
        timeLeft() > LIMITS.articleTimeoutMs + 5_000
      ) {
        const batch = candidates.slice(pos, pos + concurrency);
        pos += batch.length;
        attempts += batch.length;
        const results = await Promise.all(
          batch.map((c) =>
            extractArticle(c.link).then(
              (extracted) => ({ c, extracted }),
              (err) => ({ c, error: errorMessage(err) }),
            ),
          ),
        );
        for (const { c, extracted, error } of results) {
          if (!extracted) {
            failures++;
            log(`  ${category} ✗ ${c.source}: ${c.title} — ${error || "no content"}`);
            continue;
          }
          const article = toIssueArticle(c, extracted, category);
          if (!inWordRange(article.wordCount, WORDS)) {
            outOfRange++;
            if (inWordRange(article.wordCount, WORDS_RELAXED)) nearMisses.push(article);
            log(`  ${category} · ${c.source}: ${c.title} — ${article.wordCount} words, out of range`);
            continue;
          }
          if (articles.length < needed) {
            log(`  ${category} ✓ ${c.source}: ${article.title} (${article.wordCount} words)`);
            articles.push(article);
          } else {
            extras.push(article);
          }
        }
      }
      // Nothing in range: take the closest near miss rather than leave the category empty.
      nearMisses.sort((a, b) => distance(a) - distance(b));
      while (articles.length < needed && nearMisses.length) {
        const article = nearMisses.shift();
        log(`  ${category} ≈ ${article.source}: ${article.title} (${article.wordCount} words, relaxed range)`);
        articles.push(article);
      }
      return { articles, extras };
    },
  };
}

function updateFeedHealth(state, feedReport, date) {
  // Feeds removed from feeds.json stop being tracked.
  const current = new Set(feedReport.map((r) => r.feed.name));
  for (const name of Object.keys(state.feedHealth)) if (!current.has(name)) delete state.feedHealth[name];
  for (const r of feedReport) {
    const prev = state.feedHealth[r.feed.name] || { consecutiveFailures: 0 };
    state.feedHealth[r.feed.name] = r.ok
      ? { consecutiveFailures: 0, lastOk: date, lastItems: r.items.length }
      : {
          ...prev,
          consecutiveFailures: (prev.consecutiveFailures || 0) + 1,
          lastError: r.error,
          lastFailed: date,
        };
  }
}

export function markSeen(state, articles, date) {
  for (const a of articles) {
    state.seen.push({ u: normalizeUrl(a.url), t: normalizeTitle(a.title), d: date });
  }
  state.seen = state.seen.slice(-LIMITS.seenKeep);
}

function nextBuffer(candidates, used, state) {
  const usedIds = new Set(used.map((a) => a.id));
  const seenIndex = buildSeenIndex(state.seen);
  const byId = new Map();
  for (const a of candidates) {
    if (usedIds.has(a.id) || isSeen(seenIndex, { link: a.url, title: a.title })) continue;
    if ((ageInDays(a.fetchedAt) ?? 0) > LIMITS.bufferMaxAgeDays) continue;
    if (!inWordRange(a.wordCount, WORDS)) continue;
    byId.set(a.id, a);
  }
  return [...byId.values()]
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
    .slice(0, LIMITS.bufferKeep);
}

function buildNotices(state, missed) {
  const label = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
  const notices = [];
  for (const id of missed) {
    const n = state.categoryMisses[id];
    notices.push(
      `No ${label[id]} article today${n > 1 ? ` (${n} days in a row)` : ""} — its feeds returned nothing usable.`,
    );
  }
  for (const [name, h] of Object.entries(state.feedHealth)) {
    if (h.consecutiveFailures >= LIMITS.feedFailureWarnAfter) {
      notices.push(`${name} feed has failed ${h.consecutiveFailures} runs in a row (${h.lastError}). Check config/feeds.json.`);
    }
  }
  return notices;
}
