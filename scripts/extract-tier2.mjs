// Extracts Tier-2 donor files VERBATIM from the fork into
// packages/ai-studio/ (Phase 4, issue #4). The fork is a donor, not a
// delivery vehicle: these files are never hand-edited here.
//
//   node scripts/extract-tier2.mjs --fork review/GDevelop-Heretek
//
// Writes MANIFEST.json (sha256 per file); tests/tier2/extract.test.mjs
// re-verifies byte-identity. To refresh after a fork sync, re-run with
// the new fork checkout — any content change shows up as a manifest
// diff in code review.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const DEST = path.join(ROOT, 'packages', 'ai-studio');

// Donor paths, relative to the fork root. Kept explicit (not a glob)
// so additions/removals in the fork are noticed, not silently absorbed.
const DONOR_FILES = [
  'newIDE/app/src/AI/CustomAIClient.js',
  'newIDE/app/src/AI/CustomAIClient.spec.js',
  'newIDE/app/src/AiGeneration/Studio/EditApprovalLabel.js',
  'newIDE/app/src/AiGeneration/Studio/FinalizeSubAgents.js',
  'newIDE/app/src/AiGeneration/Studio/LoopGuard.js',
  'newIDE/app/src/AiGeneration/Studio/NudgePolicy.js',
  'newIDE/app/src/AiGeneration/Studio/PlanStore.js',
  'newIDE/app/src/AiGeneration/Studio/RequestWriteGate.js',
  'newIDE/app/src/AiGeneration/Studio/Roles.js',
  'newIDE/app/src/AiGeneration/Studio/RoleToolPolicy.js',
  'newIDE/app/src/AiGeneration/Studio/SafeTruncation.js',
  'newIDE/app/src/AiGeneration/Studio/SpawnSubAgents.js',
  'newIDE/app/src/AiGeneration/Studio/UseStudioNudge.js',
  'newIDE/app/src/AiGeneration/Studio/UseStudioRuntime.js',
  'scripts/dev/mock-ai-provider.js',
  'scripts/dev/mock-script.example.json',
  'scripts/dev/mock-script-multi.json',
  'scripts/dev/mock-script-specialists.json',
  'scripts/dev/mock-child-scripts.example.json',
];

// Fork-relative -> package-relative layout.
function destFor(rel) {
  if (rel.startsWith('newIDE/app/src/'))
    return rel.slice('newIDE/app/src/'.length);
  if (rel.startsWith('scripts/dev/'))
    return 'dev-harness/' + rel.slice('scripts/dev/'.length);
  throw new Error(`No destination mapping for donor file: ${rel}`);
}

function parseArgs(argv) {
  const out = { fork: path.join(ROOT, 'review', 'GDevelop-Heretek') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fork') out.fork = path.resolve(argv[++i]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const manifest = { donor: args.fork, files: {} };

for (const rel of DONOR_FILES) {
  const src = path.join(args.fork, rel);
  if (!fs.existsSync(src)) {
    throw new Error(
      `Donor file missing: ${rel} (fork checkout at ${args.fork}). ` +
        `If the fork moved it, update DONOR_FILES explicitly.`
    );
  }
  const content = fs.readFileSync(src);
  const dest = path.join(DEST, destFor(rel));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  manifest.files[destFor(rel)] = {
    donor: rel,
    bytes: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
  console.log(`extracted ${destFor(rel)} (${content.length} bytes)`);
}

fs.writeFileSync(
  path.join(DEST, 'MANIFEST.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log(`wrote MANIFEST.json (${DONOR_FILES.length} files)`);
