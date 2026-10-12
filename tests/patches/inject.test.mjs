// Injector tests: launcher injection into extracted-asar layouts,
// idempotent re-runs, and loud failure on a restructured main.js.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  findMainJs,
  injectIntoAppDir,
} from '../../scripts/inject-launcher.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

const MINIMAL_MAIN = `const electron = require('electron');
const path = require('path');
const newWindow = new BrowserWindow(options);
`;

describe('inject: extracted-asar layout', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-test-'));
    fs.writeFileSync(path.join(dir, 'main.js'), MINIMAL_MAIN);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('finds flat main.js and injects loader above the anchor', () => {
    assert.equal(findMainJs(dir), path.join(dir, 'main.js'));
    const r = injectIntoAppDir(dir);
    assert.equal(r.loaderAdded, true);
    assert.deepEqual(r.filesSynced.length, 4);
    const text = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
    assert.ok(
      text.indexOf("installPreloadHook()") <
        text.indexOf("const electron = require('electron');")
    );
    for (const f of [
      'heretek-hook.cjs',
      'preload-unlock.cjs',
      'unlock-payloads.cjs',
      'debug-logger.cjs',
    ]) {
      assert.equal(
        fs.readFileSync(path.join(dir, f), 'utf8'),
        fs.readFileSync(path.join(ROOT, 'launcher', f), 'utf8')
      );
    }
  });

  it('re-runs are verified no-ops', () => {
    injectIntoAppDir(dir);
    const r = injectIntoAppDir(dir);
    assert.equal(r.loaderAdded, false);
    assert.deepEqual(r.filesSynced, []);
  });

  it('fails loudly when the anchor is gone', () => {
    fs.writeFileSync(path.join(dir, 'main.js'), '// restructured\n');
    assert.throws(() => injectIntoAppDir(dir), /anchor missing/);
  });
});
