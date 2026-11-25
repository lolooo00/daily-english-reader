import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeenIndex, filterCandidates, interleaveBySource, isBlockedTitle } from "../src/select.js";

const now = Date.parse("2026-11-25T00:00:00Z");
const item = (title, link, extra = {}) => ({ title, link, source: "S", published: "2026-11-24T00:00:00Z", ...extra });

test("filters seen links and seen titles", () => {
  const seenIndex = buildSeenIndex([
    { u: "https://example.com/old", t: "an old story" },
  ]);
  const { kept, dropped } = filterCandidates(
    [
      item("Fresh", "https://example.com/new"),
      item("Other", "https://www.example.com/old/?utm_source=x"),
      item("An Old Story!", "https://mirror.example/old-copy"),
    ],
    { seenIndex, now, maxAgeDays: 21 },
  );
  assert.deepEqual(kept.map((i) => i.title), ["Fresh"]);
  assert.equal(dropped.seen, 2);
});

test("blocks shopping posts and feed-specific patterns", () => {
  assert.ok(isBlockedTitle("Canon Promo Codes: 30% Off for November 2026"));
  assert.ok(isBlockedTitle("The Best Early Black Friday TV Deals"));
  assert.ok(isBlockedTitle("Appendix to Civil Rights Deserts", [/^appendix\b/i]));
  assert.ok(!isBlockedTitle("Supreme Court allows border policy to continue"));
});

test("drops stale items and in-batch duplicates", () => {
  const { kept, dropped } = filterCandidates(
    [
      item("New", "https://a.example/1"),
      item("New", "https://b.example/1"),
      item("Ancient", "https://a.example/2", { published: "2026-09-01T00:00:00Z" }),
    ],
    { seenIndex: buildSeenIndex(), now, maxAgeDays: 21 },
  );
  assert.deepEqual(kept.map((i) => i.link), ["https://a.example/1"]);
  assert.equal(dropped.old, 1);
});

test("interleaves sources so a big feed cannot crowd out small ones", () => {
  const items = [
    ...Array.from({ length: 6 }, (_, i) => ({ source: "Big", link: `b${i}` })),
    { source: "Small", link: "s0" },
    { source: "Tiny", link: "t0" },
  ];
  const firstThree = interleaveBySource(items, () => 0.5).slice(0, 3).map((i) => i.source).sort();
  assert.deepEqual(firstThree, ["Big", "Small", "Tiny"]);
});
