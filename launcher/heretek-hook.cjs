// Phase 3 main-process hook (issue #3): preload injection for every
// window + webRequest spoof fallback + auto-updater pin.
//
// Installed by a loader at the TOP of electron-app/app/main.js
// (patches/06-electron-hook.patch, or scripts/inject-launcher.mjs for
// release asars) — listener registration must precede the first window:
// main.js:226 and PreviewWindow.js:52 capture `electron.BrowserWindow`
// before any later require could wrap it.
//
// Coverage (production reality: the BrowserWindow export is
// non-configurable, so the constructor wrap usually fails and the
// fallback carries the unlock — same wrappers, later timing):
//   - Wrappable exports: wrapped BrowserWindow merges
//     webPreferences.preload into every window.
//   - All windows (usual path): browser-window-created +
//     did-finish-load executeJavaScript of the composed fallback source
//     (fetch/XHR spoof + __HERETEK__ seed) before React hydrates.
//   - Network backstop: session.defaultSession.webRequest.onBeforeRequest
//     redirects GET usage/{limits,subscription-v2} to data: URLs.
//     Firebase auth/JWT untouched. NOTE: measured on Electron 32 /
//     Chromium 128, the https -> data: redirect is refused for XHR/fetch
//     (net::ERR_UNSAFE_REDIRECT), so this layer fails the request rather
//     than serving it — see launcher/README.md ("Known limits").
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
  'Re-inject before launching (extract the new app.asar, run node ' +
  'scripts/inject-launcher.mjs --appdir <extracted-asar>, repack), or ' +
  'Tier-1 gates return. See launcher/README.md ("auto-updater pin").';

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
 * (pop-outs, preview windows, late-created sessions — and, in production
 * Electron where the BrowserWindow export is non-configurable, EVERY
 * window): if the renderer has no `__HERETEK__` seed, execute the
 * composed fallback source. Returns a promise resolving true once the
 * seed is confirmed present.
 */
function ensureRendererSeed(webContents, logger) {
  if (!webContents || typeof webContents.executeJavaScript !== 'function')
    return Promise.resolve(false);
  let source;
  try {
    source = getRendererFallbackSource();
  } catch (error) {
    if (logger) logger.error('[heretek] fallback source failed:', error);
    return Promise.resolve(false);
  }
  return webContents
    .executeJavaScript(
      `(function(){ return !!(window.__HERETEK__ && window.__HERETEK__.unlocked); })()`
    )
    .then(seeded => {
      if (seeded) return true;
      return webContents.executeJavaScript(source).then(
        () => true,
        error => {
          if (logger)
            logger.error('[heretek] seed fallback failed:', error);
          return false;
        }
      );
    })
    .catch(error => {
      if (logger) logger.error('[heretek] seed probe failed:', error);
      return false;
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
  // Real Electron exposes BrowserWindow through a non-configurable
  // lazy binding: neither assignment nor redefinition works there. The
  // did-finish-load fallback (watchWindowCreated) then carries the same
  // wrappers, so a failed wrap degrades instead of dropping Tier-1.
  try {
    electron.BrowserWindow = HeretekBrowserWindow;
  } catch (assignmentError) {
    try {
      Object.defineProperty(electron, 'BrowserWindow', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: HeretekBrowserWindow,
      });
    } catch (defineError) {
      if (logger)
        logger.warn(
          '[heretek] BrowserWindow export not wrappable (' +
            (defineError && defineError.message) +
            ') — fallback seed path active.'
        );
      return false;
    }
  }
  return electron.BrowserWindow === HeretekBrowserWindow;
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
  const app = electron.app;
  const windowsWatched = app && watchWindowCreated(app, logger);
  // Real Electron throws on `session.defaultSession` before app ready —
  // set up now when possible, otherwise retry once ready.
  let requestWatched = false;
  let webRequestDeferred = false;
  const setupWebRequest = () => {
    const session = electron.session && electron.session.defaultSession;
    if (session) requestWatched = watchWebRequest(session, logger);
  };
  try {
    setupWebRequest();
  } catch (error) {
    // Session unavailable until app ready: defer, don't drop.
    webRequestDeferred = true;
  }
  if (webRequestDeferred && !requestWatched && app) {
    const retry = () => {
      webRequestDeferred = false;
      try {
        setupWebRequest();
      } catch (error) {
        if (logger)
          logger.error('[heretek] webRequest deferred setup failed:', error);
      }
    };
    if (typeof app.whenReady === 'function') app.whenReady().then(retry, retry);
    else if (typeof app.once === 'function') app.once('ready', retry);
    else retry();
  }
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
      `webRequest fallback: ${!!requestWatched}` +
      `${webRequestDeferred ? ' (deferred to app-ready)' : ''}, ` +
      `updater pin: ${!!updaterWatched}).`
  );
  try {
    armSmokeMode(electron, {
      logger,
      argv: (options && options.argv) || process.argv,
    });
  } catch (error) {
    logger.error('[heretek] smoke arm failed:', error);
  }
  return {
    wrapped,
    windowsWatched: !!windowsWatched,
    requestWatched: !!requestWatched,
    webRequestDeferred,
    updaterWatched: !!updaterWatched,
  };
}

