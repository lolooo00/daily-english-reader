// Renders an article as a series of phone-sized pages (1080 × 1920 PNG, 9:16),
// laid out and paginated directly on a canvas: no libraries, no web fonts.

const W = 360;
const H = 640;
const SCALE = 3;
const PAD_X = 26;
const CONTENT_W = W - PAD_X * 2;
const CONTENT_TOP = 54;
const CONTENT_BOTTOM = H - 54;

const SERIF = 'Georgia, "Iowan Old Style", "Noto Serif", "Times New Roman", serif';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const THEMES = {
  light: { bg: "#FBFAF7", text: "#262A31", muted: "#6F7685", faint: "#A3A9B5", accent: "#4B6B9A", chip: "#E8EDF4", rule: "#E4E6EA", quote: "#5D6472", bar: "#D5DAE2" },
  sepia: { bg: "#F5EDDC", text: "#3A3026", muted: "#7A6B58", faint: "#A8987F", accent: "#8A5A2B", chip: "#EADCC1", rule: "#E2D5BA", quote: "#66584A", bar: "#D9C9A8" },
  dark: { bg: "#17191E", text: "#D6DAE1", muted: "#8E96A5", faint: "#5E6676", accent: "#86A8D6", chip: "#242B37", rule: "#2B303A", quote: "#A3AAB7", bar: "#363C48" },
};

const SIZES = {
  s: { body: 15, line: 24 },
  m: { body: 16.5, line: 26.5 },
  l: { body: 18.5, line: 29.5 },
};

export async function renderArticleImages(article, { theme = "light", size = "m", dateLabel = "", siteTitle = "Daily Reader" } = {}) {
  if (document.fonts?.ready) await document.fonts.ready;
  const colors = THEMES[theme] || THEMES.light;
  const sz = SIZES[size] || SIZES.m;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  const measure = measurer(ctx);

  const cover = layoutCover(article, measure, sz);
  const blocks = parseBlocks(article.content).map((b) => layoutBlock(b, measure, sz));
  blocks.push(layoutEnd(article, measure));
  const pages = paginate(blocks, cover.height, sz);

  const blobs = [];
  for (let i = 0; i < pages.length; i++) {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, H);
    if (i === 0) cover.draw(ctx, colors);
    else drawRunningHead(ctx, article, measure, colors);
    for (const { line, y } of pages[i]) line.draw(ctx, y, colors);
    drawFooter(ctx, i, pages.length, colors, measure, `${siteTitle}${dateLabel ? ` · ${dateLabel}` : ""}`);
    blobs.push(await toBlob(canvas));
    await new Promise((r) => setTimeout(r, 0)); // let the dialog repaint between pages
  }
  return blobs;
}

/* ---------- text measuring and wrapping ---------- */

