// Generator tests: committed patches are generator output, not hand
// edits. Both generators run for real against the pristine fixture and
// write to a scratch --out; nothing in patches/ or the fixture is touched.
//
// Tier-2 has no donor checkout to diff against (this repo is
// fork-independent), so its round-trip uses a synthetic donor: pristine
// upstream files with the committed 09/10 applied. That proves
// generate(upstream, upstream + patch) === patch — determinism of the
// tool and of the committed bytes — not provenance from the retired fork.
import { describe, it, before, after } from 'node:test';
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

const TIER1 = [
  '01-usage-predicate.patch',
  '02-auth-context-seed.patch',
  '03-subscription-checker.patch',
  '04-loading-screen.patch',
  '05-preview-debugger.patch',
  '06-electron-hook.patch',
];
const TIER2_VERBATIM = {
  '09-prepare-ai-content.patch':
    'newIDE/app/src/AiGeneration/PrepareAiUserContent.js',
  '10-ai-chat-affordance.patch':
    'newIDE/app/src/AiGeneration/AiRequestChat/Utils.js',
};

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function assertSameBytes(dir, name) {
  assert.ok(
    fs.readFileSync(path.join(dir, name)).equals(
      fs.readFileSync(path.join(ROOT, 'patches', name))
    ),
    `${name}: committed patch differs from fresh generator output ` +
      '(hand-edited, or the generator/fixture moved)'
  );
}

describe('generators: committed patches are reproducible output', () => {
  let scratch;
  before(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-test-'));
  });
  after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it('Tier-1: 01-06 equal fresh generator output', () => {
    const out = path.join(scratch, 'tier1');
    const r = run(
      'node',
      ['scripts/generate-tier1-patches.mjs', '--upstream', UPSTREAM, '--out', out],
      ROOT
    );
    assert.equal(r.status, 0, `generator failed:\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(fs.readdirSync(out).sort(), TIER1);
    for (const name of TIER1) assertSameBytes(out, name);
  });

  it('Tier-2: 09/10 round-trip byte-identically (synthetic donor)', () => {
    const donor = path.join(scratch, 'donor');
    for (const [patch, rel] of Object.entries(TIER2_VERBATIM)) {
      const dest = path.join(donor, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(UPSTREAM, rel), dest);
      const applied = run(
        'patch',
        ['-p1', '-s', '-i', path.join(ROOT, 'patches', patch)],
        donor
      );
      assert.equal(applied.status, 0, `${patch} failed to apply:\n${applied.stderr}`);
    }
    const out = path.join(scratch, 'tier2');
    const r = run(
      'node',
      [
        'scripts/generate-tier2-patches.mjs',
        '--upstream', UPSTREAM,
        '--fork', donor,
        '--out', out,
      ],
      ROOT
    );
    assert.equal(r.status, 0, `generator failed:\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(fs.readdirSync(out).sort(), Object.keys(TIER2_VERBATIM));
    for (const name of Object.keys(TIER2_VERBATIM)) assertSameBytes(out, name);
  });

  it('Tier-2 generator has no implicit donor path', () => {
    const r = run(
      'node',
      ['scripts/generate-tier2-patches.mjs', '--out', path.join(scratch, 'none')],
      ROOT
    );
    assert.notEqual(r.status, 0, 'ran without --fork');
    assert.ok(r.stderr.includes('--fork <donor-checkout> is required'));
    assert.ok(!fs.existsSync(path.join(scratch, 'none')), 'wrote output anyway');
  });
});
