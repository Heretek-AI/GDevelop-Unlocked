// Generates patches/*.patch (Tier-1 unlocks, Phase 2) from a stock upstream
// checkout by applying the exact Tier-1 replacements.
//
//   node scripts/generate-tier1-patches.mjs --upstream review/GDevelop
//
// Every replacement asserts a single match (loud on drift). Non-Tier-1 fork
// deltas are deliberately NOT reproduced (Usage quota type fields,
// LocalPreviewLauncher previewContext/sourceGameId, the FirebaseUser
// `type` import tweak) — verify with: diff the patched tree against the
// fork and confirm only those exclusions remain.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const requireCjs = createRequire(import.meta.url);
const payloads = requireCjs('../launcher/unlock-payloads.cjs');

/**
 * Serialize a plain-JS payload object to prettier-style source
 * (single quotes, 2-space indent, es5 trailing commas) — byte-identical
 * to the fork's UNLOCKED_* blocks, which were written in that style.
 */
function serializeJs(value, indent) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = ' '.repeat(indent);
    const inner = ' '.repeat(indent + 2);
    return `[\n${value.map(v => `${inner}${serializeJs(v, indent + 2)}`).join(',\n')},\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const pad = ' '.repeat(indent);
    const inner = ' '.repeat(indent + 2);
    return `{\n${keys.map(k => `${inner}${k}: ${serializeJs(value[k], indent + 2)}`).join(',\n')},\n${pad}}`;
  }
  if (typeof value === 'string')
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

function parseArgs(argv) {
  const out = { upstream: path.join(ROOT, 'review', 'GDevelop') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--upstream') out.upstream = path.resolve(argv[++i]);
    else if (argv[i] === '--out') out.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]} (expected --upstream <dir> or --out <dir>)`);
  }
  if (!out.out) out.out = path.join(ROOT, 'patches');
  return out;
}

function replaceOnce(text, oldStr, newStr, label) {
  const count = text.split(oldStr).length - 1;
  if (count !== 1) {
    throw new Error(
      `GENERATOR DRIFT [${label}]: expected 1 match, found ${count}. ` +
        `Upstream moved — update the replacement anchor.`
    );
  }
  return text.replace(oldStr, newStr);
}

const UNLOCKED_SUBSCRIPTION_BLOCK =
  'export const UNLOCKED_HERETEK_SUBSCRIPTION: Subscription = ' +
  serializeJs(payloads.UNLOCKED_SUBSCRIPTION, 0) +
  ';\n\n' +
  'export const UNLOCKED_HERETEK_CAPABILITIES: Capabilities = ' +
  serializeJs(payloads.UNLOCKED_CAPABILITIES, 0) +
  ';';

const LIMITS_SEED = `limits: {
    quotas: {},
    capabilities: UNLOCKED_HERETEK_CAPABILITIES,
    credits: {
      userBalance: { amount: 999999 },
      prices: {},
      purchasableQuantities: [],
    },
    message: undefined,
  },`;