function measurer(ctx) {
  const cache = new Map();
  return (font, text) => {
    const key = `${font}\u0000${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}

/** Splits styled runs into words; a word may span several runs ("word" + "," in another style). */
function toWords(runs, fontOf, measure) {
  const words = [];
  let current = null;
  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (current) words.push(current);
        current = null;
        continue;
      }
      const font = fontOf(run);
      const width = measure(font, part);
      current ||= { segs: [], width: 0 };
      current.segs.push({ text: part, font, width });
      current.width += width;
    }
  }
  if (current) words.push(current);
  return words;
}

function splitLongWord(word, maxWidth, measure) {
  const pieces = [];
  let piece = { segs: [], width: 0 };
  for (const seg of word.segs) {
    let buf = "";
    for (const ch of seg.text) {
      const w = measure(seg.font, buf + ch);
      if (piece.width + w > maxWidth && (buf || piece.segs.length)) {
        if (buf) piece.segs.push({ text: buf, font: seg.font, width: measure(seg.font, buf) });
        piece.width = piece.segs.reduce((s, x) => s + x.width, 0);
        pieces.push(piece);
        piece = { segs: [], width: 0 };
        buf = ch;
      } else {
        buf += ch;
      }
    }
    if (buf) {
      const w = measure(seg.font, buf);
      piece.segs.push({ text: buf, font: seg.font, width: w });
      piece.width += w;
    }
  }
  if (piece.segs.length) pieces.push(piece);
  return pieces;
}

function wrap(words, maxWidth, spaceWidth, measure) {
  const lines = [];
  let line = [];
  let width = 0;
  for (const word of words) {
    if (word.width > maxWidth) {
      if (line.length) lines.push(line);
      const pieces = splitLongWord(word, maxWidth, measure);
      pieces.slice(0, -1).forEach((p) => lines.push([p]));
      line = [pieces.at(-1)];
      width = pieces.at(-1).width;
      continue;
    }
    const add = (line.length ? spaceWidth : 0) + word.width;
    if (line.length && width + add > maxWidth) {
      lines.push(line);
      line = [word];
      width = word.width;
    } else {
      line.push(word);
      width += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawWords(ctx, words, x, baseline, spaceWidth) {
  for (const word of words) {
    for (const seg of word.segs) {
      ctx.font = seg.font;
      ctx.fillText(seg.text, x, baseline);
      x += seg.width;
    }
    x += spaceWidth;
  }
}

function truncate(text, font, maxWidth, measure) {
  if (measure(font, text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(font, `${text.slice(0, mid).trimEnd()}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/* ---------- article HTML → blocks of styled runs ---------- */

function parseBlocks(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const blocks = [];

  const runsOf = (node, style, out = []) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push({ text: child.nodeValue, b: style.b, i: style.i });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === "br") out.push({ text: " ", b: style.b, i: style.i });
        else runsOf(child, { b: style.b || tag === "strong" || tag === "b", i: style.i || tag === "em" || tag === "i" }, out);
      }
    }
    return out;
  };

  const push = (type, runs, extra = {}) => {
    const cleaned = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") })).filter((r) => r.text);
    if (!cleaned.length) return;
    cleaned[0].text = cleaned[0].text.trimStart();
    cleaned[cleaned.length - 1].text = cleaned[cleaned.length - 1].text.trimEnd();
    if (!cleaned.some((r) => r.text.trim())) return;
    blocks.push({ type, runs: cleaned, ...extra });
  };

  const walk = (node, ctx) => {
    let inline = [];
    const flush = () => {
      if (inline.length) push(ctx.quote ? "quote" : "p", inline);
      inline = [];
    };
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        inline.push({ text: child.nodeValue, b: false, i: false });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "p") {
        flush();
        push(ctx.quote ? "quote" : "p", runsOf(child, { b: false, i: false }));
      } else if (/^h[1-6]$/.test(tag)) {
        flush();
        push("h", runsOf(child, { b: true, i: false }), { level: Math.max(2, Math.min(4, Number(tag[1]))) });
      } else if (tag === "blockquote") {
        flush();
        walk(child, { ...ctx, quote: true });
      } else if (tag === "ul" || tag === "ol") {
        flush();
        let n = 0;
        for (const li of child.children) {
          if (li.tagName.toLowerCase() !== "li") continue;
          n++;
          push("li", runsOf(li, { b: false, i: false }), { marker: tag === "ol" ? `${n}.` : "•" });
        }
      } else if (tag === "li") {
        flush();
        push("li", runsOf(child, { b: false, i: false }), { marker: "•" });
      } else {
        inline.push(...runsOf(child, { b: tag === "strong" || tag === "b", i: tag === "em" || tag === "i" }));
      }
    }
    flush();
  };

  walk(doc.body.firstElementChild, { quote: false });
  return blocks;
}

/* ---------- block layout ---------- */

