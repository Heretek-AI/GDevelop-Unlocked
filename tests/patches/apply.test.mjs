// Phase 2 tests: the Tier-1 patcher applies cleanly to a pristine
// upstream tree, produces the unlock markers, and refuses a second run
// (non-idempotent by design — a green re-apply would mean the hunks
// never matched in the first place).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const UPSTREAM = process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');

const TIER1_FILES = [
  'newIDE/app/src/Utils/GDevelopServices/Usage.js',
  'newIDE/app/src/Profile/AuthenticatedUserContext.js',
  'newIDE/app/src/Profile/Subscription/SubscriptionChecker.js',
  'newIDE/app/src/ProjectManager/LoadingScreenEditor.js',
  'newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js',
  'newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js',
  // Patch 06 (loader line) needs its anchor file too.
  'newIDE/electron-app/app/main.js',
  // Tier-2 glue targets (07/08; the fork-only Storage.js needs no target).
  'newIDE/app/src/Utils/GDevelopServices/Generation.js',
  'newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js',
  'newIDE/app/src/MainFrame/Preferences/PreferencesContext.js',
  'newIDE/app/src/MainFrame/Preferences/PreferencesProvider.js',
  // Tier-2 remediation targets (09/10/11).
  'newIDE/app/src/AiGeneration/PrepareAiUserContent.js',
  'newIDE/app/src/AiGeneration/AiRequestChat/Utils.js',
  'newIDE/app/src/AiGeneration/AskAiEditorContainer.js',
  // Tier-2 session/context glue (12/13).
  'newIDE/app/src/AiGeneration/AiRequestUtils.js',
  'newIDE/app/src/AiGeneration/AiRequestContext.js',
  // Tier-2 process-function-calls glue (14).
  'newIDE/app/src/AiGeneration/Utils.js',
];

describe('patcher: Tier-1 hunks apply to pristine upstream', () => {
  let target;
  before(() => {
    target = fs.mkdtempSync(path.join(os.tmpdir(), 'tier1-patch-test-'));
    for (const rel of TIER1_FILES) {
      const src = path.join(UPSTREAM, rel);
      assert.ok(fs.existsSync(src), `upstream file missing: ${rel}`);
      const dest = path.join(target, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  });
  after(() => fs.rmSync(target, { recursive: true, force: true }));

  it('dry-run is clean on the pristine tree', () => {
    const r = spawnSync(
      'node',
      ['scripts/apply-patches.mjs', '--target', target, '--no-verify'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    assert.equal(
      r.status,
      0,
      `patcher failed on pristine tree:\n${r.stdout}\n${r.stderr}`
    );
  });

  it('patched tree carries the unlock markers and no gates', () => {
    const read = rel => fs.readFileSync(path.join(target, rel), 'utf8');
    const usage = read(TIER1_FILES[0]);
    assert.ok(usage.includes("planId: 'gdevelop_startup'"));
    assert.ok(
      usage.includes(
        '// In GDevelop-Heretek, all client-side and offline features are unlocked for all users.\n  return true;'
      )
    );
    assert.ok(!usage.includes('redemptionCodeValidUntil > Date.now()'));

    const auth = read(TIER1_FILES[1]);
    assert.ok(auth.includes('subscription: UNLOCKED_HERETEK_SUBSCRIPTION,'));
    assert.ok(!auth.includes('subscription: null,'));

    const checker = read(TIER1_FILES[2]);
    assert.ok(
      checker.includes(
        'const hasUserSubscription = () => {\n      return true;'
      )
    );
    assert.ok(!checker.includes('hasValidSubscriptionPlan'));

    const loading = read(TIER1_FILES[3]);
    assert.ok(
      loading.includes(
        'watermark.showGDevelopWatermark(checked);\n                    onUpdate();'
      )
    );
    assert.ok(!loading.includes('setMinDuration(forcedLogo.minDuration)'));

    const preview = read(TIER1_FILES[4]);
    assert.ok(
      preview.includes(
        '  _checkSubscriptionForNetworkPreview = (): any => {\n    return true;'
      )
    );
    assert.ok(!preview.includes('hotReloadsCount % 16'));

    const dbg = read(TIER1_FILES[5]);
    assert.ok(dbg.includes('// Unlocked in GDevelop-Heretek'));
    assert.ok(
      !dbg.includes('this._subscriptionChecker.checkUserHasSubscription()')
    );
  });

  it('second apply fails (hunks already consumed)', () => {
    const r = spawnSync(
      'node',
      ['scripts/apply-patches.mjs', '--target', target, '--no-verify'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }
    );
    assert.notEqual(
      r.status,
      0,
      're-apply succeeded — hunks may not be matching (silent no-op risk)'
    );
  });
});
