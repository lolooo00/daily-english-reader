import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countWords,
  dateInZone,
  jsonForScript,
  normalizeTitle,
  normalizeUrl,
  renderTemplate,
} from "../src/util.js";

test("normalizeUrl drops tracking params, www, hash and trailing slash", () => {
  assert.equal(
    normalizeUrl("http://www.Example.com/story/?utm_source=rss&id=7#comments"),
    "https://example.com/story?id=7",
  );
  assert.equal(normalizeUrl("https://example.com/a/"), normalizeUrl("https://www.example.com/a"));
});

test("normalizeTitle ignores case, quotes and punctuation", () => {
  assert.equal(normalizeTitle("The “Pollycrisis”: What Now?"), normalizeTitle("the pollycrisis what now"));
});

test("countWords counts hyphenated and apostrophe words once", () => {
  assert.equal(countWords("It's a well-known fact — isn’t it?"), 6);
});

test("dateInZone uses the Beijing date, not UTC", () => {
  // 20:30 UTC on Nov 24 is 04:30 on Nov 25 in Beijing.
  assert.equal(dateInZone(new Date("2026-11-24T20:30:00Z"), "Asia/Shanghai"), "2026-11-25");
});

test("renderTemplate keeps $-patterns in values literal", () => {
  assert.equal(renderTemplate("<p>{{X}}</p>", { X: "costs $' and $& and $$" }), "<p>costs $' and $& and $$</p>");
  assert.equal(renderTemplate("{{MISSING}}", {}), "{{MISSING}}");
});

test("jsonForScript cannot close the script element", () => {
  const out = jsonForScript({ html: "</script><script>alert(1)</script>" });
  assert.ok(!out.includes("</script>"));
  assert.deepEqual(JSON.parse(out), { html: "</script><script>alert(1)</script>" });
});
