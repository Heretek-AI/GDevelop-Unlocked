// Renderer hook tests (Phase 3): fetch/XHR spoofing on fakes, plus a
// vm-sandbox evaluation of getRendererFallbackSource() — the exact
// string heretek-hook.cjs injects into pop-out windows. If an embedded
// function closes over module scope, the sandbox run throws and this
// goes red.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const preload = require('../../launcher/preload-unlock.cjs');
const { USAGE_API_BASE } = require('../../launcher/unlock-payloads.cjs');

const LIMITS = `${USAGE_API_BASE}/limits?userId=abc`;
const SUB = `${USAGE_API_BASE}/subscription-v2?userId=abc`;
const OTHER = `${USAGE_API_BASE}/generation`;

class FakeResponse {
  constructor(body, init) {
    this._body = body;
    this.status = init.status;
  }
  json() {
    return Promise.resolve(JSON.parse(this._body));
  }
}

function makeScope() {
  const calls = [];
  return {
    scope: {
      location: { href: 'https://editor.gdevelop.io/' },
      Response: FakeResponse,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      fetch: url => {
        calls.push(url);
        return Promise.resolve({ passthrough: true, url });
      },
    },
    calls,
  };
}

function makeXhrClass() {
  return class FakeXHR {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.response = '';
      this.onreadystatechange = null;
      this.onload = null;
      this.sent = [];
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send() {
      this.sent.push(this.url);
    }
  };
}

// The two real-XMLHttpRequest facts the plain fake above hides (both
// observed on a real build, Electron 32 / Chromium 128, issue #12):
//   1. readyState/status/responseText/response are getter-only prototype
//      accessors — assignment throws in strict code and silently no-ops
//      in sloppy code;
//   2. it is an EventTarget — consumers may use on* attributes OR
//      addEventListener, and axios >= 0.22 settles on `loadend`.
function makeRealisticXhrClass() {
  class RealisticXHR extends EventTarget {
    constructor() {
      super();
      this._state = { readyState: 0, status: 0, responseText: '', response: '' };
      this.sent = [];
    }
    open(method, url) {
      this._state.readyState = 1;
      this.url = url;
    }
    send() {
      this.sent.push(this.url);
    }
    dispatchEvent(event) {
      const handler = this['on' + event.type];
      if (typeof handler === 'function') handler.call(this, event);
      return super.dispatchEvent(event);
    }
  }
  for (const name of ['readyState', 'status', 'responseText', 'response'])
    Object.defineProperty(RealisticXHR.prototype, name, {
      configurable: true,
      enumerable: true,
      get() {
        return this._state[name];
      },
    });
  return RealisticXHR;
}

// axios 0.18.1 xhr adapter (what upstream newIDE ships): settles only
// from onreadystatechange, and only at readyState 4 with a non-zero status.
function axios018StyleGet(XHR, url) {
  return new Promise((resolve, reject) => {
    const request = new XHR();
    request.open('GET', url);
    request.onreadystatechange = () => {
      if (request.readyState !== 4) return;
      if (request.status === 0) return;
      resolve({ status: request.status, data: JSON.parse(request.responseText) });
    };
    request.send();
    setTimeout(() => reject(new Error('spoofed XHR never settled')), 200);
  });
}

function loadendListenerGet(XHR, url) {
  return new Promise((resolve, reject) => {
    const request = new XHR();
    request.open('GET', url);
    request.addEventListener('loadend', () =>
      resolve({ status: request.status, data: JSON.parse(request.responseText) })
    );
    request.send();
    setTimeout(() => reject(new Error('loadend never fired')), 200);
  });
}

describe('preload: fetch wrapper', () => {
  it('spoofs limits + subscription GETs, logs them, passes the rest through', async () => {
    const { scope, calls } = makeScope();
    preload.installRendererHook(scope);
    assert.equal(scope.__HERETEK__.unlocked, true);
    assert.equal(scope.__HERETEK__.planId, 'gdevelop_startup');

    const limitsRes = await scope.fetch(LIMITS, { method: 'GET' });
    assert.equal(limitsRes.status, 200);
    const limits = await limitsRes.json();
    assert.equal(limits.capabilities.cloudProjects.maximumCount, 999);

    const subRes = await scope.fetch(SUB);
    assert.equal((await subRes.json()).userId, 'local-byok-user');

    const other = await scope.fetch(OTHER);
    assert.equal(other.passthrough, true);
    assert.deepEqual(calls, [OTHER]);

    const post = await scope.fetch(LIMITS, { method: 'POST' });
    assert.equal(post.passthrough, true);
    assert.deepEqual(scope.__HERETEK__.spoofedRequests, [LIMITS, SUB]);
  });
});

