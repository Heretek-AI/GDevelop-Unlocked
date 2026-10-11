// Main-process hook tests (Phase 3): the whole heretek-hook.cjs
// surface driven with fake Electron objects — no Electron needed.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const hook = require('../../launcher/heretek-hook.cjs');
const {
  USAGE_API_BASE,
} = require('../../launcher/unlock-payloads.cjs');

function makeLogger() {
  const records = { info: [], warn: [], error: [] };
  return {
    logger: {
      info: msg => records.info.push(String(msg)),
      warn: msg => records.warn.push(String(msg)),
      error: (msg, ...rest) =>
        records.error.push(String(msg) + ' ' + rest.join(' ')),
    },
    records,
  };
}

function makeFakeElectron() {
  const listeners = {};
  const webRequests = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.id = 7;
    }
  }
  // Mirror real Electron: BrowserWindow is a getter-only lazy binding,
  // so direct assignment throws and the hook must redefine the property.
  const exportsObj = {
    app: { on: (event, cb) => (listeners[event] = cb) },
    session: {
      defaultSession: {
        webRequest: {
          onBeforeRequest: (filter, cb) => webRequests.push({ filter, cb }),
        },
      },
    },
  };
  Object.defineProperty(exportsObj, 'BrowserWindow', {
    configurable: true,
    enumerable: true,
    get: () => FakeWindow,
  });
  return {
    electron: exportsObj,
    listeners,
    webRequests,
    FakeWindow,
  };
}

describe('hook: window wrap', () => {
  it('injects the preload into every constructed window', () => {
    const { electron, FakeWindow } = makeFakeElectron();
    const { logger } = makeLogger();
    const result = hook.installPreloadHook(electron, {
      logger,
      skipUpdaterWatch: true,
    });
    assert.equal(result.wrapped, true);

    const win = new electron.BrowserWindow({ width: 800 });
    assert.ok(win instanceof FakeWindow, 'must still construct the original');
    assert.ok(
      String(win.options.webPreferences.preload).endsWith(
        'preload-unlock.cjs'
      )
    );
    assert.equal(win.options.width, 800);
  });

  it('never overrides an explicitly set preload', () => {
    const out = hook.withUnlockPreload({
      webPreferences: { preload: '/custom/preload.js' },
    });
    assert.equal(out.webPreferences.preload, '/custom/preload.js');
  });

  it('wrap is idempotent across double install', () => {
    const { electron } = makeFakeElectron();
    const { logger } = makeLogger();
    hook.installPreloadHook(electron, { logger, skipUpdaterWatch: true });
    const second = hook.installPreloadHook(electron, {
      logger,
      skipUpdaterWatch: true,
    });
    assert.equal(second.wrapped, true);
    const win = new electron.BrowserWindow({});
    assert.ok(
      String(win.options.webPreferences.preload).endsWith(
        'preload-unlock.cjs'
      )
    );
  });
});

