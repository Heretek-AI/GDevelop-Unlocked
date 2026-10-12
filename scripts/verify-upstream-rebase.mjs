// Rebase drift gate (T12, issues #10 #13): proves the whole patch stack
// still applies cleanly to a pristine upstream tree.
//
//   node scripts/verify-upstream-rebase.mjs [--upstream <dir>]
//
// Steps (all real I/O, no mocks):
//   1. Resolve the upstream fixture (UPSTREAM_DIR, --upstream, or
//      <root>/review/GDevelop). Refuse a dirty fixture (`git status
//      --short` must be empty) and record its HEAD SHA.
//   2. Extract a pristine copy (`git archive HEAD newIDE/app/src
//      newIDE/electron-app | tar -x -C <scratch>`) into a TMPDIR scratch
//      dir (os.tmpdir(), never hard-coded /tmp). The fixture is READ-ONLY.
//   3. Run the real driver (`node scripts/apply-patches.mjs --target
//      <scratch>`), which dry-runs every hunk first, applies, then verifies
//      unlock markers — plus `--verify-only` as an explicit read-only
//      marker-contract second gate.
//   4. Exit 0 on clean. Exit 1 lists every failing patch file (per-patch
//      `patch --dry-run` re-probe) and the recorded upstream SHA.
//
// Bare node builtins only. The scratch tree is always removed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

const usage = () =>
  'Usage: node scripts/verify-upstream-rebase.mjs [--upstream <dir>]\n' +
  '  Upstream defaults to $UPSTREAM_DIR or <root>/review/GDevelop.';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--upstream') out.upstream = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}\n${usage()}`);
      process.exit(2);
    }
  }
  return out;
}

const git = (args, cwd) =>
  spawnSync('git', args, { cwd, encoding: 'utf8' });

const listPatches = () =>
  fs
    .readdirSync(path.join(ROOT, 'patches'))
    .filter(f => f.endsWith('.patch'))
    .sort()
    .map(f => path.join(ROOT, 'patches', f));

// Re-probe each patch file with `patch --dry-run` against the pristine
// tree to name exactly which files fail (the driver aborts on the first).
function failingPatches(scratch) {
  const failed = [];
  for (const p of listPatches()) {
    const r = spawnSync('patch', ['-p1', '-s', '--dry-run', '-i', p], {
      cwd: scratch,
      encoding: 'utf8',
    });
    if (r.status !== 0) failed.push(path.basename(p));
  }
  return failed;
}

const main = () => {
  const { upstream: flagUpstream } = parseArgs(process.argv.slice(2));
  const upstream =
    flagUpstream || process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');
  if (!fs.existsSync(path.join(upstream, '.git'))) {
    console.error(`[verify-upstream-rebase] not a git checkout: ${upstream}\n${usage()}`);
    process.exit(2);
  }
  const dirty = git(['status', '--short'], upstream);
  if (dirty.status !== 0) {
    console.error(`[verify-upstream-rebase] cannot inspect fixture: ${dirty.stderr}`);
    process.exit(2);
  }
  if (dirty.stdout.trim().length > 0) {
    console.error(
      '[verify-upstream-rebase] fixture is dirty — refusing to gate against it:\n' +
        dirty.stdout
    );
    process.exit(2);
  }
  const head = git(['rev-parse', 'HEAD'], upstream);
  if (head.status !== 0) {
    console.error(`[verify-upstream-rebase] cannot read fixture HEAD: ${head.stderr}`);
    process.exit(2);
  }
  const sha = head.stdout.trim();
  console.log(`[verify-upstream-rebase] upstream HEAD: ${sha} (${upstream})`);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-rebase-'));
  try {
    // Pristine copy straight from git (fixture untouched, read-only).
    const archive = spawnSync(
      `git -C "${upstream}" archive HEAD newIDE/app/src newIDE/electron-app | tar -x -C "${scratch}"`,
      { shell: true, encoding: 'utf8' }
    );
    if (archive.status !== 0) {
      console.error(
        `[verify-upstream-rebase] archive extract failed:\n${archive.stdout}${archive.stderr}`
      );
      process.exit(1);
    }
    if (!fs.existsSync(path.join(scratch, 'newIDE'))) {
      console.error('[verify-upstream-rebase] extract produced no newIDE/ tree.');
      process.exit(1);
    }
    console.log(`[verify-upstream-rebase] pristine copy at ${scratch}`);

    // Gate 1: the real driver (dry-run every hunk, apply, verify markers).
    const apply = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'apply-patches.mjs'), '--target', scratch],
      { cwd: ROOT, encoding: 'utf8' }
    );
    if (apply.status !== 0) {
      const failed = failingPatches(scratch);
      console.error(
        `[verify-upstream-rebase] REBASE NEEDED against ${sha}.\n` +
          `Failing patch file(s): ${failed.length > 0 ? failed.join(', ') : '(see driver output)'}\n` +
          `--- driver output ---\n${apply.stdout}${apply.stderr}`
      );
      process.exit(1);
    }
    // Gate 2: read-only marker contract on the patched scratch tree.
    const verify = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts', 'apply-patches.mjs'),
        '--verify-only',
        '--target',
        scratch,
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );
    if (verify.status !== 0) {
      console.error(
        `[verify-upstream-rebase] marker contract failed after clean apply:\n${verify.stdout}${verify.stderr}`
      );
      process.exit(1);
    }
    console.log(
      `[verify-upstream-rebase] CLEAN: all ${listPatches().length} patches apply + verify at ${sha}.`
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};

main();
