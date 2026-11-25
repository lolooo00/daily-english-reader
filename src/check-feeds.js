// Feed health check: npm run check-feeds [category]
// For each feed, shows how many items it returns and how its newest articles extract.
import { readFileSync } from "node:fs";
import { CATEGORIES, CATEGORY_EXCLUDES, FEEDS_PATH, WORDS } from "./config.js";
import { compileExcludes, isBlockedTitle } from "./select.js";
import { extractArticle, fetchFeed } from "./sources.js";
import { errorMessage } from "./util.js";

const only = process.argv[2];
const feeds = JSON.parse(readFileSync(FEEDS_PATH, "utf-8"));
const SAMPLE = 4;

for (const { id } of CATEGORIES) {
  if (only && only !== id) continue;
  console.log(`\n== ${id} ==`);
  await Promise.all(
    (feeds[id] || []).map(async (feed) => {
      const lines = [];
      try {
        const items = await fetchFeed(feed);
        const excludes = [...compileExcludes(feed), ...(CATEGORY_EXCLUDES[id] || [])];
        const usable = items.filter((i) => !isBlockedTitle(i.title, excludes));
        lines.push(`${feed.name}: ${items.length} items (${items.length - usable.length} blocked by title)`);
        for (const item of usable.slice(0, SAMPLE)) {
          try {
            const a = await extractArticle(item.link);
            const words = a?.wordCount ?? 0;
            const ok = words >= WORDS.min && words <= WORDS.max;
            lines.push(`   ${ok ? "✓" : "·"} ${String(words).padStart(5)} words  ${item.title.slice(0, 70)}`);
          } catch (err) {
            lines.push(`   ✗ ${errorMessage(err).padEnd(11)}  ${item.title.slice(0, 70)}`);
          }
        }
      } catch (err) {
        lines.push(`${feed.name}: FAILED — ${errorMessage(err)}`);
      }
      console.log(lines.join("\n"));
    }),
  );
}
process.exit(0);
