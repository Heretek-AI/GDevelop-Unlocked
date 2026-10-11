// Updater-feed strip tests: the release build must never ship an
// electron-updater feed pointing at upstream releases.
//
// What "neutered" means is load-bearing: the config must evaluate to
// `publish === null`. A config with the key merely deleted still yields
// resources/app-update.yml (electron-builder derives the feed from
// package.json `repository`), which is how the first CI artifact shipped
// one. Limit: electron-builder is not installed here, so these tests pin
// the config value it reads, not the packaged output — release.yml
// asserts the built artifact has no app-update.yml.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const UPSTREAM =
  process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');
const CONFIG = 'newIDE/electron-app/electron-builder-config.js';
const require = createRequire(import.meta.url);

function strip(dir) {
  return spawnSync('node', ['scripts/strip-updater-feed.mjs', dir], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function makeTree(configText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updater-strip-'));
  const abs = path.join(dir, CONFIG);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (configText === undefined) {
    const src = path.join(UPSTREAM, CONFIG);
    assert.ok(fs.existsSync(src), `missing fixture ${CONFIG}`);
    fs.copyFileSync(src, abs);
  } else {
    fs.writeFileSync(abs, configText);
  }
  return { dir, abs };
}

describe('release: updater feed is neutered', () => {
  it('real upstream config evaluates to publish === null, rest intact', () => {
    const { dir, abs } = makeTree();
    try {
      assert.deepEqual(require(abs).publish, [{ provider: 'github' }]);
      delete require.cache[abs];
      const r = strip(dir);
      assert.equal(r.status, 0, `strip failed:\n${r.stdout}\n${r.stderr}`);
      const config = require(abs);
      assert.equal(config.publish, null);
      assert.ok('publish' in config, 'key must stay: absent means auto-detect');
      // Everything else (appId, targets, signing hook) must be intact.
      assert.equal(config.appId, 'com.gdevelop-app.ide');
      assert.equal(config.win.target.length, 2);
      assert.equal(config.afterSign, 'scripts/electron-builder-after-sign.js');
      const text = fs.readFileSync(abs, 'utf8');
      assert.ok(!text.includes("provider: 'github'"), 'github provider survived');
      assert.ok(text.includes('GD_PORTABLE_BUILD'), 'portable branch lost');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent (second run is a verified no-op, exit 0)', () => {
    const { dir, abs } = makeTree();
    try {
      assert.equal(strip(dir).status, 0);
      const once = fs.readFileSync(abs, 'utf8');
      const r = strip(dir);
      assert.equal(r.status, 0, `re-run failed:\n${r.stdout}\n${r.stderr}`);
      assert.equal(fs.readFileSync(abs, 'utf8'), once);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a config with no publish key (feed would be auto-detected)', () => {
    const { dir } = makeTree(
      'const config = { appId: 1 };\nmodule.exports = config;\n'
    );
    try {
      const r = strip(dir);
      assert.equal(r.status, 1, 'absent key was accepted as neutered');
      assert.ok(r.stderr.includes('no `publish:` key'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when publish is re-assigned after the object literal', () => {
    // The text edit alone would pass; evaluating the config catches it.
    const { dir } = makeTree(
      "const config = { appId: 1, publish: [{ provider: 'github' }] };\n" +
        "config.publish = [{ provider: 'generic', url: 'https://example.invalid' }];\n" +
        'module.exports = config;\n'
    );
    try {
      const r = strip(dir);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes('evaluated config still has publish'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
