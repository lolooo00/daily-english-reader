import { TITLE_BLOCKLIST } from "./config.js";
import { ageInDays, normalizeTitle, normalizeUrl, shuffle } from "./util.js";

export function buildSeenIndex(seen = [], extraUrls = []) {
  const urls = new Set();
  const titles = new Set();
  for (const entry of seen) {
    if (entry.u) urls.add(entry.u);
    if (entry.t) titles.add(entry.t);
  }
  for (const url of extraUrls) urls.add(normalizeUrl(url));
  return { urls, titles };
}

export function isSeen(index, { link, title }) {
  return index.urls.has(normalizeUrl(link)) || (title && index.titles.has(normalizeTitle(title)));
}

export function compileExcludes(feed) {
  return (feed.exclude || []).map((pattern) => new RegExp(pattern, "i"));
}

export function isBlockedTitle(title, excludes = []) {
  return TITLE_BLOCKLIST.some((re) => re.test(title)) || excludes.some((re) => re.test(title));
}

/**
 * Drops items already read, blocked by title, or older than `maxAgeDays`,
 * and de-duplicates within the batch.
 */
export function filterCandidates(items, { seenIndex, excludes = [], maxAgeDays, now = Date.now() }) {
  const kept = [];
  const dropped = { seen: 0, blocked: 0, old: 0 };
  const batch = new Set();
  for (const item of items) {
    const key = normalizeUrl(item.link);
    const titleKey = normalizeTitle(item.title);
    if (batch.has(key) || batch.has(titleKey) || isSeen(seenIndex, item)) {
      dropped.seen++;
      continue;
    }
    if (isBlockedTitle(item.title, excludes)) {
      dropped.blocked++;
      continue;
    }
    const age = ageInDays(item.published, now);
    if (maxAgeDays && age !== null && age > maxAgeDays) {
      dropped.old++;
      continue;
    }
    batch.add(key);
    batch.add(titleKey);
    kept.push(item);
  }
  return { kept, dropped };
}

/**
 * Shuffles within each source, then takes one item per source in turn,
 * so a feed with 100 items does not crowd out a feed with 10.
 */
export function interleaveBySource(items, rand = Math.random) {
  const bySource = new Map();
  for (const item of items) {
    if (!bySource.has(item.source)) bySource.set(item.source, []);
    bySource.get(item.source).push(item);
  }
  const queues = shuffle([...bySource.values()], rand).map((q) => shuffle(q, rand));
  const out = [];
  while (queues.some((q) => q.length)) {
    for (const q of queues) if (q.length) out.push(q.shift());
  }
  return out;
}

export function inWordRange(count, { min, max }) {
  return count >= min && count <= max;
}
