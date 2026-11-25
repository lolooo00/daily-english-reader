import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.js reads these at import time, so set them before importing the build.
const root = mkdtempSync(join(tmpdir(), "dr-build-"));
process.env.DATA_DIR = join(root, "data");
process.env.DIST_DIR = join(root, "dist");
const { saveIssue } = await import("../src/state.js");
const { buildSite } = await import("../src/build.js");

const article = (id, category, title) => ({
  id,
  url: `https://example.com/${id}`,
  title,
  source: "Example",
  author: null,
  category,
  wordCount: 900,
  minutes: 5,
  content: "<p>Price: $' and $& stay literal. </script> stays inert.</p>",
  fetchedAt: "2026-11-25T00:00:00Z",
});

test("builds index, issue pages and a newest-first archive", () => {
  saveIssue({ date: "2026-11-24", articles: [article("a1", "tech", "Older")], notices: [] });
  saveIssue({ date: "2026-11-25", articles: [article("b1", "law", "Newer <b>")], notices: ["Feed X is down"] });

  const { articles } = buildSite();
  assert.equal(articles, 2);

  const dist = process.env.DIST_DIR;
  for (const f of ["index.html", "archive.html", "archive.json", "issues/2026-11-24.html", "issues/2026-11-25.html", "assets/app.js", "assets/export.js", ".nojekyll"]) {
    assert.ok(existsSync(join(dist, f)), `${f} missing`);
  }

  const archive = JSON.parse(readFileSync(join(dist, "archive.json"), "utf-8"));
  assert.deepEqual(archive.map((e) => e.id), ["b1", "a1"]);

  const index = readFileSync(join(dist, "index.html"), "utf-8");
  assert.match(index, /Feed X is down/);
  assert.match(index, /assets\/app\.js\?v=[0-9a-f]{8}/);
  // Article HTML is embedded as JSON that cannot break out of its script tag.
  const json = index.match(/<script id="issue-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data.articles[0].title, "Newer <b>");
  assert.match(data.articles[0].content, /\$' and \$& stay literal/);

  const older = readFileSync(join(dist, "issues/2026-11-24.html"), "utf-8");
  assert.ok(!older.includes("Feed X is down"), "notices only show on the latest issue");
  assert.match(older, /href="\.\.\/assets\/app\.css/);
});
