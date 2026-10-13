// Guard: the Tier-2 AI Studio runtime must not read the unqualified browser
// globals that CRA's `no-restricted-globals` (eslint-config-react-app) bans.
//
// Why this exists: release run 38344881723 failed on all three OS jobs at
// `npm run build` because `packages/ai-studio/AI/CustomAIClient.js` read the
// global `parent` (it meant the parent request) — an eslint error the local
// `npm test` suite could never see, since it never runs eslint. The failure
// was invisible until a full release build.
//
// This is a TARGETED guard for that regression class, not a replacement for
// the real lint. It scans only `parent`, `top`, `self` — the banned globals
// that are implausible as deliberate local names — and it is a plain text
// scan, so it can only prove absence of those three, not conformance to the
// full rule. The release build remains the authority.
//
// The scan strips line comments, block comments and string/template literals
// first, so the many prose/tool-description mentions of "parent" and "top"
// (and `stepFrames` templates) do not trip it. Code inside a template
// interpolation is treated as string text and skipped; no Tier-2 file relies
// on that today.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.resolve(here, '..', '..', 'packages', 'ai-studio');

// The two directories the driver overlays onto newIDE/app/src (see
// `TIER2_FILES` in scripts/apply-patches.mjs).
const SCAN_DIRS = ['AI', path.join('AiGeneration', 'Studio')];
const RESTRICTED = ['parent', 'top', 'self'];

// Blank out comments and string/template literals while preserving every
// character OFFSET: a removed character becomes a space, a removed newline
// stays a newline. That keeps reported line/column numbers identical to the
// original source (matching what eslint would print).
export function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const mask = ch => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += mask(src[i]);
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          out += mask(src[i]);
          if (i + 1 < n) out += mask(src[i + 1]);
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          out += ' ';
          i++;
          break;
        }
        out += mask(src[i]);
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function findRestrictedGlobals(src) {
  const stripped = stripCommentsAndStrings(src);
  const hits = [];
  const lines = stripped.split('\n');
  for (let li = 0; li < lines.length; li++) {
    for (const name of RESTRICTED) {
      // Bare identifier: not preceded by an identifier char or a dot (so
      // `foo.parent` and `parentRequest` are fine) and not followed by one.
      const re = new RegExp(`(^|[^\\w$.])${name}\\b`, 'g');
      let m;
      while ((m = re.exec(lines[li])) !== null) {
        hits.push(`${name} (line ${li + 1}, col ${m.index + m[1].length + 1})`);
      }
    }
  }
  return hits;
}

function collectTier2Sources() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(PACKAGE, dir);
    for (const name of fs.readdirSync(abs)) {
      if (name.endsWith('.js') && !name.endsWith('.spec.js')) {
        files.push(path.join(abs, name));
      }
    }
  }
  return files;
}

describe('unit: Tier-2 sources avoid banned browser globals', () => {
  it('no unqualified `parent`/`top`/`self` in the synced AI Studio runtime', () => {
    const files = collectTier2Sources();
    assert.ok(
      files.length >= 14,
      `expected the full Tier-2 surface (14 files), saw ${files.length}`
    );

    const failures = [];
    for (const file of files) {
      const rel = path.relative(PACKAGE, file);
      for (const hit of findRestrictedGlobals(fs.readFileSync(file, 'utf8'))) {
        failures.push(`${rel}: ${hit}`);
      }
    }
    assert.equal(
      failures.length,
      0,
      `banned browser globals in Tier-2 sources:\n${failures.join('\n')}`
    );
  });
});
