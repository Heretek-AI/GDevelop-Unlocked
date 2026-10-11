// Tier-2 glue patch tests (Phase 4): committed verbatim patches (09/10)
// equal fresh generator output (deterministic — any hand-edit or fork
// drift goes red); curated forward-ports (07/08/11, see patches/REBASE.md)
// are pinned instead by anti-revert assertions; everything dry-runs clean
// on pristine upstream copies.
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
const FORK =
  process.env.FORK_DIR || path.join(ROOT, 'review', 'GDevelop-Heretek');

const GLUE = [
  // Curated forward-ports (patches/REBASE.md): must dry-run clean and must
  // NOT delete upstream-new symbols. Never byte-pinned to the verbatim
  // generator — that would reintroduce the reverts.
  {
    patch: '07-generation-glue.patch',
    files: ['newIDE/app/src/Utils/GDevelopServices/Generation.js'],
    noDelete: ['AiRequestAttachment', 'createAiAttachmentUploads', 'createAiAttachmentDownloads'],
  },
  {
    patch: '08-preferences-ai.patch',
    files: [
      'newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js',
      'newIDE/app/src/MainFrame/Preferences/PreferencesContext.js',
      'newIDE/app/src/MainFrame/Preferences/PreferencesProvider.js',
      'newIDE/app/src/MainFrame/Preferences/PreferencesStorage.js',
    ],
    noDelete: ['newEffectDialogDefaultTab'],
  },
  // Verbatim deltas: committed patches equal fresh output byte-for-byte.
  {
    patch: '09-prepare-ai-content.patch',
    files: ['newIDE/app/src/AiGeneration/PrepareAiUserContent.js'],
    verbatim: true,
  },
  {
    patch: '10-ai-chat-affordance.patch',
    files: ['newIDE/app/src/AiGeneration/AiRequestChat/Utils.js'],
    verbatim: true,
  },
  {
    patch: '11-studio-runtime-mount.patch',
    files: ['newIDE/app/src/AiGeneration/AskAiEditorContainer.js'],
    noDelete: ['attachmentIds'],
  },
];

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

describe('tier-2: glue patches are generated, not hand-edited', () => {
  let regenDir;
  before(() => {
    regenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tier2-regen-'));
    const r = run(
      'node',
      [
        'scripts/generate-tier2-patches.mjs',
        '--upstream',
        UPSTREAM,
        '--fork',
        FORK,
        '--out',
        regenDir,
      ],
      ROOT
    );
    assert.equal(r.status, 0, `generator failed:\n${r.stdout}\n${r.stderr}`);
  });
  after(() => fs.rmSync(regenDir, { recursive: true, force: true }));

  it('committed verbatim patches equal fresh output byte-for-byte', () => {
    for (const { patch, verbatim } of GLUE) {
      if (!verbatim) continue;
      const committed = fs.readFileSync(
        path.join(ROOT, 'patches', patch),
        'utf8'
      );
      const fresh = fs.readFileSync(path.join(regenDir, patch), 'utf8');
      assert.equal(fresh, committed, `${patch} was hand-edited or is stale`);
    }
  });

  it('curated forward-ports never delete upstream-new symbols', () => {
    for (const { patch, noDelete } of GLUE) {
      if (!noDelete) continue;
      const text = fs.readFileSync(path.join(ROOT, 'patches', patch), 'utf8');
      for (const symbol of noDelete) {
        // A minus-line touching the symbol would revert upstream-new code
        // (the R1–R3 regression class). Plus-lines mentioning it are fine.
        const re = new RegExp(`^-[^-].*${symbol}`, 'm');
        assert.ok(
          !re.test(text),
          `${patch} deletes upstream-new symbol: ${symbol} (see patches/REBASE.md)`
        );
      }
    }
  });

  it('glue dry-runs clean on pristine upstream copies', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tier2-dry-'));
    try {
      for (const { files } of GLUE) {
        for (const rel of files) {
          const src = path.join(UPSTREAM, rel);
          if (!fs.existsSync(src)) continue; // new-file hunks need no target
          const dest = path.join(target, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
      for (const { patch } of GLUE) {
        const r = run(
          'patch',
          ['-p1', '--dry-run', '-i', path.join(ROOT, 'patches', patch)],
          target
        );
        assert.equal(
          r.status,
          0,
          `${patch} does not apply to pristine upstream:\n${r.stdout}\n${r.stderr}`
        );
      }
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});
