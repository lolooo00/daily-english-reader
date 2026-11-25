import { createHash } from "node:crypto";

const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|cmpid|taid|mbid|rss|ref_?src)$/i;

/** Canonical form used only for de-duplication (the original link is kept for display). */
export function normalizeUrl(raw) {
  if (!raw) return "";
  try {
    const u = new URL(String(raw).trim());
    u.hash = "";
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
    }
    return u.toString().replace(/\/(\?|$)/, "$1");
  } catch {
    return String(raw).trim();
  }
}

export function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function articleId(url) {
  return createHash("sha1").update(normalizeUrl(url)).digest("hex").slice(0, 10);
}

export function countWords(text) {
  const words = String(text || "").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
  return words ? words.length : 0;
}

export function shuffle(list, rand = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** YYYY-MM-DD of `date` as seen in `timeZone`. */
export function dateInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function ageInDays(dateLike, now = Date.now()) {
  const t = Date.parse(dateLike);
  return Number.isNaN(t) ? null : (now - t) / 86_400_000;
}

export function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Rejects after `ms` even if the underlying work never settles. */
export function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function errorMessage(err) {
  if (!err) return "unknown error";
  if (err.name === "TimeoutError" || err.name === "AbortError") return "timed out";
  const msg = err.cause?.code || err.message || String(err);
  return String(msg).slice(0, 160);
}

/** Fills `{{KEY}}` placeholders. Uses a function replacer, so `$&`-style text in values stays literal. */
export function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON that is safe to place inside a <script> element. */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}
