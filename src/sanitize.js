import sanitizeHtml from "sanitize-html";
import { PARAGRAPH_BLOCKLIST } from "./config.js";
import { countWords, normalizeTitle } from "./util.js";

const TEXT_BLOCKS = new Set(["p", "li", "h2", "h3", "h4", "blockquote"]);

const OPTIONS = {
  allowedTags: ["p", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "em", "strong", "a", "br"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  // Tags whose whole content is dropped, not just the tag.
  nonTextTags: [
    "script", "style", "textarea", "option", "noscript", "template",
    "figure", "figcaption", "picture", "video", "audio", "iframe", "svg", "canvas",
    "button", "form", "nav", "aside", "footer", "table", "math",
  ],
  transformTags: {
    h1: "h2",
    h5: "h4",
    h6: "h4",
    b: "strong",
    i: "em",
    a: (tagName, attribs) => {
      const href = attribs.href && /^https?:\/\//i.test(attribs.href) ? attribs.href : null;
      return { tagName: "a", attribs: href ? { href, target: "_blank", rel: "noopener noreferrer" } : {} };
    },
  },
  exclusiveFilter(frame) {
    if (!TEXT_BLOCKS.has(frame.tag)) return false;
    const text = frame.text.replace(/\s+/g, " ").trim();
    if (!text) return true;
    return PARAGRAPH_BLOCKLIST.some((re) => re.test(text));
  },
};

/**
 * Reduces extracted article HTML to the reader whitelist:
 * p, h2–h4, lists, blockquote, em, strong and http(s) links. No images, no attributes but href.
 */
export function cleanArticleHtml(html, { title } = {}) {
  let out = sanitizeHtml(String(html || ""), OPTIONS);
  // A second pass drops containers emptied by the first one.
  for (let i = 0; i < 2; i++) {
    out = out.replace(/<(ul|ol|blockquote|p|li|h[2-4])>(\s|<br \/>)*<\/\1>/g, "");
  }
  out = out.replace(/(<br \/>\s*){2,}/g, "<br />").replace(/\n{3,}/g, "\n\n").trim();

  // Many extractors repeat the headline as the first heading.
  if (title) {
    const first = out.match(/^<h[2-4]>([\s\S]*?)<\/h[2-4]>/);
    if (first && normalizeTitle(toPlainText(first[1])) === normalizeTitle(title)) {
      out = out.slice(first[0].length).trim();
    }
  }
  return out;
}

export function toPlainText(html) {
  // Block boundaries become spaces so "</p><p>" does not glue two words together.
  const spaced = String(html || "").replace(/<\/(p|li|h[1-6]|blockquote|div|td|th)>|<br\s*\/?>/gi, "$& ");
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCountOf(html) {
  return countWords(toPlainText(html));
}

export function cleanText(value) {
  return toPlainText(value).slice(0, 300);
}