describe('hook: real-Electron regressions', () => {
  it('wraps getter-only BrowserWindow exports (prod failure)', () => {
    const { electron } = makeFakeElectron();
    const { logger } = makeLogger();
    // Sanity: the fake really is getter-only like production Electron.
    assert.throws(() => {
      'use strict';
      electron.BrowserWindow = function () {};
    }, TypeError);
    const result = hook.installPreloadHook(electron, {
      logger,
      skipUpdaterWatch: true,
    });
    assert.equal(result.wrapped, true);
    const win = new electron.BrowserWindow({});
    assert.ok(
      String(win.options.webPreferences.preload).endsWith(
        'preload-unlock.cjs'
      )
    );
  });

  it('defers webRequest setup until app ready (prod failure)', async () => {
    const webRequests = [];
    const readyCbs = [];
    let ready = false;
    const session = {
      webRequest: {
        onBeforeRequest: (filter, cb) => webRequests.push({ filter, cb }),
      },
    };
    const electron = {
      BrowserWindow: function FakeWindow(options) {
        this.options = options;
      },
      app: {
        on: () => {},
        whenReady: () =>
          new Promise(resolve => readyCbs.push(() => resolve())),
      },
      get session() {
        if (!ready) throw new Error('Session can only be received');
        return { defaultSession: session };
      },
    };
    const { logger } = makeLogger();
    const result = hook.installPreloadHook(electron, {
      logger,
      skipUpdaterWatch: true,
    });
    assert.equal(result.webRequestDeferred, true);
    assert.equal(webRequests.length, 0);
    ready = true;
    readyCbs.forEach(cb => cb());
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(webRequests.length, 1);
    assert.deepEqual(webRequests[0].filter, {
      urls: [`${USAGE_API_BASE}/*`],
    });
  });
});
describe('hook: pop-out fallback', () => {
  it('seeds windows that missed the preload via executeJavaScript', async () => {
    const { electron, listeners } = makeFakeElectron();
    const { logger } = makeLogger();
    hook.installPreloadHook(electron, { logger, skipUpdaterWatch: true });
    assert.ok(
      listeners['browser-window-created'],
      'pop-out listener registered'
    );

    const executed = [];
    const fakeContents = {
      once: (event, cb) => {
        assert.equal(event, 'did-finish-load');
        fakeContents._loaded = cb;
      },
      executeJavaScript: source => {
        executed.push(source);
        // First probe: not seeded. Second: the fallback source.
        return Promise.resolve(executed.length > 1);
      },
    };
    listeners['browser-window-created']({}, { webContents: fakeContents });
    fakeContents._loaded();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(executed.length, 2);
    assert.ok(executed[1].includes('__HERETEK__'));
    assert.ok(executed[1].includes(USAGE_API_BASE));
  });
});

describe('hook: webRequest fallback', () => {
  it('registers a usage-scoped filter and spoofs the two GETs', () => {
    const { electron, webRequests } = makeFakeElectron();
    const { logger } = makeLogger();
    const result = hook.installPreloadHook(electron, {
      logger,
      skipUpdaterWatch: true,
    });
    assert.equal(result.requestWatched, true);
    assert.deepEqual(webRequests[0].filter, {
      urls: [`${USAGE_API_BASE}/*`],
    });

    const handler = webRequests[0].cb;
    let redirected = null;
    handler(
      { url: `${USAGE_API_BASE}/limits?userId=x`, method: 'GET' },
      action => (redirected = action)
    );
    assert.ok(
      redirected.redirectURL.startsWith('data:application/json'),
      'limits redirected to data: URL'
    );
    const limits = JSON.parse(
      decodeURIComponent(redirected.redirectURL.split(',', 2)[1])
    );
    assert.equal(limits.capabilities.cloudProjects.maximumCount, 999);

    let sub = null;
    handler({ url: `${USAGE_API_BASE}/subscription-v2`, method: 'GET' }, a => (sub = a));
    const subBody = JSON.parse(
      decodeURIComponent(sub.redirectURL.split(',', 2)[1])
    );
    assert.equal(subBody.userId, 'local-byok-user');

    let passthrough = null;
    handler(
      { url: `${USAGE_API_BASE}/generation`, method: 'POST' },
      a => (passthrough = a)
    );
    assert.deepEqual(passthrough, {});
  });
});

describe('hook: updater pin', () => {
  afterEach(() => {
    delete globalThis.__HERETEK__;
  });

  it('warns loudly on update-downloaded and flags the drop', () => {
    const handlers = {};
    const { logger, records } = makeLogger();
    const watched = hook.watchUpdater(
      { on: (event, cb) => (handlers[event] = cb) },
      logger
    );
    assert.equal(watched, true);
    handlers['update-downloaded']();
    assert.equal(globalThis.__HERETEK__.updatePending, true);
    assert.equal(records.warn.length, 1);
    assert.ok(records.warn[0].includes('apply-patches.mjs --asar'));
  });
});
