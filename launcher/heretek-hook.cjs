// Phase 3 main-process hook (issue #3): preload injection for every
// window + webRequest spoof fallback + auto-updater pin.
//
// Installed by a 9-line loader at the TOP of electron-app/app/main.js
// (patches/06-electron-hook.patch) — before line 6 destructures
// `electron.BrowserWindow`, so the wrapped constructor below is the one
// main.js:226 and PreviewWindow.js:52 actually call. Loaded later, the
// wrap would miss those already-captured references (only the
// browser-window-created fallback would remain).
//
// Coverage:
//   - First windows: wrapped BrowserWindow merges webPreferences.preload.
//   - Portal pop-outs (main.js:361 did-create-window) + preview windows:
//     same wrapped constructor; any window that still lacks the
//     `__HERETEK__` seed gets the fallback source via did-finish-load +
//     executeJavaScript (same mechanism as main.js:261-269).
//   - Network fallback: session.defaultSession.webRequest.onBeforeRequest
//     redirects GET usage/{limits,subscription-v2} to data: URLs.
//     Firebase auth/JWT untouched.
// Testability: `electron` is injectable; tests/launcher/hook.test.cjs
// drives the whole module with fakes (no Electron needed).
'use strict';

const path = require('path');
const {
  USAGE_API_BASE,
  spoofBodyForUrl,
} = require('./unlock-payloads.cjs');
const {
  getRendererFallbackSource,
} = require('./preload-unlock.cjs');

// Absolute path so asar relocation cannot silently drop the hook.
const PRELOAD_PATH = path.join(__dirname, 'preload-unlock.cjs');

const SPOOFED_USAGE_URLS = [
  `${USAGE_API_BASE}/limits`,
  `${USAGE_API_BASE}/subscription-v2`,
];

const UPDATER_PIN_MESSAGE =
  '[heretek] update downloaded: the Tier-1 hook (main.js loader line + ' +
  'launcher/*.cjs) is replaced by the updater payload on restart. ' +
  'Re-run node scripts/apply-patches.mjs --asar <new-app.asar> --out ' +
  '<patched.asar> before launching, or Tier-1 gates return. ' +
  'See launcher/README.md ("auto-updater pin").';

/**
 * Merge the unlock preload into window options. An explicitly set
 * preload is never overridden (upstream ships none — frozen by the
 * Phase 1 electron seam test).
 */
function withUnlockPreload(options) {
  const opts = options || {};
  const webPreferences = Object.assign({}, opts.webPreferences);
  if (!webPreferences.preload) webPreferences.preload = PRELOAD_PATH;
  return Object.assign({}, opts, { webPreferences });
}

function shouldSpoofUrl(url, method) {
  if (!url || typeof url !== 'string') return false;
  const upperMethod = (method || 'GET').toUpperCase();
  if (upperMethod !== 'GET') return false;
  return SPOOFED_USAGE_URLS.some(
    prefix => url === prefix || url.indexOf(prefix + '?') === 0
  );
}

/** data: URL carrying the unlocked JSON body for a spoofed request. */
function buildSpoofRedirectUrl(url) {
  const body = spoofBodyForUrl(url, 'GET');
  if (body === null) return null;
  return (
    'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(body))
  );
}

/**
 * session.webRequest.onBeforeRequest handler. Spoofed endpoints redirect
 * to data: URLs; everything else (generation, builds, auth, mutations)
 * passes through with an empty action.
 */
function handleBeforeRequest(details, callback) {
  const url = details && details.url;
  const method = (details && details.method) || 'GET';
  if (url && shouldSpoofUrl(url, method)) {
    const redirectURL = buildSpoofRedirectUrl(url);
    if (redirectURL) {
      callback({ redirectURL });
      return;
    }
  }
  callback({});
}

/**
 * did-finish-load fallback for windows that missed the preload
 * (pop-outs, preview windows, late-created sessions): if the renderer
 * has no `__HERETEK__` seed, execute the composed fallback source.
 */
function ensureRendererSeed(webContents, logger) {
  if (!webContents || typeof webContents.executeJavaScript !== 'function')
    return;
  let source;
  try {
    source = getRendererFallbackSource();
  } catch (error) {
    if (logger) logger.error('[heretek] fallback source failed:', error);
    return;
  }
  webContents
    .executeJavaScript(
      `(function(){ return !!(window.__HERETEK__ && window.__HERETEK__.unlocked); })()`
    )
    .then(seeded => {
      if (seeded) return null;
      return webContents.executeJavaScript(source);
    })
    .catch(error => {
      if (logger) logger.error('[heretek] seed fallback failed:', error);
    });
}

