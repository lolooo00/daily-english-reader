#!/usr/bin/env node
/**
 * Daily entry point.
 *
 *   node src/run.js              fetch today's issue if it does not exist yet, then build the site
 *   node src/run.js --force      re-fetch today's issue even if it exists
 *   node src/run.js --fetch-only fetch step of the workflow (exit code 1 when nothing usable was found)
 *   node src/run.js --no-fetch   build only
 *
 * In GitHub Actions the fetch step writes `fetched` and `state_changed` step outputs.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { buildSite } from "./build.js";
import { collectIssue } from "./collect.js";
import { FEEDS_PATH, TIME_ZONE } from "./config.js";
import { extractArticle, fetchFeed } from "./sources.js";
import { hasIssue, loadState, saveIssue, saveState } from "./state.js";
import { dateInZone } from "./util.js";

const args = new Set(process.argv.slice(2));

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main() {
  const date = process.env.ISSUE_DATE || dateInZone(new Date(), TIME_ZONE);
  const exists = hasIssue(date);
  const shouldFetch = !args.has("--no-fetch") && (args.has("--force") || !exists);
  let fetched = false;

  if (shouldFetch) {
    console.log(`Fetching issue ${date}${exists ? " (replacing existing)" : ""}…`);
    const state = loadState();
    const feedsConfig = JSON.parse(readFileSync(FEEDS_PATH, "utf-8"));
    const { articles, notices, report } = await collectIssue({
      date,
      feedsConfig,
      state,
      fetchFeed,
      extractArticle,
    });
    state.lastRun = { ...report, ok: articles.length > 0 };
    saveState(state);
    output("state_changed", "true");

    if (articles.length === 0) {
      console.error(`\nNo usable article from any feed or the buffer. Issue ${date} not written.`);
      notices.forEach((n) => console.error(`  ! ${n}`));
      output("fetched", "false");
      // Locally, still rebuild so the page shows the latest existing issue.
      return args.has("--fetch-only") ? 1 : buildOnly();
    }
    saveIssue({ date, generatedAt: new Date().toISOString(), articles, notices });
    fetched = true;
    console.log(`\nIssue ${date}: ${articles.length} articles in ${(report.durationMs / 1000).toFixed(1)} s`);
    articles.forEach((a) => console.log(`  - [${a.category}] ${a.title} (${a.source}, ${a.wordCount} words)`));
    notices.forEach((n) => console.log(`  ! ${n}`));
  } else {
    console.log(`Issue ${date} ${exists ? "already exists" : "not fetched"}; skipping fetch.`);
  }

  output("fetched", String(fetched));

  if (!args.has("--fetch-only")) {
    const { pages, articles } = buildSite();
    console.log(`Built ${pages} pages (${articles} articles in archive).`);
  }
  return 0;
}

function buildOnly() {
  const { pages, articles } = buildSite();
  console.log(`Built ${pages} pages (${articles} articles in archive).`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
