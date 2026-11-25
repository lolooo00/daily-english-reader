import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.js";

const STATE_PATH = () => join(DATA_DIR, "state.json");
const ISSUES_DIR = () => join(DATA_DIR, "issues");

export function emptyState() {
  return { version: 2, seen: [], buffer: [], feedHealth: {}, categoryMisses: {}, lastRun: null };
}

export function loadState() {
  if (!existsSync(STATE_PATH())) return emptyState();
  const state = JSON.parse(readFileSync(STATE_PATH(), "utf-8"));
  return { ...emptyState(), ...state };
}

/** Writes to a temp file first so a crash never leaves half-written JSON behind. */
function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function saveState(state) {
  writeJson(STATE_PATH(), state);
}

export function hasIssue(date) {
  return existsSync(join(ISSUES_DIR(), `${date}.json`));
}

export function loadIssue(date) {
  return JSON.parse(readFileSync(join(ISSUES_DIR(), `${date}.json`), "utf-8"));
}

export function saveIssue(issue) {
  writeJson(join(ISSUES_DIR(), `${issue.date}.json`), issue);
}

/** Issue dates, newest first. */
export function listIssueDates() {
  if (!existsSync(ISSUES_DIR())) return [];
  return readdirSync(ISSUES_DIR())
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}