/**
 * --- Self-contained smoke mode (CI E2E, `--heretek-smoke`) ---
 * Opens nothing itself: it rides the first window the app creates,
 * probes the renderer after did-finish-load, prints one
 * `HERETEK_SMOKE:<json>` line and exits. No Puppeteer, no display
 * assertions beyond xvfb — transport-level proof that the hook holds
 * on a stock build (all dialog gates hydrate from these endpoints).
 */
const SMOKE_ARG = '--heretek-smoke';
const SMOKE_TIMEOUT_MS = 180000;

function isSmokeMode(argv) {
  // Packaged Electron argv is [exe, ...userArgs] (no script element);
  // node argv is [node, script, ...userArgs]. Scan everything past the
  // executable instead of assuming a script slot, otherwise a first-arg
  // --heretek-smoke is silently dropped in production.
  return ((argv || process.argv).slice(1) || []).includes(SMOKE_ARG);
}

// Self-contained: no references outside this string (runs in the
// renderer via executeJavaScript).
const SMOKE_PROBE_SOURCE = `(async function() {
  var out = { seed: false, limits: null, subscription: null, passthrough: null, errors: [] };
  try { out.seed = !!(window.__HERETEK__ && window.__HERETEK__.unlocked); }
  catch (e) { out.errors.push('seed:' + e.message); }
  try {
    var r1 = await fetch('https://api.gdevelop.io/usage/limits?userId=smoke');
    var j1 = await r1.json();
    out.limits = { status: r1.status, maxCloudProjects: j1 && j1.capabilities && j1.capabilities.cloudProjects && j1.capabilities.cloudProjects.maximumCount };
  } catch (e) { out.errors.push('limits:' + e.message); }
  try {
    var r2 = await fetch('https://api.gdevelop.io/usage/subscription-v2?userId=smoke');
    var j2 = await r2.json();
    out.subscription = { status: r2.status, planId: j2 && j2.planId };
  } catch (e) { out.errors.push('subscription:' + e.message); }
  try {
    var r3 = await fetch('https://api.gdevelop.io/usage/limits?userId=smoke', { method: 'POST' });
    var spoofed = false;
    try { var j3 = await r3.clone().json(); spoofed = !!(j3 && j3.capabilities); } catch (e2) {}
    out.passthrough = { resolved: true, spoofed: spoofed, status: r3.status };
  } catch (e) { out.passthrough = { resolved: false, spoofed: false, error: String(e).slice(0, 120) }; }
  // The app's own client is axios 0.18 over XHR, not fetch: settle exactly
  // as that adapter does (readyState 4, non-zero status) so a spoof that
  // only works for fetch cannot pass.
  try {
    out.xhr = await new Promise(function(resolve) {
      var x = new XMLHttpRequest();
      x.open('GET', 'https://api.gdevelop.io/usage/limits?userId=smoke', true);
      x.onreadystatechange = function() {
        if (x.readyState !== 4 || x.status === 0) return;
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (e2) {}
        resolve({ status: x.status, maxCloudProjects: j && j.capabilities && j.capabilities.cloudProjects && j.capabilities.cloudProjects.maximumCount });
      };
      x.onerror = function() { resolve({ status: 0, error: 'network error' }); };
      x.send();
      setTimeout(function() { resolve({ status: 0, error: 'never settled' }); }, 5000);
    });
  } catch (e) { out.errors.push('xhr:' + e.message); }
  return out;
})()`;

