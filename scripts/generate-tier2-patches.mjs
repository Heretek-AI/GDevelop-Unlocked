// Generates Tier-2 glue patches as VERBATIM fork deltas (Phase 4) —
// currently only the purely-additive 09/10 (see patches/REBASE.md: 07/08/11
// are curated forward-ports, NOT verbatim deltas, and must never be
// regenerated here). Unlike Tier-1 (curated minimal hunks), the 09/10
// deltas are woven through their files, so each patch carries the exact
// fork diff — no hand-editing, no silent shaping.
//
// On-demand regeneration of the additive 09/10 deltas only. Needs an
// explicit fork checkout (the retired donor — not present in this repo,
// not needed by any test or CI path):
//   node scripts/generate-tier2-patches.mjs --upstream review/GDevelop --fork <donor-checkout>
//
// Each patch round-trips (`patch -p1 --dry-run` on a pristine copy)
// before it is written. Regeneration is deterministic: committed output
// must equal fresh output (pinned by tests/tier2/tier2-patches.test.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

const PATCHES = [
  // Verbatim fork deltas (safe: the fork postdates upstream on these
  // files, so the diff is purely additive — no upstream-new code to
  // delete). Pinned byte-for-byte by tier2-patches.test.mjs.
  {
    name: '09-prepare-ai-content.patch',
    files: ['newIDE/app/src/AiGeneration/PrepareAiUserContent.js'],
  },
  {
    name: '10-ai-chat-affordance.patch',
    files: ['newIDE/app/src/AiGeneration/AiRequestChat/Utils.js'],
  },
  // NOTE: 07/08/11 are curated forward-ports (see patches/REBASE.md), NOT
  // verbatim deltas — generating them here would reintroduce reverts of
  // upstream-new code. They are intentionally absent from this list.
];

function parseArgs(argv) {
  const out = {
    upstream: path.join(ROOT, 'review', 'GDevelop'),
    fork: path.join(ROOT, 'review', 'GDevelop-Heretek'),
    out: path.join(ROOT, 'patches'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--upstream') out.upstream = path.resolve(argv[++i]);
    else if (argv[i] === '--fork') out.fork = path.resolve(argv[++i]);
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
  }
  return out;
}

function diffFile(upstreamAbs, forkAbs, rel, isNew) {
  const args = isNew
    ? ['-U3', `--label=a/${rel}`, `--label=b/${rel}`, '/dev/null', forkAbs]
    : ['-U3', `--label=a/${rel}`, `--label=b/${rel}`, upstreamAbs, forkAbs];
  const r = spawnSync('diff', args, { encoding: 'utf8' });
  if (r.status === 0)
    throw new Error(
      `No delta for ${rel} — fork stopped diverging there. ` +
        `Drop it from the glue list instead of shipping an empty patch.`
    );
  if (r.status !== 1 || !r.stdout)
    throw new Error(`diff failed for ${rel} (status ${r.status}): ${r.stderr}`);
  return r.stdout;
}

const args = parseArgs(process.argv.slice(2));
const scratchBase =
  process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp/opencode';
fs.mkdirSync(scratchBase, { recursive: true });
fs.mkdirSync(args.out, { recursive: true });

for (const patch of PATCHES) {
  let combined = '';
  for (const rel of patch.files) {
    const upstreamAbs = path.join(args.upstream, rel);
    const forkAbs = path.join(args.fork, rel);
    const isNew = !fs.existsSync(upstreamAbs);
    if (!fs.existsSync(forkAbs))
      throw new Error(`Fork file missing: ${rel}`);
    combined += diffFile(upstreamAbs, forkAbs, rel, isNew);
  }
  const checkDir = path.join(scratchBase, `tier2-rt-${Date.now()}`);
  fs.mkdirSync(checkDir, { recursive: true });
  const tmpPatch = path.join(scratchBase, `tier2-rt-${Date.now()}.patch`);
  fs.writeFileSync(tmpPatch, combined);
  // Round-trip against pristine upstream copies of exactly these files.
  for (const rel of patch.files) {
    if (!fs.existsSync(path.join(args.upstream, rel))) continue;
    const dest = path.join(checkDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(args.upstream, rel), dest);
  }
  const dry = spawnSync('patch', ['-p1', '--dry-run', '-i', tmpPatch], {
    cwd: checkDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  fs.rmSync(checkDir, { recursive: true, force: true });
  fs.unlinkSync(tmpPatch);
  if (dry.status !== 0)
    throw new Error(
      `Round-trip FAILED for ${patch.name}:\n${dry.stdout}\n${dry.stderr}`
    );
  fs.writeFileSync(path.join(args.out, patch.name), combined);
  console.log(`wrote ${patch.name} (${patch.files.length} file(s), round-trip clean)`);
}
console.log('done.');
