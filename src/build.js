import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES, DIST_DIR, SITE_DIR, SITE_TITLE, TEMPLATES_DIR, TIME_ZONE } from "./config.js";
import { listIssueDates, loadIssue } from "./state.js";
import { escapeHtml, jsonForScript, longDate, renderTemplate } from "./util.js";

const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

function template(name) {
  return readFileSync(join(TEMPLATES_DIR, name), "utf-8");
}

function copyAssets() {
  const dir = join(DIST_DIR, "assets");
  mkdirSync(dir, { recursive: true });
  const hash = createHash("sha1");
  for (const name of readdirSync(SITE_DIR).sort()) {
    copyFileSync(join(SITE_DIR, name), join(dir, name));
    hash.update(name).update(readFileSync(join(SITE_DIR, name)));
  }
  return hash.digest("hex").slice(0, 8);
}

function readerPage(issue, { base, version, isLatest, latestDate }) {
  const articles = (issue?.articles || []).map((a) => ({
    id: a.id,
    url: a.url,
    title: a.title,
    source: a.source,
    author: a.author || "",
    category: a.category,
    categoryLabel: CATEGORY[a.category]?.label || a.category,
    categoryShort: CATEGORY[a.category]?.short || a.category,
    wordCount: a.wordCount,
    minutes: a.minutes,
    content: a.content,
  }));
  const data = {
    date: issue?.date || null,
    dateLabel: issue ? longDate(issue.date) : "",
    isLatest,
    latestDate,
    timeZone: TIME_ZONE,
    siteTitle: SITE_TITLE,
    actionsUrl: process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions` : null,
    articles,
  };
  const notices = isLatest && issue?.notices?.length
    ? `<div class="notices" role="status">${issue.notices.map((n) => `<p>${escapeHtml(n)}</p>`).join("")}</div>`
    : "";
  return renderTemplate(template("reader.html"), {
    BASE: base,
    V: version,
    PAGE_TITLE: escapeHtml(issue ? `${SITE_TITLE} · ${longDate(issue.date)}` : SITE_TITLE),
    DATE_LABEL: escapeHtml(data.dateLabel || "No issue yet"),
    NOTICES: notices,
    ISSUE_JSON: jsonForScript(data),
  });
}

/** Regenerates the whole static site in dist/ from the issues in the data directory. */
export function buildSite() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(join(DIST_DIR, "issues"), { recursive: true });
  const version = copyAssets();

  const dates = listIssueDates();
  const latestDate = dates[0] || null;
  const archive = [];
  let pages = 0;

  for (const date of dates) {
    const issue = loadIssue(date);
    const isLatest = date === latestDate;
    writeFileSync(
      join(DIST_DIR, "issues", `${date}.html`),
      readerPage(issue, { base: "../", version, isLatest, latestDate }),
    );
    pages++;
    if (isLatest) {
      writeFileSync(join(DIST_DIR, "index.html"), readerPage(issue, { base: "", version, isLatest, latestDate }));
      pages++;
    }
    for (const a of issue.articles) {
      archive.push({
        id: a.id,
        date,
        title: a.title,
        source: a.source,
        category: a.category,
        minutes: a.minutes,
      });
    }
  }
  if (!latestDate) {
    writeFileSync(join(DIST_DIR, "index.html"), readerPage(null, { base: "", version, isLatest: true, latestDate }));
    pages++;
  }

  writeFileSync(join(DIST_DIR, "archive.json"), JSON.stringify(archive));
  writeFileSync(
    join(DIST_DIR, "archive.html"),
    renderTemplate(template("archive.html"), {
      BASE: "",
      V: version,
      CONFIG_JSON: jsonForScript({
        categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
        total: archive.length,
      }),
    }),
  );
  writeFileSync(join(DIST_DIR, ".nojekyll"), "");
  pages++;
  return { pages, articles: archive.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pages, articles } = buildSite();
  console.log(`Built ${pages} pages (${articles} articles in archive) → ${DIST_DIR}`);
}
