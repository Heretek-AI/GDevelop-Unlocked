// Phase 2 driver (issue #2): stock upstream tree -> apply `patches/*.patch`.
//
//   node scripts/apply-patches.mjs --check
//     Seam gate only (Phase 1 suite). No filesystem changes.
//
//   node scripts/apply-patches.mjs --target <upstream-checkout-or-extracted-asar>
//     Extract-free mode: `patch -p1 --dry-run` every hunk first (loud abort
//     with the failing hunk on drift), then apply, then verify unlock
//     markers. Re-running against an already-patched target FAILS
//     (patches are not idempotent by design — a green second run would
//     mean the hunks never matched).
//
//   node scripts/apply-patches.mjs --verify-only --target <patched-tree>
//     Read-only post-apply contract check (MARKERS + byte-equal launcher
//     and Tier-2 overlay) on an already-patched tree. No seam run, no
//     filesystem changes. Exit 1 lists every missing marker/leftover gate.
//
//   node scripts/apply-patches.mjs --asar app.asar --out app.patched.asar
//     Only for an asar that holds SOURCE (newIDE/ at top level). A
//     release asar holds bundled/minified JS, so the source-level hunks
//     in patches/ will NOT match — the driver says so loudly instead of
//     pretending. For release artifacts use the launcher-only path:
//     scripts/inject-launcher.mjs --appdir (see launcher/README.md).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PATCHES_DIR = path.join(ROOT, 'patches');
const LAUNCHER_DIR = path.join(ROOT, 'launcher');
const AI_STUDIO_DIR = path.join(ROOT, 'packages', 'ai-studio');
const LAUNCHER_FILES = [
  'heretek-hook.cjs',
  'preload-unlock.cjs',
  'unlock-payloads.cjs',
  'debug-logger.cjs',
];
// Tier-2 runtime the glue patches import: Generation.js (07) and
// PrepareAiUserContent.js (09) import ../../AI/CustomAIClient;
// AskAiEditorContainer.js (11) imports ./Studio/* hooks. Upstream has no
// newIDE/app/src/AI/ directory at all, so without this overlay every
// Tier-2 import dangles (previously nothing installed Tier-2).
// Spec files (*.spec.js) are deliberately NOT shipped into the target.
const TIER2_FILES = [
  'AI/CustomAIClient.js',
  'AiGeneration/Studio/DebugEvents.js',
  'AiGeneration/Studio/EditApprovalLabel.js',
  'AiGeneration/Studio/FinalizeSubAgents.js',
  'AiGeneration/Studio/LoopGuard.js',
  'AiGeneration/Studio/NudgePolicy.js',
  'AiGeneration/Studio/PlanStore.js',
  'AiGeneration/Studio/RequestWriteGate.js',
  'AiGeneration/Studio/Roles.js',
  'AiGeneration/Studio/RoleToolPolicy.js',
  'AiGeneration/Studio/SafeTruncation.js',
  'AiGeneration/Studio/SpawnSubAgents.js',
  'AiGeneration/Studio/UseStudioNudge.js',
  'AiGeneration/Studio/UseStudioRuntime.js',
];

