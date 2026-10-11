// CI smoke gate tests: scripts/assert-smoke-verdict.mjs decides whether a
// release build may be uploaded, so its exit codes are pinned here against
// real log shapes (verdict lines copied from actual `--heretek-smoke` runs
// of the built app, 2026-10-11).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');

const NOISE =
  'Fontconfig warning: "/etc/fonts/conf.d/49-sansserif.conf", line 42: invalid constant used : math\n' +
  '15:18:26.365 › Created window with Electron ID: 1, window number: 0, isPrimary: true\n';
const PASS =
  'HERETEK_SMOKE:{"ok":true,"failures":[],"results":{"seed":true,"limits":{"status":200,"maxCloudProjects":999},"subscription":{"status":200,"planId":"gdevelop_startup"},"passthrough":{"resolved":true,"spoofed":false,"status":403},"errors":[],"xhr":{"status":200,"maxCloudProjects":999}}}';
const FAIL =
  'HERETEK_SMOKE:{"ok":false,"failures":["XHR limits not unlocked (app client path): never settled"],"results":{"seed":true,"xhr":{"status":0,"error":"never settled"}}}';

describe('release: smoke verdict gate', () => {
  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-verdict-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const gate = (name, text) => {
    const file = path.join(dir, name);
    if (text !== null) fs.writeFileSync(file, text);
    return spawnSync('node', ['scripts/assert-smoke-verdict.mjs', file], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  };

  it('passes an ok:true verdict buried in Chromium noise (CRLF too)', () => {
    assert.equal(gate('pass.log', `${NOISE}${PASS}\n`).status, 0);
    assert.equal(gate('crlf.log', `${NOISE}${PASS}\r\n`.replace(/\n/g, '\r\n')).status, 0);
  });

  it('fails an ok:false verdict and prints the failures', () => {
    const r = gate('fail.log', `${NOISE}${FAIL}\n`);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('XHR limits not unlocked'));
  });

  it('the last verdict wins', () => {
    assert.equal(gate('last-fail.log', `${PASS}\n${FAIL}\n`).status, 1);
    assert.equal(gate('last-pass.log', `${FAIL}\n${PASS}\n`).status, 0);
  });

  it('fails a log with no verdict line, and a missing log', () => {
    const none = gate('none.log', NOISE);
    assert.equal(none.status, 1);
    assert.ok(none.stderr.includes('never reported a verdict'));
    assert.equal(gate('absent.log', null).status, 2);
  });
});
