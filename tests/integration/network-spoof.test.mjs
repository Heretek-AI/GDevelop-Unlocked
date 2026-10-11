// Integration Test: Real Network Spoofing & Interception Harness
// Verifies that launcher/preload-unlock.cjs and launcher/heretek-hook.cjs
// correctly intercept GDevelop usage endpoints, return valid payloads,
// and pass all other network traffic through to a real HTTP server.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import hook from '../../launcher/heretek-hook.cjs';
import preload from '../../launcher/preload-unlock.cjs';
import payloads from '../../launcher/unlock-payloads.cjs';

class TestResponse {
  constructor(body, init = {}) {
    this._body = typeof body === 'string' ? body : JSON.stringify(body);
    this.status = init.status || 200;
  }
  json() {
    return Promise.resolve(JSON.parse(this._body));
  }
  text() {
    return Promise.resolve(this._body);
  }
}

describe('integration: real network spoofing and passthrough', () => {
  let server;
  let serverPort;
  let serverHits = [];

  before(async () => {
    // Spin up an actual HTTP server to test passthrough and leak assertions
    server = http.createServer((req, res) => {
      serverHits.push({ method: req.method, url: req.url, headers: req.headers });
      if (req.url === '/test-passthrough') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ passedThrough: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('hook correctly classifies spoof target URLs and methods', () => {
    assert.equal(
      hook.shouldSpoofUrl('https://api.gdevelop.io/usage/limits', 'GET'),
      true
    );
    assert.equal(
      hook.shouldSpoofUrl('https://api.gdevelop.io/usage/subscription-v2', 'GET'),
      true
    );
    assert.equal(
      hook.shouldSpoofUrl(
        'https://api.gdevelop.io/usage/limits?userId=local-user',
        'GET'
      ),
      true
    );

    // Mutations must never be spoofed
    assert.equal(
      hook.shouldSpoofUrl('https://api.gdevelop.io/usage/limits', 'POST'),
      false
    );
    assert.equal(
      hook.shouldSpoofUrl('https://api.gdevelop.io/usage/subscription-v2', 'DELETE'),
      false
    );

    // Other endpoints must never be spoofed
    assert.equal(
      hook.shouldSpoofUrl('https://api.gdevelop.io/generation/ai-request', 'GET'),
      false
    );
    assert.equal(
      hook.shouldSpoofUrl('https://api.gdevelop.io/games', 'GET'),
      false
    );
    assert.equal(
      hook.shouldSpoofUrl(`http://127.0.0.1:${serverPort}/usage/limits`, 'GET'),
      false
    );
  });

  it('preload hook intercepts target GETs and forwards untargeted calls to real server', async () => {
    serverHits = [];

    // Scope mimicking renderer window with real global fetch available
    const scope = {
      location: { href: 'https://editor.gdevelop.io/' },
      Response: TestResponse,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        const res = await fetch(url, init);
        const data = await res.text();
        return new TestResponse(data, { status: res.status });
      },
    };

    preload.installRendererHook(scope);

    // 1. Target limits GET
    const limitsRes = await scope.fetch('https://api.gdevelop.io/usage/limits');
    assert.equal(limitsRes.status, 200);
    const limitsBody = await limitsRes.json();
    assert.ok(limitsBody.capabilities, 'capabilities property missing');
    assert.equal(limitsBody.capabilities.cloudProjects.maximumCount, 999);
    assert.equal(scope.__HERETEK__.spoofedRequests.length, 1);
    assert.equal(
      scope.__HERETEK__.spoofedRequests[0],
      'https://api.gdevelop.io/usage/limits'
    );

    // 2. Target subscription-v2 GET
    const subRes = await scope.fetch(
      'https://api.gdevelop.io/usage/subscription-v2'
    );
    assert.equal(subRes.status, 200);
    const subBody = await subRes.json();
    assert.equal(subBody.planId, 'gdevelop_startup');
    assert.equal(subBody.userId, 'local-byok-user');
    assert.equal(scope.__HERETEK__.spoofedRequests.length, 2);
    assert.equal(
      scope.__HERETEK__.spoofedRequests[1],
      'https://api.gdevelop.io/usage/subscription-v2'
    );

    // 3. Passthrough request to real HTTP server
    const passRes = await scope.fetch(
      `http://127.0.0.1:${serverPort}/test-passthrough`
    );
    assert.equal(passRes.status, 200);
    const passBody = await passRes.json();
    assert.equal(passBody.passedThrough, true);
    assert.equal(serverHits.length, 1);
    assert.equal(serverHits[0].url, '/test-passthrough');
    // Spoofed requests counter must remain 2
    assert.equal(scope.__HERETEK__.spoofedRequests.length, 2);
  });

  it('webRequest redirect generates valid data URIs for Electron session layer', () => {
    const limitsDataUrl = hook.buildSpoofRedirectUrl(
      'https://api.gdevelop.io/usage/limits'
    );
    assert.ok(limitsDataUrl.startsWith('data:application/json;charset=utf-8,'));
    const parsedLimits = JSON.parse(
      decodeURIComponent(
        limitsDataUrl.slice('data:application/json;charset=utf-8,'.length)
      )
    );
    assert.ok(parsedLimits.capabilities);
    assert.equal(parsedLimits.capabilities.leaderboards.canUseCustomCss, true);

    const subDataUrl = hook.buildSpoofRedirectUrl(
      'https://api.gdevelop.io/usage/subscription-v2'
    );
    const parsedSub = JSON.parse(
      decodeURIComponent(
        subDataUrl.slice('data:application/json;charset=utf-8,'.length)
      )
    );
    assert.equal(parsedSub.planId, 'gdevelop_startup');
  });

  it('preload XHR patch intercepts target GETs asynchronously and triggers onload', async () => {
    class FakeXHR {
      constructor() {
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
        this.response = '';
        this.onload = null;
        this.onreadystatechange = null;
      }
      open(method, url) {
        this.method = method;
        this.url = url;
      }
      send() {
        // Overridden by patchXhr
      }
    }

    const scope = {
      location: { href: 'https://editor.gdevelop.io/' },
      Response: TestResponse,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      XMLHttpRequest: FakeXHR,
    };

    preload.installRendererHook(scope);

    const xhr = new scope.XMLHttpRequest();
    xhr.open('GET', 'https://api.gdevelop.io/usage/limits');

    await new Promise(resolve => {
      xhr.onload = () => {
        assert.equal(xhr.status, 200);
        const data = JSON.parse(xhr.responseText);
        assert.ok(data.capabilities);
        assert.equal(data.capabilities.cloudProjects.maximumCount, 999);
        resolve();
      };
      xhr.send();
    });
  });
});

describe('integration: axios-style XHR behavior (onreadystatechange + passthrough)', () => {
  let server;
  let serverPort;
  let serverHits = [];

  before(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        serverHits.push({ method: req.method, url: req.url, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ live: true, echo: body || null }));
      });
    });
    await new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  function axiosLikeXhrScope(capture) {
    // Minimal XHR double speaking the axios contract: open/send,
    // onreadystatechange driven to readyState 4, responseText readable.
    // Non-spoofed sends perform a REAL http request to the live server.
    class AxiosLikeXHR {
      constructor() {
        this.readyState = 0;
        this.status = 0;
        this.responseText = '';
        this.onreadystatechange = null;
      }
      open(method, url, async = true) {
        this.method = method;
        this.url = url;
        this.readyState = 1;
      }
      setRequestHeader() {}
      send(body) {
        const impl = this.__heretekSend || this.__plainSend;
        return impl.call(this, body);
      }
      __plainSend(body) {
        const self = this;
        const u = new URL(this.url);
        const req = http.request(
          {
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: this.method,
          },
          res => {
            let data = '';
            res.on('data', c => (data += c));
            res.on('end', () => {
              self.status = res.statusCode;
              self.responseText = data;
              self.readyState = 4;
              capture.push({ url: self.url, via: 'live' });
              if (typeof self.onreadystatechange === 'function')
                self.onreadystatechange();
            });
          }
        );
        req.on('error', () => {
          self.status = 0;
          self.readyState = 4;
          if (typeof self.onreadystatechange === 'function')
            self.onreadystatechange();
        });
        if (body) req.write(body);
        req.end();
      }
    }
    // Stash the plain sender where the preload patch can chain to it.
    const scope = {
      location: { href: 'https://editor.gdevelop.io/' },
      Response: TestResponse,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      XMLHttpRequest: AxiosLikeXHR,
    };
    // patchXhr wraps prototype.open/send: spoofed URLs short-circuit,
    // everything else falls through to the live __plainSend above.
    preload.installRendererHook(scope);
    return scope;
  }

  it('axios-style client receives spoofed limits via onreadystatechange', async () => {
    const capture = [];
    const scope = axiosLikeXhrScope(capture);
    const xhr = new scope.XMLHttpRequest();
    xhr.open('GET', 'https://api.gdevelop.io/usage/limits');
    // Emulate axios: it sets responseType + reads on readyState 4.
    const done = new Promise(resolve => {
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) resolve();
      };
    });
    xhr.send();
    await done;
    assert.equal(xhr.status, 200);
    const data = JSON.parse(xhr.responseText);
    assert.equal(data.capabilities.cloudProjects.maximumCount, 999);
  });

  it('non-spoofed XHR passes through to a live server untouched', async () => {
    serverHits = [];
    const capture = [];
    const scope = axiosLikeXhrScope(capture);
    const xhr = new scope.XMLHttpRequest();
    const target = `http://127.0.0.1:${serverPort}/api/live-check`;
    xhr.open('POST', target);
    const done = new Promise(resolve => {
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) resolve();
      };
    });
    xhr.send(JSON.stringify({ hello: 'world' }));
    await done;
    assert.equal(xhr.status, 200);
    const data = JSON.parse(xhr.responseText);
    assert.equal(data.live, true);
    assert.equal(serverHits.length, 1);
    assert.equal(serverHits[0].url, '/api/live-check');
  });

  it('mutation to a spoofed path delegates to the original fetch (never spoofed)', async () => {
    const calls = [];
    const scope = {
      location: { href: 'https://editor.gdevelop.io/' },
      Response: TestResponse,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      fetch: async input => {
        calls.push(typeof input === 'string' ? input : input.url);
        return new TestResponse(JSON.stringify({ delegated: true }), {
          status: 201,
        });
      },
    };
    preload.installRendererHook(scope);
    const res = await scope.fetch('https://api.gdevelop.io/usage/limits', {
      method: 'POST',
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).delegated, true);
    assert.equal(calls.length, 1);
  });
});