describe('preload: XHR patch', () => {
  it('spoofs usage GETs asynchronously, delegates the rest', async () => {
    const { scope } = makeScope();
    const XHR = makeXhrClass();
    preload.patchXhr(XHR, scope);

    const xhr = new XHR();
    let loaded = null;
    xhr.onload = () => {
      loaded = { status: xhr.status, body: JSON.parse(xhr.responseText) };
    };
    xhr.open('GET', LIMITS);
    xhr.send();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(loaded, 'spoofed onload never fired');
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.capabilities.versionHistory.retentionDays, 365);

    const other = new XHR();
    other.open('POST', LIMITS);
    other.send();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(other.sent, [LIMITS]);
  });
});

describe('preload: XHR spoof against real-XMLHttpRequest semantics', () => {
  it('strict module path: axios 0.18 consumer and loadend listener both settle', async () => {
    const { scope } = makeScope();
    const XHR = preload.patchXhr(makeRealisticXhrClass(), scope);
    const viaAxios = await axios018StyleGet(XHR, LIMITS);
    assert.equal(viaAxios.status, 200);
    assert.equal(viaAxios.data.capabilities.cloudProjects.maximumCount, 999);
    const viaLoadend = await loadendListenerGet(XHR, SUB);
    assert.equal(viaLoadend.data.planId, 'gdevelop_startup');
  });

  it('a reused XHR does not keep the spoofed state on its next request', async () => {
    // open() re-initializes an XHR. The per-instance shadows from a spoofed
    // response must go, or a later real request reads back the old 200.
    const { scope } = makeScope();
    const XHR = preload.patchXhr(makeRealisticXhrClass(), scope);
    const xhr = new XHR();
    await new Promise(resolve => {
      xhr.onloadend = resolve;
      xhr.open('GET', LIMITS);
      xhr.send();
    });
    assert.equal(xhr.readyState, 4);
    assert.equal(xhr.status, 200);

    xhr.open('POST', LIMITS); // not spoofed: goes to the real send
    assert.equal(xhr.readyState, 1, 'stale spoofed readyState after open()');
    assert.equal(xhr.status, 0, 'stale spoofed status after open()');
    assert.equal(xhr.responseText, '', 'stale spoofed body after open()');
    xhr.send();
    assert.deepEqual(xhr.sent, [LIMITS]);
  });

  it('injected fallback source (the production path) settles the same consumers', async () => {
    // The hook injects this string with executeJavaScript whenever the
    // BrowserWindow export is not wrappable — i.e. always, in production.
    const { scope } = makeScope();
    scope.XMLHttpRequest = makeRealisticXhrClass();
    const sandbox = { window: scope, URL, Promise, JSON, Object, setTimeout, Event };
    vm.createContext(sandbox);
    vm.runInContext(preload.getRendererFallbackSource(), sandbox);
    const XHR = sandbox.window.XMLHttpRequest;
    const viaAxios = await axios018StyleGet(XHR, LIMITS);
    assert.equal(viaAxios.status, 200);
    assert.equal(viaAxios.data.capabilities.cloudProjects.maximumCount, 999);
    const viaLoadend = await loadendListenerGet(XHR, SUB);
    assert.equal(viaLoadend.data.planId, 'gdevelop_startup');
    // Array.from: the log array belongs to the vm realm.
    assert.deepEqual(Array.from(scope.__HERETEK__.spoofedRequests), [LIMITS, SUB]);
  });
});

describe('preload: fallback source (vm sandbox)', () => {
  it('embeds every referenced name (no module-scope leaks)', () => {
    const payloads = require('../../launcher/unlock-payloads.cjs');
    const namespace = Object.assign({}, payloads, preload);
    for (const name of preload.FALLBACK_EMBEDDED_FUNCTIONS) {
      assert.equal(
        typeof namespace[name],
        'function',
        `fallback embeds missing function: ${name}`
      );
    }
    for (const name of preload.FALLBACK_EMBEDDED_CONSTS) {
      assert.ok(
        payloads[name] !== undefined,
        `fallback embeds missing const: ${name}`
      );
    }
  });

  it('evaluates standalone and spoofs in the sandbox', async () => {
    const source = preload.getRendererFallbackSource();
    assert.ok(source.includes('__HERETEK__'));
    assert.ok(source.includes(USAGE_API_BASE));
    const { scope } = makeScope();
    scope.XMLHttpRequest = makeXhrClass();
    const sandbox = {
      window: scope,
      URL,
      Promise,
      JSON,
      Object,
      setTimeout,
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    assert.equal(sandbox.window.__HERETEK__.unlocked, true);

    const res = await sandbox.window.fetch(LIMITS);
    assert.equal(res.status, 200);
    assert.equal(
      (await res.json()).capabilities.leaderboards.maximumCountPerGame,
      999
    );
    const passthrough = await sandbox.window.fetch(OTHER);
    assert.equal(passthrough.passthrough, true);

    const XHR = sandbox.window.XMLHttpRequest;
    const xhr = new XHR();
    const loaded = await new Promise(resolve => {
      xhr.onload = () =>
        resolve({ status: xhr.status, body: JSON.parse(xhr.response) });
      xhr.open('GET', SUB);
      xhr.send();
    });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.planId, 'gdevelop_startup');
  });
});
