// Integration Test: patched-tree import closure.
//
// The Tier-2 glue spreads across files that import from each other
// (AskAi <- AiRequestUtils, AiRequestContext, Utils, CustomAIClient,
// Studio/*). Markers prove each patch landed; THIS test proves the
// combination resolves: every relative import in the patched surface
// points at a file that exists and exports every imported name.
// (This class of break — webpack's "not exported from" — is exactly what
// markers cannot catch; it killed the first release-build attempt.)
//
// Scope: all files touched by patches 07-14 plus the Tier-2 overlay.
// Flow `import type` and `X as Y` aliases are resolved to their base
// names; bare-package imports (react, axios, @lingui) are skipped.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const UPSTREAM =
  process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');
const SRC = 'newIDE/app/src';

const SURFACE = [
  'AiGeneration/AskAiEditorContainer.js',
  'AiGeneration/AiRequestUtils.js',
  'AiGeneration/AiRequestContext.js',
  'AiGeneration/Utils.js',
  'AiGeneration/PrepareAiUserContent.js',
  'AiGeneration/AiRequestChat/Utils.js',
  'Utils/GDevelopServices/Generation.js',
  'MainFrame/Preferences/PreferencesDialog.js',
  'MainFrame/Preferences/PreferencesContext.js',
  'MainFrame/Preferences/PreferencesProvider.js',
  'MainFrame/Preferences/PreferencesStorage.js',
  'AI/CustomAIClient.js',
  'AiGeneration/Studio/UseStudioRuntime.js',
  'AiGeneration/Studio/UseStudioNudge.js',
];

function collectFiles(dir) {
  // Materialize the full upstream source surface the driver needs, then
  // overlay: simplest is git-archive of the fixture's newIDE subtree.
  const r = spawnSync(
    'git',
    ['-C', UPSTREAM, 'archive', 'HEAD', 'newIDE/app/src', 'newIDE/electron-app'],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
  );
  assert.equal(r.status, 0, 'cannot archive upstream fixture');
  const tar = path.join(dir, 'src.tar');
  fs.writeFileSync(tar, r.stdout);
  const un = spawnSync('tar', ['-x', '-C', dir, '-f', tar]);
  assert.equal(un.status, 0, 'cannot unpack upstream fixture');
  fs.unlinkSync(tar);
}

function parseImports(text) {
  // Returns [{source, names[], isDefault}] for relative imports only.
  const out = [];
  const re = /import\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:\{([^}]*)\})?\s*from\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, def, named, source] = m;
    if (!source.startsWith('.')) continue; // bare package: skip
    const names = (named || '')
      .split(',')
      .map(s => s.trim().replace(/^type\s+/, ''))
      .filter(Boolean)
      .map(s => s.split(/\s+as\s+/)[0].trim());
    out.push({ source, names, def: def || null });
  }
  return out;
}

function resolveImport(fromFile, source, dir) {
  const base = path.resolve(path.dirname(fromFile), source);
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function exportedNames(text) {
  const names = new Set();
  const re = /export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/g;
  let m;
  while ((m = re.exec(text)) !== null) names.add(m[1]);
  if (/export\s+default\b/.test(text)) names.add('default');
  return names;
}

describe('integration: patched-tree import closure', () => {
  it('every relative import in the patched surface resolves', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-closure-'));
    try {
      collectFiles(dir);
      const r = spawnSync(
        'node',
        ['scripts/apply-patches.mjs', '--target', dir, '--no-verify'],
        { cwd: ROOT, encoding: 'utf8' }
      );
      assert.equal(
        r.status,
        0,
        `driver failed on fixture tree:\n${r.stdout}\n${r.stderr}`
      );
      const failures = [];
      for (const rel of SURFACE) {
        const abs = path.join(dir, SRC, rel);
        if (!fs.existsSync(abs)) {
          failures.push(`${rel}: file missing after apply`);
          continue;
        }
        const text = fs.readFileSync(abs, 'utf8');
        for (const imp of parseImports(text)) {
          const target = resolveImport(abs, imp.source, dir);
          if (!target) {
            failures.push(`${rel}: unresolvable ${imp.source}`);
            continue;
          }
          const exports = exportedNames(fs.readFileSync(target, 'utf8'));
          for (const name of imp.names) {
            if (!exports.has(name)) {
              failures.push(
                `${rel}: '${name}' not exported from ${path.relative(path.join(dir, SRC), target)}`
              );
            }
          }
          if (imp.def && !exports.has('default') && !exports.has(imp.def)) {
            // Default import of a named-exports module: tolerated only for
            // known interop shims (React). Anything else is flagged.
            if (imp.def !== 'React') {
              failures.push(
                `${rel}: default import '${imp.def}' has no default export in ${path.relative(path.join(dir, SRC), target)}`
              );
            }
          }
        }
      }
      assert.equal(
        failures.length,
        0,
        `import closure broken:\n${failures.slice(0, 20).join('\n')}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
