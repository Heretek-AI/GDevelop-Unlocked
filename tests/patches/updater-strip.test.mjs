// Updater-feed strip tests: the release build must never ship an
// electron-updater feed pointing at upstream releases.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const UPSTREAM =
  process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');
const CONFIG = 'newIDE/electron-app/electron-builder-config.js';

function stripOnCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-strip-'));
  const src = path.join(UPSTREAM, CONFIG);
  assert.ok(fs.existsSync(src), `missing fixture ${CONFIG}`);
  const destDir = path.join(dir, 'newIDE/electron-app');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, 'electron-builder-config.js'));
  const r = spawnSync('node', ['scripts/strip-updater-feed.mjs', dir], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `strip failed:\n${r.stdout}\n${r.stderr}`);
  return { dir, text: fs.readFileSync(path.join(destDir, 'electron-builder-config.js'), 'utf8') };
}

describe('release: updater feed is neutered', () => {
  it('removes the publish block from the real upstream config', () => {
    const { dir, text } = stripOnCopy();
    try {
      assert.ok(!text.includes('publish:'), 'publish block survived');
      assert.ok(!text.includes("provider: 'github'"), 'github provider survived');
      // Everything else (appId, targets, signing branches) must be intact.
      assert.ok(text.includes("appId: 'com.gdevelop-app.ide'"), 'appId lost');
      assert.ok(text.includes('GD_PORTABLE_BUILD'), 'portable branch lost');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent (second run is a no-op, exit 0)', () => {
    const { dir } = stripOnCopy();
    try {
      const r = spawnSync('node', ['scripts/strip-updater-feed.mjs', dir], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `re-run failed:\n${r.stdout}\n${r.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('treats a config without publish as already neutered', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-strip-neg-'));
    try {
      const destDir = path.join(dir, 'newIDE/electron-app');
      fs.mkdirSync(destDir, { recursive: true });
      fs.writeFileSync(
        path.join(destDir, 'electron-builder-config.js'),
        'const config = { appId: 1 };\nmodule.exports = config;\n'
      );
      const r = spawnSync('node', ['scripts/strip-updater-feed.mjs', dir], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      // No publish key at all: treated as already-neutered, exit 0.
      assert.equal(r.status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
