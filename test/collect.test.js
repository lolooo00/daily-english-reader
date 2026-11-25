import { test } from "node:test";
import assert from "node:assert/strict";
import { collectIssue } from "../src/collect.js";
import { emptyState } from "../src/state.js";

const DATE = "2026-11-25";
const feedsConfig = {
  tech: [{ name: "TechFeed" }],
  law: [{ name: "LawFeed" }],
  gaming: [{ name: "GameFeed" }],
  fun: [{ name: "FunFeed" }],
};

function feedsWith(itemsByFeed, failing = []) {
  return async (feed) => {
    if (failing.includes(feed.name)) throw new Error("HTTP 500");
    return (itemsByFeed[feed.name] || []).map((i) => ({ ...i, source: feed.name }));
  };
}

const items = (prefix, n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${prefix} story ${i}`,
    link: `https://${prefix.toLowerCase()}.example/${i}`,
    published: new Date().toISOString(),
  }));

/** Extractor fake: word count comes from a map, default 800 (in range). */
function extractor(words = {}) {
  return async (url) => ({
    title: `Title of ${url}`,
    author: null,
    content: "<p>text</p>",
    wordCount: words[url] ?? 800,
  });
}

const run = (overrides) =>
  collectIssue({
    date: DATE,
    feedsConfig,
    state: emptyState(),
    budgetMs: 60_000,
    rand: () => 0.3,
    log: () => {},
    ...overrides,
  });

test("one article per category on a normal day", async () => {
  const state = emptyState();
  const { articles, notices } = await run({
    state,
    fetchFeed: feedsWith({ TechFeed: items("Tech"), LawFeed: items("Law"), GameFeed: items("Game"), FunFeed: items("Fun") }),
    extractArticle: extractor(),
  });
  assert.deepEqual(articles.map((a) => a.category), ["tech", "law", "gaming", "fun"]);
  assert.deepEqual(notices, []);
  assert.equal(state.seen.length, 4);
  assert.equal(state.feedHealth.TechFeed.consecutiveFailures, 0);
});

test("skips out-of-range articles and keeps spare in-range ones in the buffer", async () => {
  const state = emptyState();
  const tech = items("Tech", 4);
  const { articles } = await run({
    state,
    fetchFeed: feedsWith({ TechFeed: tech, LawFeed: items("Law"), GameFeed: items("Game"), FunFeed: items("Fun") }),
    // rand 0.3 shuffles deterministically; make every tech article but one too short or too long
    extractArticle: extractor(Object.fromEntries(tech.map((t, i) => [t.link, i === 2 ? 900 : i % 2 ? 2500 : 120]))),
  });
  const techPick = articles.find((a) => a.category === "tech");
  assert.equal(techPick.wordCount, 900);
  assert.ok(articles.every((a) => a.wordCount >= 500 && a.wordCount <= 1500));
});

test("a dead category is filled from another category and reported", async () => {
  const state = emptyState();
  const { articles, notices } = await run({
    state,
    fetchFeed: feedsWith({ TechFeed: items("Tech"), GameFeed: items("Game"), FunFeed: items("Fun") }, ["LawFeed"]),
    extractArticle: extractor(),
  });
  assert.equal(articles.length, 4);
  assert.ok(!articles.some((a) => a.category === "law"));
  assert.equal(state.categoryMisses.law, 1);
  assert.equal(state.feedHealth.LawFeed.consecutiveFailures, 1);
  assert.ok(notices.some((n) => n.includes("No Law article")));
});

test("buffered article of the same category is used before borrowing", async () => {
  const state = emptyState();
  state.buffer.push({
    id: "buf1",
    url: "https://law.example/buffered",
    title: "Buffered law piece",
    source: "LawFeed",
    category: "law",
    wordCount: 700,
    minutes: 4,
    content: "<p>x</p>",
    fetchedAt: new Date().toISOString(),
  });
  const { articles } = await run({
    state,
    fetchFeed: feedsWith({ TechFeed: items("Tech"), GameFeed: items("Game"), FunFeed: items("Fun") }, ["LawFeed"]),
    extractArticle: extractor(),
  });
  assert.equal(articles.find((a) => a.category === "law")?.title, "Buffered law piece");
  assert.equal(state.buffer.some((a) => a.id === "buf1"), false);
});

test("already-read links are never picked again", async () => {
  const state = emptyState();
  const law = items("Law", 2);
  state.seen.push({ u: "https://law.example/0", t: "", d: "2026-11-20" });
  const { articles } = await run({
    state,
    fetchFeed: feedsWith({ TechFeed: items("Tech"), LawFeed: law, GameFeed: items("Game"), FunFeed: items("Fun") }),
    extractArticle: extractor(),
  });
  assert.equal(articles.find((a) => a.category === "law").url, "https://law.example/1");
});

test("a three-strikes feed shows a maintenance notice", async () => {
  const state = emptyState();
  state.feedHealth.FunFeed = { consecutiveFailures: 2, lastError: "HTTP 403" };
  const { notices } = await run({
    state,
    fetchFeed: feedsWith({ TechFeed: items("Tech"), LawFeed: items("Law"), GameFeed: items("Game") }, ["FunFeed"]),
    extractArticle: extractor(),
  });
  assert.ok(notices.some((n) => n.startsWith("FunFeed feed has failed 3 runs")));
});

test("an exhausted time budget downloads nothing instead of hanging", async () => {
  let calls = 0;
  const { articles } = await run({
    budgetMs: 1_000,
    fetchFeed: feedsWith({ TechFeed: items("Tech"), LawFeed: items("Law"), GameFeed: items("Game"), FunFeed: items("Fun") }),
    extractArticle: async () => {
      calls++;
      return null;
    },
  });
  assert.equal(calls, 0);
  assert.equal(articles.length, 0);
});

test("with nothing in range, the closest near miss is used instead of leaving a gap", async () => {
  const fun = items("Fun", 3);
  const { articles } = await run({
    fetchFeed: feedsWith({ TechFeed: items("Tech"), LawFeed: items("Law"), GameFeed: items("Game"), FunFeed: fun }),
    extractArticle: extractor({ [fun[0].link]: 4000, [fun[1].link]: 1700, [fun[2].link]: 1900 }),
  });
  assert.equal(articles.find((a) => a.category === "fun").wordCount, 1700);
});