// Each entry: files touched, and a transform(upstreamText) -> patchedText.
const PATCHES = [
  {
    name: '01-usage-predicate.patch',
    files: ['newIDE/app/src/Utils/GDevelopServices/Usage.js'],
    transform(text) {
      let out = replaceOnce(
        text,
        `  return !!subscription && subscription.pricingSystemId === 'TEAM_MEMBER';
};

export const hasValidSubscriptionPlan = (`,
        `  return !!subscription && subscription.pricingSystemId === 'TEAM_MEMBER';
};

${UNLOCKED_SUBSCRIPTION_BLOCK}

export const hasValidSubscriptionPlan = (`,
        '01/seed-insert'
      );
      out = replaceOnce(
        out,
        `export const hasValidSubscriptionPlan = (
  subscription: ?Subscription
): boolean => {
  const hasValidSubscription =
    !!subscription &&
    !!subscription.planId &&
    (!subscription.redemptionCodeValidUntil || // No redemption code
      subscription.redemptionCodeValidUntil > Date.now()); // Redemption code is still valid

  if (hasValidSubscription) {
    // The user has a subscription registered in the backend (classic "Registered" user).
    return true;
  }

  return false;
};`,
        `export const hasValidSubscriptionPlan = (
  subscription: ?Subscription
): boolean => {
  // In GDevelop-Heretek, all client-side and offline features are unlocked for all users.
  return true;
};`,
        '01/predicate-stub'
      );
      return out;
    },
  },
  {
    name: '02-auth-context-seed.patch',
    files: ['newIDE/app/src/Profile/AuthenticatedUserContext.js'],
    transform(text) {
      let out = replaceOnce(
        text,
        `  type UserEarningsBalance,
} from '../Utils/GDevelopServices/Usage';`,
        `  type UserEarningsBalance,
  UNLOCKED_HERETEK_SUBSCRIPTION,
  UNLOCKED_HERETEK_CAPABILITIES,
} from '../Utils/GDevelopServices/Usage';`,
        '02/import'
      );
      out = replaceOnce(
        out,
        `  subscription: null,
  subscriptionPricingSystem: null,
  usages: null,
  userEarningsBalance: null,
  limits: null,
  ...authenticatedUserPropertiesLoadingState,`,
        `  subscription: UNLOCKED_HERETEK_SUBSCRIPTION,
  subscriptionPricingSystem: null,
  usages: null,
  userEarningsBalance: null,
  ${LIMITS_SEED}
  ...authenticatedUserPropertiesLoadingState,`,
        '02/logged-in-seed'
      );
      out = replaceOnce(
        out,
        `  receivedBundles: ([]: Array<empty>), // Initialize to empty array to indicate that the loading is done.
  subscription: null,
  subscriptionPricingSystem: null,
  userEarningsBalance: null,
  usages: null,
  limits: null,
};`,
        `  receivedBundles: ([]: Array<empty>), // Initialize to empty array to indicate that the loading is done.
  subscription: UNLOCKED_HERETEK_SUBSCRIPTION,
  subscriptionPricingSystem: null,
  userEarningsBalance: null,
  usages: null,
  ${LIMITS_SEED}
};`,
        '02/logged-out-seed'
      );
      return out;
    },
  },
  {
    name: '03-subscription-checker.patch',
    files: ['newIDE/app/src/Profile/Subscription/SubscriptionChecker.js'],
    transform(text) {
      let out = replaceOnce(
        text,
        `// @flow

import * as React from 'react';
import { Trans } from '@lingui/macro';
import FlatButton from '../../UI/FlatButton';
import Dialog from '../../UI/Dialog';
import AuthenticatedUserContext from '../AuthenticatedUserContext';
import { Column } from '../../UI/Grid';
import {
  sendSubscriptionCheckDialogShown,
  sendSubscriptionCheckDismiss,
} from '../../Utils/Analytics/EventSender';
import Text from '../../UI/Text';
import { hasValidSubscriptionPlan } from '../../Utils/GDevelopServices/Usage';
import { isNativeMobileApp } from '../../Utils/Platform';
import InAppTutorialContext from '../../InAppTutorial/InAppTutorialContext';
import GetSubscriptionCard from './GetSubscriptionCard';`,
        `// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import FlatButton from '../../UI/FlatButton';
import Dialog from '../../UI/Dialog';
import { Column } from '../../UI/Grid';
import { sendSubscriptionCheckDismiss } from '../../Utils/Analytics/EventSender';
import Text from '../../UI/Text';
import GetSubscriptionCard from './GetSubscriptionCard';`,
        '03/imports'
      );
      out = replaceOnce(
        out,
        `}> = React.forwardRef<Props, SubscriptionCheckerInterface>(
  (
    {
      mode,
      id,
      title,
      onChangeSubscription,
      placementId,
      isNotShownDuringInAppTutorial,
    },
    ref
  ) => {
    const authenticatedUser = React.useContext(AuthenticatedUserContext);
    const [dialogOpen, setDialogOpen] = React.useState<boolean>(false);`,
        `}> = React.forwardRef<Props, SubscriptionCheckerInterface>(
  ({ mode, id, title, onChangeSubscription, placementId }, ref) => {
    const [dialogOpen, setDialogOpen] = React.useState<boolean>(false);`,
        '03/signature'
      );
      out = replaceOnce(
        out,
        `    const { currentlyRunningInAppTutorial } = React.useContext(
      InAppTutorialContext
    );

    const checkUserHasSubscription = () => {`,
        `    const checkUserHasSubscription = () => {`,
        '03/tutorial-context'
      );
      out = replaceOnce(
        out,
        `    const checkUserHasSubscription = () => {
      if (
        hasValidSubscriptionPlan(authenticatedUser.subscription) ||
        (isNotShownDuringInAppTutorial && currentlyRunningInAppTutorial)
      ) {
        setDialogOpen(false);
        return true;
      }

      if (isNativeMobileApp()) {
        // Would present App Store screen.
      } else {
        setDialogOpen(true);
        sendSubscriptionCheckDialogShown({ mode, id });
      }

      return false;
    };

    const hasUserSubscription = () => {
      return hasValidSubscriptionPlan(authenticatedUser.subscription);
    };`,
        `    const checkUserHasSubscription = () => {
      setDialogOpen(false);
      return true;
    };

    const hasUserSubscription = () => {
      return true;
    };`,
        '03/closures'
      );
      return out;
    },
  },
  {
    name: '04-loading-screen.patch',
    files: ['newIDE/app/src/ProjectManager/LoadingScreenEditor.js'],
    transform(text) {
      let out = replaceOnce(
        text,
        `                  onCheck={(e, checked) => {
                    if (
                      !checked &&
                      !watermark.isGDevelopWatermarkShown() &&
                      subscriptionChecker.current &&
                      !subscriptionChecker.current.checkUserHasSubscription()
                    ) {
                      // If user wants to deactivate GDevelop splash screen although
                      // watermark is hidden, we don't allow it if they have no subscription.
                      return;
                    }
                    loadingScreen.showGDevelopLogoDuringLoadingScreen(checked);`,
        `                  onCheck={(e, checked) => {
                    loadingScreen.showGDevelopLogoDuringLoadingScreen(checked);`,
        '04/logo-guard'
      );
      // Watermark guard + forced-duration clamp: remove everything from the
      // guard `if` through the clamp, keeping only the show + onUpdate lines.
      const guardStartMarker = `                    if (
                      !checked &&
                      !loadingScreen.isGDevelopLogoShownDuringLoadingScreen() &&`;
      const showLine = `                    watermark.showGDevelopWatermark(checked);`;
      const clampTail = `
                    onUpdate();`;
      const guardStartIdx = out.indexOf(guardStartMarker);
      if (guardStartIdx === -1)
        throw new Error('GENERATOR DRIFT [04/watermark-guard]: no match.');
      if (out.indexOf(guardStartMarker, guardStartIdx + 1) !== -1)
        throw new Error(
          'GENERATOR DRIFT [04/watermark-guard]: anchor not unique.'
        );
      const tailIdx = out.indexOf(clampTail, guardStartIdx);
      if (tailIdx === -1)
        throw new Error('GENERATOR DRIFT [04/watermark-tail]: no match.');
      const removed = out.slice(guardStartIdx, tailIdx);
      for (const marker of [
        'checkUserHasSubscription()',
        'if (checked) {',
        'forcedLogo.minDuration',
        'setMinDuration(forcedLogo.minDuration)',
        'hasUserSubscription()',
        'watermark.showGDevelopWatermark(checked);',
      ]) {
        if (!removed.includes(marker))
          throw new Error(
            `GENERATOR DRIFT [04/clamp-span]: missing ${JSON.stringify(marker)}.`
          );
      }
      out = out.slice(0, guardStartIdx) + showLine + out.slice(tailIdx);
      return out;
    },
  },
  {
    name: '05-preview-debugger.patch',
    files: [
      'newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js',
      'newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js',
    ],
    transform(text, relPath) {
      if (relPath.endsWith('LocalPreviewLauncher/index.js')) {
        let out = replaceOnce(
          text,
          `      if (!previewOptions.isForInGameEdition) {
        if (
          this.state.hotReloadsCount % 16 === 0 &&
          this._hotReloadSubscriptionChecker
        ) {
          this._hotReloadSubscriptionChecker.checkUserHasSubscription();
        }
        this.setState(state => ({`,
          `      if (!previewOptions.isForInGameEdition) {
        this.setState(state => ({`,
          '05/hot-reload-gate'
        );
        out = replaceOnce(
          out,
          `  _checkSubscriptionForNetworkPreview = (): any => {
    if (!this._networkPreviewSubscriptionChecker) return true;

    return this._networkPreviewSubscriptionChecker.checkUserHasSubscription();
  };`,
          `  _checkSubscriptionForNetworkPreview = (): any => {
    return true;
  };`,
          '05/network-stub'
        );
        return out;
      }
      return replaceOnce(
        text,
        `  _checkUserHasSubscription() {
    if (
      this._subscriptionChecker &&
      this.props.isActive &&
      !this.state.subscriptionChecked
    ) {
      this._subscriptionChecker.checkUserHasSubscription();
      this.setState({
        subscriptionChecked: true,
      });
    }
  }`,
        `  _checkUserHasSubscription() {
    // Unlocked in GDevelop-Heretek
  }`,
        '05/debugger-stub'
      );
    },
  },
  {
    name: '06-electron-hook.patch',
    files: ['newIDE/electron-app/app/main.js'],
    transform(text) {
      // The loader MUST precede the `electron.BrowserWindow` destructure
      // (main.js:6): the hook wraps the export before any module captures
      // the original reference (main.js:226, PreviewWindow.js:52).
      return replaceOnce(
        text,
        `const electron = require('electron');
const path = require('path');`,
        `// GDevelop-Unlocked (Phase 3, issue #3): install the Tier-1 runtime hook
// before any module destructures \`electron.BrowserWindow\` (main.js:6,
// PreviewWindow.js:1-6). Re-applied by scripts/apply-patches.mjs, which
// also syncs launcher/*.cjs next to this file. Updates drop the hook:
// see launcher/README.md ("auto-updater pin").
try {
  require('./heretek-hook.cjs').installPreloadHook();
} catch (error) {
  console.error(
    '[heretek] hook install failed (Tier-1 runtime fallback only):',
    error
  );
}
const electron = require('electron');
const path = require('path');`,
        '06/loader'
      );
    },
  },
];

