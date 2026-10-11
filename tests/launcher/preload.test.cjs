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
