// Pin consistency: UPSTREAM_BASELINE.json is the single source of truth
// for the upstream commit the patches target, but two workflows must
// spell the same commit out (Actions cannot read JSON into a `default:`
// or a checkout ref without extra steps). This test makes a partial bump
// impossible to merge: change one, and the suite names the others.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const pin = JSON.parse(read('UPSTREAM_BASELINE.json')).verifiedAtUpstreamCommit;

describe('pins: one upstream commit everywhere', () => {
  it('baseline pin is an unambiguous commit prefix', () => {
    assert.match(pin, /^[0-9a-f]{10,40}$/);
  });

  it('seam-tests.yml checks out the baseline commit', () => {
    const m = read('.github/workflows/seam-tests.yml').match(
      /git -C review\/GDevelop checkout ([0-9a-f]{40})/
    );
    assert.ok(m, 'seam-tests.yml: pinned checkout line not found');
    assert.ok(
      m[1].startsWith(pin),
      `seam-tests.yml checks out ${m[1]}, baseline is ${pin}`
    );
  });

  it('release.yml defaults to the baseline commit', () => {
    const m = read('.github/workflows/release.yml').match(
      /upstream_ref:[\s\S]*?default: '([0-9a-f]{40})'/
    );
    assert.ok(m, 'release.yml: upstream_ref default not found');
    assert.ok(
      m[1].startsWith(pin),
      `release.yml defaults to ${m[1]}, baseline is ${pin}`
    );
  });

  it('local fixture sits on the baseline commit', t => {
    // An explicit UPSTREAM_DIR is a deliberate drift run against another
    // commit (e.g. upstream HEAD) — only the default fixture is pinned.
    const fixture = path.join(ROOT, 'review', 'GDevelop');
    if (process.env.UPSTREAM_DIR || !fs.existsSync(path.join(fixture, '.git')))
      return t.skip('no default git fixture in play');
    const r = spawnSync('git', ['-C', fixture, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.stdout.trim().startsWith(pin),
      `review/GDevelop is at ${r.stdout.trim()}, baseline is ${pin}`
    );
  });
});