// Post-apply contract: what a correctly patched tree must (and must not)
// contain. `excludes` are chosen to avoid fork-kept residuals (e.g.
// LoadingScreenEditor still references `subscriptionChecker` for other
// paywalled settings; preview/debugger still assign checker refs).
const MARKERS = [
  {
    patch: '01-usage-predicate.patch',
    file: 'newIDE/app/src/Utils/GDevelopServices/Usage.js',
    includes: [
      'export const UNLOCKED_HERETEK_SUBSCRIPTION: Subscription',
      "planId: 'gdevelop_startup'",
      'export const UNLOCKED_HERETEK_CAPABILITIES: Capabilities',
      '// In GDevelop-Heretek, all client-side and offline features are unlocked for all users.\n  return true;',
    ],
    excludes: ['redemptionCodeValidUntil > Date.now()'],
  },
  {
    patch: '02-auth-context-seed.patch',
    file: 'newIDE/app/src/Profile/AuthenticatedUserContext.js',
    includes: [
      'UNLOCKED_HERETEK_SUBSCRIPTION,\n  UNLOCKED_HERETEK_CAPABILITIES,',
      'subscription: UNLOCKED_HERETEK_SUBSCRIPTION,',
      'capabilities: UNLOCKED_HERETEK_CAPABILITIES,',
    ],
    excludes: ['subscription: null,', 'limits: null,'],
  },
  {
    patch: '03-subscription-checker.patch',
    file: 'newIDE/app/src/Profile/Subscription/SubscriptionChecker.js',
    includes: [
      'const checkUserHasSubscription = () => {\n      setDialogOpen(false);\n      return true;',
      'const hasUserSubscription = () => {\n      return true;',
    ],
    excludes: [
      'hasValidSubscriptionPlan',
      'AuthenticatedUserContext',
      'isNativeMobileApp',
      'sendSubscriptionCheckDialogShown',
      'setDialogOpen(true)',
    ],
  },
  {
    patch: '04-loading-screen.patch',
    file: 'newIDE/app/src/ProjectManager/LoadingScreenEditor.js',
    includes: [
      'loadingScreen.showGDevelopLogoDuringLoadingScreen(checked);\n                    onUpdate();',
      'watermark.showGDevelopWatermark(checked);\n                    onUpdate();',
    ],
    excludes: [
      // NOTE: the duration-slider gate (~:387, `newMinDuration <
      // forcedLogo.minDuration`) is fork-kept behavior, out of scope —
      // only the watermark-disable write-back is stubbed.
      'setMinDuration(forcedLogo.minDuration)',
      '// If user wants to deactivate GDevelop splash screen although',
      '// If user wants to deactivate watermark although GDevelop splash',
    ],
  },
  {
    patch: '05-preview-debugger.patch',
    file:
      'newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js',
    includes: [
      '  _checkSubscriptionForNetworkPreview = (): any => {\n    return true;',
    ],
    excludes: [
      'hotReloadsCount % 16',
      'this._hotReloadSubscriptionChecker.checkUserHasSubscription()',
      'this._networkPreviewSubscriptionChecker.checkUserHasSubscription()',
    ],
  },
  {
    patch: '05-preview-debugger.patch',
    file: 'newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js',
    includes: ['// Unlocked in GDevelop-Heretek'],
    excludes: ['this._subscriptionChecker.checkUserHasSubscription()'],
  },
  {
    patch: '06-electron-hook.patch',
    file: 'newIDE/electron-app/app/main.js',
    includes: [
      "require('./heretek-hook.cjs').installPreloadHook();",
      'const newWindow = new BrowserWindow(options);',
    ],
    excludes: [],
  },
  {
    patch: '07-generation-glue.patch',
    file: 'newIDE/app/src/Utils/GDevelopServices/Generation.js',
    includes: [
      'isCustomEndpointEnabled',
      "startsWith('local-ai-')",
      'customCreateAiRequest',
      // BYOK attachment guard (not part of the fork delta — added here).
      'Attachments are not available while a custom AI endpoint is enabled',
    ],
    excludes: [],
  },
  {
    patch: '08-preferences-ai.patch',
    file: 'newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js',
    includes: ["'preferences' | 'ai' | 'shortcuts'"],
    excludes: [],
  },
  {
    patch: '08-preferences-ai.patch',
    file: 'newIDE/app/src/MainFrame/Preferences/PreferencesStorage.js',
    includes: ['getPersistablePreferences', 'aiCustomApiKey'],
    excludes: [],
  },
  {
    patch: '09-prepare-ai-content.patch',
    file: 'newIDE/app/src/AiGeneration/PrepareAiUserContent.js',
    includes: [
      "import { isCustomEndpointEnabled } from '../AI/CustomAIClient';",
      "if (isCustomEndpointEnabled() || (userId && userId.startsWith('local-')))",
    ],
    excludes: [],
  },
  {
    patch: '10-ai-chat-affordance.patch',
    file: 'newIDE/app/src/AiGeneration/AiRequestChat/Utils.js',
    includes: [
      'export const getAvailableCredits',
      'export const canAffordAiRequest',
    ],
    excludes: [],
  },
  {
    patch: '11-studio-runtime-mount.patch',
    file: 'newIDE/app/src/AiGeneration/AskAiEditorContainer.js',
    includes: [
      "import { useStudioRuntime } from './Studio/UseStudioRuntime';",
      "import { useStudioNudge } from './Studio/UseStudioNudge';",
      'canAffordAiRequest',
    ],
    excludes: [],
  },
  {
    patch: '12-ai-request-utils.patch',
    file: 'newIDE/app/src/AiGeneration/AiRequestUtils.js',
    includes: [
      'export const canStartAiRequestCreate',
      'export const canSendAiRequestForSession',
      'export const isFailedAiRequestStart',
      'export const getUnselectedActiveRequests',
      'export const shouldFetchAiRequestOnTabOpen',
    ],
    excludes: [],
  },
  {
    patch: '13-ai-request-context.patch',
    file: 'newIDE/app/src/AiGeneration/AiRequestContext.js',
    includes: [
      'customUpdateAiRequest',
      'LOCAL_BYOK_USER_ID',
      'parentHasOutputForCall',
    ],
    excludes: [],
  },
  {
    patch: '14-ai-utils.patch',
    file: 'newIDE/app/src/AiGeneration/Utils.js',
    includes: [
      'enqueueRequestWrite',
      'activateSubAgent: (',
    ],
    excludes: [],
  },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--target') out.target = path.resolve(argv[++i]);
    else if (a === '--asar') out.asar = path.resolve(argv[++i]);
    else if (a === '--out') out.out = path.resolve(argv[++i]);
    else if (a === '--no-verify') out.noVerify = true;
    else if (a === '--verify-only') out.verifyOnly = true;
  }
  return out;
}

