// Tier-2 glue patch tests: every patch dry-runs clean on pristine
// upstream copies; curated forward-ports (07/08/11, see patches/REBASE.md)
// and additive deltas (09/10) are pinned by assertions on the committed
// patch text itself. Nothing here needs a donor checkout — this repo
// stands alone (fork-independence, 2026-10-11).
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
  // Purely additive deltas: committed patches must contain zero
  // minus-lines (any deletion would be an upstream revert by construction).
  {
    patch: '09-prepare-ai-content.patch',
    files: ['newIDE/app/src/AiGeneration/PrepareAiUserContent.js'],
    additive: true,
  },
  {
    patch: '10-ai-chat-affordance.patch',
    files: ['newIDE/app/src/AiGeneration/AiRequestChat/Utils.js'],
    additive: true,
  },
  {
    patch: '11-studio-runtime-mount.patch',
    files: ['newIDE/app/src/AiGeneration/AskAiEditorContainer.js'],
    noDelete: ['attachmentIds'],
  },
  {
    patch: '12-ai-request-utils.patch',
    files: ['newIDE/app/src/AiGeneration/AiRequestUtils.js'],
    includes: ['export const canStartAiRequestCreate', 'export const getUnselectedActiveRequests'],
  },
  {
    patch: '13-ai-request-context.patch',
    files: ['newIDE/app/src/AiGeneration/AiRequestContext.js'],
    includes: ['customUpdateAiRequest', 'LOCAL_BYOK_USER_ID', 'parentHasOutputForCall'],
  },
  {
    patch: '14-ai-utils.patch',
    files: ['newIDE/app/src/AiGeneration/Utils.js'],
    includes: ['enqueueRequestWrite', 'activateSubAgent: ('],
    noDelete: ['onSaveProjectAsWithStorageProvider'],
  },
];

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

describe('tier-2: glue patches apply cleanly and preserve upstream', () => {
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

  it('additive deltas contain zero deletions', () => {
    for (const { patch, additive } of GLUE) {
      if (!additive) continue;
      const text = fs.readFileSync(path.join(ROOT, 'patches', patch), 'utf8');
      const deletions = text.split('\n').filter(l => /^-[^-]/.test(l));
      assert.equal(
        deletions.length,
        0,
        `${patch} deletes lines (upstream revert by construction):\n${deletions.slice(0, 5).join('\n')}`
      );
    }
  });

  it('forward-ports carry their BYOK additions', () => {
    for (const { patch, includes } of GLUE) {
      if (!includes) continue;
      const text = fs.readFileSync(path.join(ROOT, 'patches', patch), 'utf8');
      for (const marker of includes) {
        assert.ok(
          text.includes(marker),
          `${patch} missing BYOK marker: ${marker}`
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