function layoutBlock(block, measure, sz) {
  if (block.type === "h") {
    const size = sz.body * ({ 2: 1.22, 3: 1.12, 4: 1.04 }[block.level] || 1.1);
    const lineH = Math.round(size * 1.38);
    const font = `700 ${size}px ${SERIF}`;
    const words = toWords(block.runs, () => font, measure);
    const space = measure(font, " ");
    const lines = wrap(words, CONTENT_W, space, measure).map((ws) => ({
      h: lineH,
      draw(ctx, y, c) {
        ctx.fillStyle = c.text;
        drawWords(ctx, ws, PAD_X, y + lineH * 0.5 + size * 0.34, space);
      },
    }));
    return { lines, gapBefore: sz.body * 0.9, gapAfter: sz.body * 0.4, keepWithNext: true };
  }

  const quote = block.type === "quote";
  const li = block.type === "li";
  const indent = quote ? 16 : li ? 18 : 0;
  const fontOf = (run) => `${run.i || quote ? "italic " : ""}${run.b ? 700 : 400} ${sz.body}px ${SERIF}`;
  const baseFont = fontOf({});
  const space = measure(baseFont, " ");
  const words = toWords(block.runs, fontOf, measure);
  const wrapped = wrap(words, CONTENT_W - indent, space, measure);
  const lines = wrapped.map((ws, idx) => ({
    h: sz.line,
    draw(ctx, y, c) {
      const baseline = y + sz.line * 0.5 + sz.body * 0.34;
      if (quote) {
        ctx.fillStyle = c.bar;
        ctx.fillRect(PAD_X + 1, y + (idx === 0 ? 4 : 0), 2.5, sz.line - (idx === 0 ? 4 : 0) - (idx === wrapped.length - 1 ? 4 : 0));
      }
      if (li && idx === 0) {
        ctx.fillStyle = c.muted;
        ctx.font = baseFont;
        ctx.fillText(block.marker, PAD_X + 2, baseline);
      }
      ctx.fillStyle = quote ? c.quote : c.text;
      drawWords(ctx, ws, PAD_X + indent, baseline, space);
    },
  }));
  const gap = li ? sz.body * 0.3 : sz.body * 0.72;
  return { lines, gapBefore: quote ? sz.body * 0.3 : 0, gapAfter: gap, keepWithNext: false };
}

function layoutEnd(article, measure) {
  const markFont = `400 12px ${SANS}`;
  const noteFont = `400 10px ${SANS}`;
  let host = "";
  try {
    host = new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep empty */
  }
  const note = truncate(`Original: ${host || article.source}`, noteFont, CONTENT_W, measure);
  const center = (font, text) => PAD_X + (CONTENT_W - measure(font, text)) / 2;
  return {
    lines: [
      {
        h: 30,
        draw(ctx, y, c) {
          ctx.fillStyle = c.faint;
          ctx.font = markFont;
          ctx.fillText("· · ·", center(markFont, "· · ·"), y + 19);
        },
      },
      {
        h: 18,
        draw(ctx, y, c) {
          ctx.fillStyle = c.faint;
          ctx.font = noteFont;
          ctx.fillText(note, center(noteFont, note), y + 12);
        },
      },
    ],
    gapBefore: 6,
    gapAfter: 0,
    keepTogether: true,
  };
}

