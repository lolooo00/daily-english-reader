import Parser from "rss-parser";
import { extract } from "@extractus/article-extractor";
import { LIMITS, USER_AGENT } from "./config.js";
import { cleanArticleHtml, cleanText, wordCountOf } from "./sanitize.js";
import { errorMessage, withTimeout } from "./util.js";

const parser = new Parser();

/** Fetches one feed entry from feeds.json (which may list several URLs) and returns its items. */
export async function fetchFeed(feed) {
  const urls = feed.urls || [feed.url];
  const results = await Promise.allSettled(urls.map((url) => fetchFeedUrl(url)));
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push(`${urls[i]}: ${errorMessage(r.reason)}`);
  });
  if (items.length === 0 && errors.length > 0) throw new Error(errors.join("; "));
  return items.map((item) => ({ ...item, source: feed.name }));
}

async function fetchFeedUrl(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    },
    signal: AbortSignal.timeout(LIMITS.feedTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const feed = await parser.parseString(xml);
  return (feed.items || [])
    .filter((item) => item.link && item.title)
    .map((item) => ({
      title: cleanText(item.title),
      link: item.link.trim(),
      published: item.isoDate || item.pubDate || null,
    }));
}

/**
 * Downloads and cleans one article. Every network step has a hard timeout,
 * so a slow site can never stall the whole run.
 */
export async function extractArticle(url) {
  const signal = AbortSignal.timeout(LIMITS.articleTimeoutMs);
  const article = await withTimeout(
    extract(url, {}, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal,
    }),
    LIMITS.articleTimeoutMs + 3_000,
    "article download",
  );
  if (!article?.content) return null;
  const content = cleanArticleHtml(article.content, { title: article.title });
  const wordCount = wordCountOf(content);
  return {
    title: cleanText(article.title),
    author: article.author ? cleanText(article.author).slice(0, 120) : null,
    published: article.published || null,
    content,
    wordCount,
  };
}
