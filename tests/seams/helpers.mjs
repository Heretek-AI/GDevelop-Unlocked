// Shared helpers for Phase 1 seam (drift-tripwire) tests.
// Each assertion failure prints a `file:line` pointer so upstream drift
// is loud, not silent. Shape assertions only — never behavior.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Repo root = two levels above tests/seams/.
export const REPO_ROOT = path.resolve(here, '..', '..');
export const UPSTREAM_DIR =
  process.env.UPSTREAM_DIR || path.join(REPO_ROOT, 'review', 'GDevelop');

export function readUpstream(relPath) {
  const abs = path.join(UPSTREAM_DIR, relPath);
  assert.ok(
    fs.existsSync(abs),
    `Missing upstream file: ${relPath} (looked in ${abs}). ` +
      `Set UPSTREAM_DIR or refresh review/GDevelop.`
  );
  return { abs, rel: relPath, text: fs.readFileSync(abs, 'utf8') };
}

export function lines(text) {
  return text.split('\n');
}

/** 1-based line number of the first line matching `re`, or -1. */
export function findLine(text, re) {
  const ls = lines(text);
  for (let i = 0; i < ls.length; i++) {
    if (re.test(ls[i])) return i + 1;
  }
  return -1;
}

/** All 1-based line numbers matching `re`. */
export function findAllLines(text, re) {
  const out = [];
  const ls = lines(text);
  for (let i = 0; i < ls.length; i++) {
    if (re.test(ls[i])) out.push(i + 1);
  }
  return out;
}

export function mustContain(
  { abs, rel, text },
  substring,
  { what, hint } = {}
) {
  assert.ok(
    text.includes(substring),
    `SEAM DRIFT: ${rel} no longer contains ${JSON.stringify(substring)}` +
      `${what ? ` (${what})` : ''}. File: ${abs}.` +
      `${hint ? ` Hint: ${hint}` : ''}`
  );
}

export function mustMatch({ abs, rel, text }, re, { what, hint } = {}) {
  assert.ok(
    re.test(text),
    `SEAM DRIFT: ${rel} no longer matches ${re}` +
      `${what ? ` (${what})` : ''}. File: ${abs}.` +
      `${hint ? ` Hint: ${hint}` : ''}`
  );
}

export function mustMatchWord(file, symbol, { what, hint } = {}) {
  const { abs, rel, text } = file;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Block prefix-collisions: a rename to `${symbol}_RENAMED` must NOT match.
  const re = new RegExp(escaped + '(?![\\w$])');
  assert.ok(
    re.test(text),
    `SEAM DRIFT: ${rel} lost symbol ${JSON.stringify(symbol)}` +
      `${what ? ` (${what})` : ''}. File: ${abs}.` +
      `${hint ? ` Hint: ${hint}` : ''}`
  );
}

/**
 * Assert a seam symbol lives near its audited line (tolerance guards
 * against hunk shifts; a move beyond tolerance fails loudly).
 */
export function mustBeNearLine(
  file,
  re,
  expectedLine,
  tolerance,
  symbolName
) {
  const actual = findLine(file.text, re);
  assert.ok(
    actual !== -1,
    `SEAM DRIFT: ${file.rel} lost symbol ${symbolName} (${re}). ` +
      `File: ${file.abs}. Expected near line ${expectedLine}.`
  );
  const drift = Math.abs(actual - expectedLine);
  assert.ok(
    drift <= tolerance,
    `SEAM DRIFT: ${symbolName} moved in ${file.rel} ` +
      `from ~line ${expectedLine} to line ${actual} (drift ${drift} > tolerance ${tolerance}). ` +
      `File: ${file.abs}:${actual}. Update patches/ + launcher to the new hunk.`
  );
  return actual;
}