function watchWindowCreated(app, logger) {
  if (!app || typeof app.on !== 'function') {
    if (logger)
      logger.error('[heretek] app.on missing — pop-out coverage disabled.');
    return false;
  }
  app.on('browser-window-created', (event, win) => {
    if (!win || !win.webContents) return;
    win.webContents.once('did-finish-load', () => {
      ensureRendererSeed(win.webContents, logger);
    });
  });
  return true;
}

function watchWebRequest(session, logger) {
  if (
    !session ||
    !session.webRequest ||
    typeof session.webRequest.onBeforeRequest !== 'function'
  ) {
    if (logger)
      logger.error('[heretek] webRequest unavailable — network fallback off.');
    return false;
  }
  session.webRequest.onBeforeRequest(
    { urls: [`${USAGE_API_BASE}/*`] },
    (details, callback) => handleBeforeRequest(details, callback)
  );
  return true;
}

/**
 * Loud warning when the updater stages a payload: on restart the asar
 * (loader line + launcher files) is replaced and the hook drops.
 * Never blocks the update — just makes the drop impossible to miss.
 */
function watchUpdater(autoUpdater, logger) {
  if (!autoUpdater || typeof autoUpdater.on !== 'function') return false;
  autoUpdater.on('update-downloaded', () => {
    try {
      globalThis.__HERETEK__ = Object.assign({}, globalThis.__HERETEK__, {
        updatePending: true,
      });
    } catch (error) {
      // Flag is observability only.
    }
    if (logger) logger.warn(UPDATER_PIN_MESSAGE);
  });
  return true;
}

function wrapBrowserWindow(electron, logger) {
  if (!electron || typeof electron.BrowserWindow !== 'function') {
    if (logger)
      logger.error('[heretek] electron.BrowserWindow missing — no wrap.');
    return false;
  }
  const OriginalBrowserWindow = electron.BrowserWindow;
  if (OriginalBrowserWindow.__heretekWrapped) return true;
  function HeretekBrowserWindow(options) {
    return new OriginalBrowserWindow(withUnlockPreload(options));
  }
  HeretekBrowserWindow.prototype = OriginalBrowserWindow.prototype;
  Object.setPrototypeOf(HeretekBrowserWindow, OriginalBrowserWindow);
  Object.defineProperty(HeretekBrowserWindow, '__heretekWrapped', {
    value: true,
  });
  try {
    electron.BrowserWindow = HeretekBrowserWindow;
  } catch (error) {
    if (logger) logger.error('[heretek] BrowserWindow wrap failed:', error);
    return false;
  }
  return true;
}

/**
 * Main entry, called from the top of main.js (patch 06). `electronModule`
 * defaults to require('electron') and is injectable for tests.
 */
function installPreloadHook(electronModule, opts) {
  const options = opts || {};
  const logger = options.logger || console;
  let electron = electronModule;
  if (!electron) {
    try {
      electron = require('electron');
    } catch (error) {
      logger.error('[heretek] require("electron") failed:', error);
      return { wrapped: false };
    }
  }
  const wrapped = wrapBrowserWindow(electron, logger);
  const windowsWatched =
    electron.app && watchWindowCreated(electron.app, logger);
  const requestWatched =
    electron.session &&
    electron.session.defaultSession &&
    watchWebRequest(electron.session.defaultSession, logger);
  let updaterWatched = false;
  if (!options.skipUpdaterWatch) {
    try {
      updaterWatched = watchUpdater(
        require('electron-updater').autoUpdater,
        logger
      );
    } catch (error) {
      // Updater optional in tests and minimal shells.
    }
  }
  logger.info(
    `[heretek] hook installed (window-wrap: ${wrapped}, ` +
      `pop-out fallback: ${!!windowsWatched}, ` +
      `webRequest fallback: ${!!requestWatched}, ` +
      `updater pin: ${!!updaterWatched}).`
  );
  return {
    wrapped,
    windowsWatched: !!windowsWatched,
    requestWatched: !!requestWatched,
    updaterWatched: !!updaterWatched,
  };
}

module.exports = {
  PRELOAD_PATH,
  SPOOFED_USAGE_URLS,
  UPDATER_PIN_MESSAGE,
  withUnlockPreload,
  shouldSpoofUrl,
  buildSpoofRedirectUrl,
  handleBeforeRequest,
  ensureRendererSeed,
  watchWindowCreated,
  watchWebRequest,
  watchUpdater,
  wrapBrowserWindow,
  installPreloadHook,
};