function layoutCover(article, measure, sz) {
  const titleSize = Math.round(sz.body * 1.42);
  const titleLine = Math.round(titleSize * 1.3);
  const titleFont = `700 ${titleSize}px ${SERIF}`;
  const titleSpace = measure(titleFont, " ");
  const titleLines = wrap(toWords([{ text: article.title }], () => titleFont, measure), CONTENT_W, titleSpace, measure);

  const chipFont = `700 9.5px ${SANS}`;
  const chipText = (article.categoryLabel || article.category || "").toUpperCase();
  const metaFont = `400 11.5px ${SANS}`;
  const statFont = `400 11px ${SANS}`;
  const byline = truncate([article.source, article.author].filter(Boolean).join(" · "), metaFont, CONTENT_W, measure);
  const stats = `${Number(article.wordCount).toLocaleString("en-US")} words · ${article.minutes} min read`;

  const titleTop = 60;
  const titleBottom = titleTop + titleLines.length * titleLine;
  const ruleY = titleBottom + 48;
  return {
    height: ruleY + 20,
    draw(ctx, c) {
      // category chip + brand
      const chipW = measure(chipFont, chipText) + 12;
      ctx.fillStyle = c.chip;
      roundRect(ctx, PAD_X, 24, chipW, 17, 3);
      ctx.fillStyle = c.accent;
      ctx.font = chipFont;
      ctx.fillText(chipText, PAD_X + 6, 36);
      // title
      ctx.fillStyle = c.text;
      titleLines.forEach((ws, i) => {
        drawWords(ctx, ws, PAD_X, titleTop + i * titleLine + titleLine * 0.5 + titleSize * 0.34, titleSpace);
      });
      // byline + stats
      ctx.fillStyle = c.muted;
      ctx.font = metaFont;
      ctx.fillText(byline, PAD_X, titleBottom + 18);
      ctx.fillStyle = c.faint;
      ctx.font = statFont;
      ctx.fillText(stats, PAD_X, titleBottom + 35);
      ctx.fillStyle = c.rule;
      ctx.fillRect(PAD_X, ruleY, CONTENT_W, 1);
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/* ---------- pagination ---------- */

function paginate(blocks, coverHeight, sz) {
  const pages = [[]];
  let y = coverHeight;
  let atTop = true;
  const newPage = () => {
    pages.push([]);
    y = CONTENT_TOP;
    atTop = true;
  };

  blocks.forEach((block, bi) => {
    let gap = atTop ? 0 : block.gapBefore;
    const total = block.lines.reduce((s, l) => s + l.h, 0);
    const room = CONTENT_BOTTOM - (y + gap);

    if (block.keepTogether && total > room && !atTop) newPage();
    else if (block.keepWithNext && !atTop) {
      // A heading needs its own lines plus two lines of what follows on the same page.
      const nextLine = blocks[bi + 1]?.lines[0]?.h || 0;
      if (total + nextLine * 2 > room) newPage();
    } else if (block.lines.length >= 2 && !atTop && room >= block.lines[0].h && room < block.lines[0].h + block.lines[1].h) {
      newPage(); // avoid a single orphan line at the bottom
    }
    if (atTop) gap = 0;

    for (const line of block.lines) {
      if (y + gap + line.h > CONTENT_BOTTOM && !atTop) {
        newPage();
        gap = 0;
      }
      pages.at(-1).push({ line, y: y + gap });
      y += gap + line.h;
      gap = 0;
      atTop = false;
    }
    y += block.gapAfter;
  });
  return pages.filter((p, i) => i === 0 || p.length);
}

/* ---------- page furniture ---------- */

function drawRunningHead(ctx, article, measure, c) {
  const font = `400 10px ${SANS}`;
  ctx.fillStyle = c.faint;
  ctx.font = font;
  ctx.fillText(truncate(article.title, font, CONTENT_W, measure), PAD_X, 32);
}

function drawFooter(ctx, index, total, c, measure, label) {
  const y = H - 36;
  ctx.fillStyle = c.rule;
  ctx.fillRect(PAD_X, y, CONTENT_W, 1.5);
  ctx.fillStyle = c.accent;
  ctx.fillRect(PAD_X, y, CONTENT_W * ((index + 1) / total), 1.5);
  const font = `400 9.5px ${SANS}`;
  const pageText = `${index + 1} / ${total}`;
  ctx.font = font;
  ctx.fillStyle = c.faint;
  ctx.fillText(truncate(label, font, CONTENT_W - 50, measure), PAD_X, H - 19);
  ctx.fillStyle = c.muted;
  ctx.fillText(pageText, W - PAD_X - measure(font, pageText), H - 19);
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob failed"))), "image/png");
  });
}
