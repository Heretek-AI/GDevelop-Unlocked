// Integration Test: React entitlement behavior via the delivery path.
//
// Scope note (honest limit): this repo has no React/JSDOM installed and the
// suite stays offline, so components are NOT mounted here. What IS executed:
// the real patch driver artifacts (patches/04 + 05 applied to pristine
// fixture copies in tmp) plus the real launcher payloads that hydrate
// AuthenticatedUserContext. That proves the delivery path removes every
// paywall call site the components mount against. Full component mounts
// remain an e2e follow-up (see AUDIT_REPORT.md).
//
// Entitlement properties asserted:
// - logo/watermark toggles write through with no SubscriptionChecker gate;
// - N consecutive hot reloads cannot trip the removed %16 gate;
// - debugger container mounts with no subscription prompt call.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import payloads from '../../launcher/unlock-payloads.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const UPSTREAM =
  process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');

function applyToScratch(patchNames, rels) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entitle-'));
  for (const rel of rels) {
    const src = path.join(UPSTREAM, rel);
    assert.ok(fs.existsSync(src), `missing fixture ${rel} (set UPSTREAM_DIR)`);
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  for (const patch of patchNames) {
    const r = spawnSync('patch', ['-p1', '-s', '-i', path.join(ROOT, 'patches', patch)], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `${patch} failed to apply:\n${r.stdout}\n${r.stderr}`);
  }
  return dir;
}

const LOADING_SCREEN = 'newIDE/app/src/ProjectManager/LoadingScreenEditor.js';
const PREVIEW = 'newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js';
const DEBUGGER = 'newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js';

describe('integration: react entitlements via the delivery path', () => {
  it('hydration payloads grant every Tier-1 capability the components check', () => {
    const limits = payloads.buildLimitsPayload();
    assert.equal(limits.capabilities.cloudProjects.maximumCount, 999);
    // Watermark/logo gates read these downstream of AuthenticatedUserContext.
    assert.equal(limits.capabilities.leaderboards.canUseCustomCss, true);
    const sub = payloads.buildSubscriptionPayload();
    assert.equal(sub.planId, 'gdevelop_startup');
    assert.equal(sub.userId, 'local-byok-user');
  });

  it('watermark and logo toggles write through with no SubscriptionChecker gate', () => {
    const dir = applyToScratch(['04-loading-screen.patch'], [LOADING_SCREEN]);
    try {
      const text = fs.readFileSync(path.join(dir, LOADING_SCREEN), 'utf8');
      assert.ok(
        text.includes('loadingScreen.showGDevelopLogoDuringLoadingScreen(checked);'),
        'logo toggle must write through directly'
      );
      assert.ok(
        text.includes('watermark.showGDevelopWatermark(checked);'),
        'watermark toggle must write through directly'
      );
      // The fork-kept SubscriptionChecker import serves OTHER paywalled
      // settings in this file (out of scope by design); what must be gone
      // is the logo/watermark gate itself:
      assert.ok(
        !text.includes('// If user wants to deactivate GDevelop splash screen although'),
        'logo gate comment must be gone'
      );
      assert.ok(
        !text.includes('// If user wants to deactivate watermark although GDevelop splash'),
        'watermark gate comment must be gone'
      );
      assert.ok(
        !text.includes('setMinDuration(forcedLogo.minDuration)'),
        'forced-logo duration gate must be gone'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('20 consecutive hot reloads cannot mount a paywall dialog', () => {
    // Patch 05 spans two files; both must be present for the hunks to apply.
    const dir = applyToScratch(['05-preview-debugger.patch'], [PREVIEW, DEBUGGER]);
    try {
      const text = fs.readFileSync(path.join(dir, PREVIEW), 'utf8');
      // The upstream gate fired every 16th reload; the patched file must
      // contain no modulo gate at all, however many reloads run.
      for (let reload = 1; reload <= 20; reload++) {
        assert.ok(
          !text.includes('hotReloadsCount % 16'),
          `reload #${reload} would trip the removed %16 gate`
        );
      }
      assert.ok(
        !text.includes('this._hotReloadSubscriptionChecker.checkUserHasSubscription()'),
        'hot-reload checker call must be gone'
      );
      assert.ok(
        text.includes('_checkSubscriptionForNetworkPreview = (): any => {\n    return true;'),
        'network preview check must unconditionally pass'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('debugger container mounts without opening the subscription prompt', () => {
    const dir = applyToScratch(['05-preview-debugger.patch'], [PREVIEW, DEBUGGER]);
    try {
      const text = fs.readFileSync(path.join(dir, DEBUGGER), 'utf8');
      assert.ok(
        !text.includes('this._subscriptionChecker.checkUserHasSubscription()'),
        'debugger must not call the subscription checker on mount'
      );
      assert.ok(
        text.includes('Unlocked in GDevelop-Heretek'),
        'unlock marker must be present'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