function runSeamTests() {
  console.log('[apply-patches] running Phase 1 seam suite...');
  // The node:test child-process detector (NODE_TEST_CONTEXT) would make a
  // `node --test` spawned from inside a test run silently skip. Strip it
  // so the gate really runs even when the driver is invoked by the suite.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')
  );
  const r = spawnSync('node', ['--test', 'tests/seams/*.test.mjs'], {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env,
  });
  if (r.status !== 0) {
    console.error(
      '[apply-patches] SEAM SUITE RED — upstream drifted. See file:line ' +
        'pointers above; regenerate patches/ before repacking.'
    );
    process.exit(r.status ?? 1);
  }
  console.log('[apply-patches] seam suite green.');
}

function listPatches() {
  if (!fs.existsSync(PATCHES_DIR)) return [];
  return fs
    .readdirSync(PATCHES_DIR)
    .filter(f => f.endsWith('.patch'))
    .sort()
    .map(f => path.join(PATCHES_DIR, f));
}

function runPatch(cwd, patchFile, dryRun) {
  const args = ['-p1', dryRun ? '--dry-run' : '-s', '-i', patchFile];
  return spawnSync('patch', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function applyToTarget(target) {
  const patches = listPatches();
  if (patches.length === 0) {
    console.error('[apply-patches] no patches/*.patch found. Nothing to do.');
    process.exit(2);
  }
  if (!fs.existsSync(path.join(target, 'newIDE'))) {
    console.error(
      `[apply-patches] target ${target} has no newIDE/ — pass an upstream ` +
        'checkout root (or extracted asar with newIDE/ at top level).'
    );
    process.exit(2);
  }
  // Gate 1: every hunk dry-runs clean before anything is touched.
  for (const p of patches) {
    const r = runPatch(target, p, true);
    if (r.status !== 0) {
      console.error(
        `[apply-patches] DRY-RUN FAILED: ${path.basename(p)}\n` +
          `${r.stdout}${r.stderr}\n` +
          'Upstream drifted under this hunk. Regenerate with ' +
          'node scripts/generate-tier1-patches.mjs --upstream <checkout>.'
      );
      process.exit(1);
    }
    console.log(`[apply-patches] dry-run clean: ${path.basename(p)}`);
  }
  for (const p of patches) {
    const r = runPatch(target, p, false);
    if (r.status !== 0) {
      console.error(
        `[apply-patches] APPLY FAILED: ${path.basename(p)}\n` +
          `${r.stdout}${r.stderr}`
      );
      process.exit(1);
    }
    console.log(`[apply-patches] applied: ${path.basename(p)}`);
  }
}

/**
 * Copy launcher/*.cjs next to the patched main.js (patch 06 requires
 * ./heretek-hook.cjs relative to electron-app/app/). Runs after every
 * successful apply so the loader line can never dangle.
 */
function syncLauncherFiles(target) {
  const destDir = path.join(target, 'newIDE/electron-app/app');
  if (!fs.existsSync(destDir)) {
    console.error(
      `[apply-patches] cannot sync launcher files: ${destDir} missing.`
    );
    process.exit(2);
  }
  for (const file of LAUNCHER_FILES) {
    const src = path.join(LAUNCHER_DIR, file);
    if (!fs.existsSync(src)) {
      console.error(`[apply-patches] launcher file missing: ${src}`);
      process.exit(2);
    }
    fs.copyFileSync(src, path.join(destDir, file));
    console.log(`[apply-patches] synced launcher/${file}`);
  }
}

/**
 * Copy Tier-2 runtime (packages/ai-studio/) into the patched tree at the
 * exact paths the glue patches import (newIDE/app/src/AI/*,
 * newIDE/app/src/AiGeneration/Studio/*). Runs after every successful
 * apply so `../AI/CustomAIClient` / `./Studio/*` imports can never dangle.
 */
function syncTier2Files(target) {
  for (const rel of TIER2_FILES) {
    const src = path.join(AI_STUDIO_DIR, rel);
    if (!fs.existsSync(src)) {
      console.error(`[apply-patches] Tier-2 file missing: ${src}`);
      process.exit(2);
    }
    const dest = path.join(target, 'newIDE/app/src', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`[apply-patches] synced ai-studio/${rel}`);
  }
}

function verifyTarget(target) {
  let failed = 0;
  for (const rel of TIER2_FILES) {
    const abs = path.join(target, 'newIDE/app/src', rel);
    if (!fs.existsSync(abs)) {
      console.error(`[verify] MISSING Tier-2 runtime file: newIDE/app/src/${rel}`);
      failed++;
      continue;
    }
    const src = fs.readFileSync(path.join(AI_STUDIO_DIR, rel), 'utf8');
    if (fs.readFileSync(abs, 'utf8') !== src) {
      console.error(`[verify] STALE Tier-2 runtime file: newIDE/app/src/${rel}`);
      failed++;
    }
  }
  for (const file of LAUNCHER_FILES) {
    const abs = path.join(target, 'newIDE/electron-app/app', file);
    if (!fs.existsSync(abs)) {
      console.error(`[verify] MISSING launcher file: electron-app/app/${file}`);
      failed++;
      continue;
    }
    const src = fs.readFileSync(path.join(LAUNCHER_DIR, file), 'utf8');
    if (fs.readFileSync(abs, 'utf8') !== src) {
      console.error(`[verify] STALE launcher file: electron-app/app/${file}`);
      failed++;
    }
  }
  for (const m of MARKERS) {
    const abs = path.join(target, m.file);
    if (!fs.existsSync(abs)) {
      console.error(`[verify] MISSING file: ${m.file} (${m.patch})`);
      failed++;
      continue;
    }
    const text = fs.readFileSync(abs, 'utf8');
    for (const inc of m.includes) {
      if (!text.includes(inc)) {
        console.error(
          `[verify] MISSING marker in ${m.file} (${m.patch}):\n${inc}`
        );
        failed++;
      }
    }
    for (const exc of m.excludes) {
      if (text.includes(exc)) {
        console.error(
          `[verify] LEFTOVER gate in ${m.file} (${m.patch}):\n${exc}`
        );
        failed++;
      }
    }
  }
  if (failed > 0) {
    console.error(`[verify] ${failed} marker check(s) failed.`);
    process.exit(1);
  }
  console.log(
    '[verify] all unlock markers present (Tier-1 + Tier-2), launcher + ' +
      'Tier-2 overlay byte-equal, gates gone.'
  );
}

function extractAsar(asar, dest) {
  const r = spawnSync(
    'npx',
    ['--yes', '@electron/asar', 'extract', asar, dest],
    { stdio: 'inherit' }
  );
  if (r.status !== 0) {
    console.error(
      '[apply-patches] asar extraction failed. Install it with ' +
        '`npm i -g @electron/asar` (npm only, per repo policy) and retry.'
    );
    process.exit(1);
  }
}

function packAsar(src, out) {
  const r = spawnSync('npx', ['--yes', '@electron/asar', 'pack', src, out], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error('[apply-patches] asar repack failed.');
    process.exit(1);
  }
}

const args = parseArgs(process.argv.slice(2));

if (args.check && !args.target && !args.asar) {
  runSeamTests();
  process.exit(0);
}

if (args.verifyOnly) {
  if (!args.target) {
    console.error(
      'Usage: node scripts/apply-patches.mjs --verify-only --target <patched-tree>'
    );
    process.exit(2);
  }
  verifyTarget(args.target);
  process.exit(0);
}

runSeamTests();

if (args.asar) {
  if (!args.out) {
    console.error(
      'Usage: node scripts/apply-patches.mjs --asar <app.asar> --out <patched.asar>'
    );
    process.exit(2);
  }
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdevelop-unlock-'));
  try {
    console.log(`[apply-patches] extracting ${args.asar} ...`);
    extractAsar(args.asar, workdir);
    console.log(
      '[apply-patches] NOTE: release asars hold bundled/minified JS; ' +
        'source-level hunks cannot match there. For a release artifact ' +
        'use scripts/inject-launcher.mjs --appdir (launcher/README.md).'
    );
    applyToTarget(workdir);
    syncLauncherFiles(workdir);
    syncTier2Files(workdir);
    if (!args.noVerify) verifyTarget(workdir);
    // Auto-updater pin (issue #3 pre-note): never ship a repacked asar
    // without recording which upstream version it came from.
    packAsar(workdir, args.out);
    console.log(`[apply-patches] repacked: ${args.out}`);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
  process.exit(0);
}

if (args.target) {
  applyToTarget(args.target);
  syncLauncherFiles(args.target);
  syncTier2Files(args.target);
  if (!args.noVerify) verifyTarget(args.target);
  process.exit(0);
}

console.error(
  'Usage:\n' +
    '  node scripts/apply-patches.mjs --check\n' +
    '  node scripts/apply-patches.mjs --target <upstream-checkout>\n' +
    '  node scripts/apply-patches.mjs --verify-only --target <patched-tree>\n' +
    '  node scripts/apply-patches.mjs --asar <app.asar> --out <patched.asar>'
);
process.exit(2);