const args = parseArgs(process.argv.slice(2));
const outDir = args.out;
fs.mkdirSync(outDir, { recursive: true });
// Private scratch dir: os.tmpdir() honors TMPDIR/TMP/TEMP, and mkdtemp
// makes it unpredictable + owner-only (no shared-tmp filename races).
const scratchBase = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-tier1-'));
process.on('exit', () =>
  fs.rmSync(scratchBase, { recursive: true, force: true })
);

for (const patch of PATCHES) {
  let combined = '';
  for (const rel of patch.files) {
    const abs = path.join(args.upstream, rel);
    if (!fs.existsSync(abs))
      throw new Error(`Upstream file missing: ${abs}`);
    const upstreamText = fs.readFileSync(abs, 'utf8');
    const patchedText = patch.transform(upstreamText, rel);
    if (patchedText === upstreamText)
      throw new Error(`Patch ${patch.name} changed nothing in ${rel}.`);
    const tmpOld = path.join(scratchBase, `gen-old-${Date.now()}.txt`);
    const tmpNew = path.join(scratchBase, `gen-new-${Date.now()}.txt`);
    fs.writeFileSync(tmpOld, upstreamText);
    fs.writeFileSync(tmpNew, patchedText);
    const r = spawnSync(
      'diff',
      ['-U3', `--label=a/${rel}`, `--label=b/${rel}`, tmpOld, tmpNew],
      { encoding: 'utf8' }
    );
    fs.unlinkSync(tmpOld);
    fs.unlinkSync(tmpNew);
    if (r.status !== 1 || !r.stdout)
      throw new Error(
        `diff failed for ${rel} (status ${r.status}): ${r.stderr}`
      );
    combined += r.stdout;
    // Round-trip check: the hunk must apply cleanly to a pristine copy.
    const checkDir = path.join(scratchBase, `gen-rt-${Date.now()}`);
    const checkFile = path.join(checkDir, rel);
    fs.mkdirSync(path.dirname(checkFile), { recursive: true });
    fs.writeFileSync(checkFile, upstreamText);
    const tmpPatch = path.join(scratchBase, `gen-rt-${Date.now()}.patch`);
    fs.writeFileSync(tmpPatch, r.stdout);
    const dry = spawnSync('patch', ['-p1', '--dry-run', '-i', tmpPatch], {
      cwd: checkDir,
      encoding: 'utf8',
    });
    fs.rmSync(checkDir, { recursive: true, force: true });
    fs.unlinkSync(tmpPatch);
    if (dry.status !== 0)
      throw new Error(
        `Round-trip FAILED for ${patch.name} :: ${rel}:\n${dry.stdout}\n${dry.stderr}`
      );
  }
  fs.writeFileSync(path.join(outDir, patch.name), combined);
  console.log(
    `wrote ${patch.name} (${patch.files.length} file(s), round-trip clean)`
  );
}
console.log('done.');