/**
 * Pure verdict over probe results. POST counts as passed when it was
 * NOT spoofed — resolved-with-real-status or rejected-at-network both
 * prove the wrapper let it through (a spoof would resolve 200 with
 * capabilities).
 */
function verdictSmokeResults(out) {
  const failures = [];
  if (!out || out.seed !== true) failures.push('seed missing');
  if (
    !out ||
    !out.limits ||
    out.limits.status !== 200 ||
    out.limits.maxCloudProjects !== 999
  )
    failures.push('limits not unlocked');
  if (
    !out ||
    !out.subscription ||
    out.subscription.status !== 200 ||
    out.subscription.planId !== 'gdevelop_startup'
  )
    failures.push('subscription not unlocked');
  if (!out || !out.passthrough || out.passthrough.spoofed !== false)
    failures.push('POST was spoofed (over-interception)');
  if (
    !out ||
    !out.xhr ||
    out.xhr.status !== 200 ||
    out.xhr.maxCloudProjects !== 999
  )
    failures.push(
      'XHR limits not unlocked (app client path)' +
        (out && out.xhr && out.xhr.error ? ': ' + out.xhr.error : '')
    );
  return { ok: failures.length === 0, failures };
}

function armSmokeMode(electronModule, opts) {
  const options = opts || {};
  const argv = options.argv || process.argv;
  if (!isSmokeMode(argv)) return { armed: false };
  const logger = options.logger || console;
  const exitFn =
    options.exitFn ||
    (code => {
      if (
        electronModule &&
        electronModule.app &&
        typeof electronModule.app.exit === 'function'
      )
        electronModule.app.exit(code);
      else process.exit(code);
    });
  const timeoutMs = options.timeoutMs || SMOKE_TIMEOUT_MS;
  const probeSource = options.probeSource || SMOKE_PROBE_SOURCE;

  let settled = false;
  const finish = (code, payload) => {
    if (settled) return;
    settled = true;
    logger.info('HERETEK_SMOKE:' + JSON.stringify(payload));
    exitFn(code);
  };
  const timer =
    typeof setTimeout === 'function'
      ? setTimeout(
          () =>
            finish(2, {
              ok: false,
              failures: ['timeout waiting for first window load'],
            }),
          timeoutMs
        )
      : null;
  if (timer && typeof timer.unref === 'function') timer.unref();

  const runProbe = webContents => {
    if (!webContents || typeof webContents.executeJavaScript !== 'function')
      return;
    webContents.once('did-finish-load', () => {
      // Seed first (same fallback source as watchWindowCreated), THEN
      // verify: separate executeJavaScript calls race, so the probe must
      // await the seed instead of assuming listener order.
      Promise.resolve()
        .then(() => ensureRendererSeed(webContents, logger))
        .then(() => webContents.executeJavaScript(probeSource))
        .then(results => {
          const verdict = verdictSmokeResults(results);
          finish(verdict.ok ? 0 : 1, Object.assign({ ok: verdict.ok }, verdict, { results }));
        })
        .catch(error =>
          finish(1, { ok: false, failures: ['probe error: ' + error] })
        );
    });
  };

  const app = electronModule && electronModule.app;
  const onWindow = (event, win) => {
    if (win && win.webContents) runProbe(win.webContents);
  };
  if (app && typeof app.on === 'function') app.on('browser-window-created', onWindow);
  const ready =
    app && typeof app.whenReady === 'function'
      ? app.whenReady()
      : Promise.resolve();
  Promise.resolve(ready)
    .then(() => {
      const existing =
        typeof options.existingWindows === 'function'
          ? options.existingWindows()
          : [];
      existing.forEach(win => {
        if (win && win.webContents) runProbe(win.webContents);
      });
    })
    .catch(error => {
      // Not fatal: windows created later still reach runProbe through
      // browser-window-created; the timeout verdict covers "none ever".
      logger.error('[heretek] smoke existing-window scan failed:', error);
    });
  logger.info('[heretek] smoke mode armed (--heretek-smoke).');
  return { armed: true };
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
  SMOKE_ARG,
  SMOKE_PROBE_SOURCE,
  isSmokeMode,
  verdictSmokeResults,
  armSmokeMode,
};
