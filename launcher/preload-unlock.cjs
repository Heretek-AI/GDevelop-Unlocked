// Phase 3 renderer hook (issue #3): preload seed + fetch/XHR spoof.
//
// Loaded via `webPreferences.preload` (injected by heretek-hook.cjs into
// every BrowserWindow before `electron.BrowserWindow` is destructured).
// Runs before the webpack bundle, with full Node + DOM access
// (`nodeIntegration:true, contextIsolation:false` — frozen by
// tests/seams/electron.seam.test.mjs), sharing the renderer global.
//
// Mechanism (why not Module._load): production renderers execute a
// webpack bundle, not Node modules, so intercepting `Module._load` cannot
// reach `hasValidSubscriptionPlan`. The app's axios client rides on XHR
// and the provider layer (`AuthenticatedUserProvider`) hydrates
// `AuthenticatedUserContext` from GET /limits + GET /subscription-v2 —
// spoofing exactly those two responses unlocks every downstream gate
// (SubscriptionChecker, logo/watermark guards, %16, debugger) on a
// stock unpatched build. Nothing else is intercepted.
//
// Testability: all logic is exported pure functions; the file auto-installs
// only when `window` exists. tests/launcher/preload.test.cjs pins behavior
// and evaluates getRendererFallbackSource() in a vm sandbox (used by
// heretek-hook.cjs for pop-out windows the preload missed).
'use strict';

const {
  USAGE_API_BASE,
  SPOOFED_LIMITS_PATH,
  SPOOFED_SUBSCRIPTION_PATH,
  UNLOCKED_SUBSCRIPTION,
  UNLOCKED_CAPABILITIES,
  buildSubscriptionPayload,
  buildLimitsPayload,
  isSpoofedUsageUrl,
  spoofBodyForUrl,
} = require('./unlock-payloads.cjs');

function seedIdentity(scope) {
  scope.__HERETEK__ = {
    unlocked: true,
    planId: 'gdevelop_startup',
    source: 'preload-unlock',
    spoofedRequests: [],
  };
}

function resolveUrlSafe(url, scope) {
  if (!url || typeof url !== 'string') return null;
  if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0)
    return url;
  try {
    const base =
      scope && scope.location && scope.location.href
        ? scope.location.href
        : USAGE_API_BASE + '/';
    return new URL(url, base).toString();
  } catch (error) {
    return null;
  }
}

function spoofBodyForRequest(rawUrl, method, scope) {
  const url = resolveUrlSafe(rawUrl, scope);
  if (!url) return null;
  return spoofBodyForUrl(url, method);
}

function recordSpoof(scope, url) {
  try {
    if (scope && scope.__HERETEK__ && scope.__HERETEK__.spoofedRequests) {
      scope.__HERETEK__.spoofedRequests.push(url);
    }
  } catch (error) {
    // Observability only — never break the request path.
  }
}

function createFetchWrapper(originalFetch, scope) {
  return function heretekFetch(input, init) {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input && input.url
          ? input.url
          : null;
    const method =
      (init && init.method) || (input && input.method) || 'GET';
    const body = spoofBodyForRequest(rawUrl, method, scope);
    if (body !== null) {
      recordSpoof(scope, resolveUrlSafe(rawUrl, scope));
      return Promise.resolve(
        new scope.Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return originalFetch.apply(this, arguments);
  };
}

function setXhrResponse(xhr, body) {
  const text = JSON.stringify(body);
  try {
    xhr.readyState = 4;
    xhr.status = 200;
    xhr.responseText = text;
    xhr.response = text;
  } catch (error) {
    // Real XHR attributes are getter-only on the prototype: shadow them
    // per-instance instead.
    Object.defineProperty(xhr, 'readyState', {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
    Object.defineProperty(xhr, 'responseText', {
      value: text,
      configurable: true,
    });
    Object.defineProperty(xhr, 'response', {
      value: text,
      configurable: true,
    });
  }
}

function fireXhrLoad(xhr) {
  if (typeof xhr.onreadystatechange === 'function') {
    try {
      xhr.onreadystatechange();
    } catch (error) {
      // Listener errors must not break the spoof.
    }
  }
  if (typeof xhr.onload === 'function') {
    try {
      xhr.onload();
    } catch (error) {
      // Listener errors must not break the spoof.
    }
  }
}

function patchXhr(XHRClass, scope) {
  const originalOpen = XHRClass.prototype.open;
  const originalSend = XHRClass.prototype.send;
  XHRClass.prototype.open = function heretekOpen(method, url) {
    this.__heretekMethod = method;
    this.__heretekUrl = url;
    return originalOpen.apply(this, arguments);
  };
  XHRClass.prototype.send = function heretekSend() {
    const args = arguments;
    const self = this;
    const body = spoofBodyForRequest(
      this.__heretekUrl,
      this.__heretekMethod,
      scope
    );
    if (body !== null) {
      recordSpoof(scope, resolveUrlSafe(this.__heretekUrl, scope));
      const deliver = function deliverSpoofedXhrResponse() {
        setXhrResponse(self, body);
        fireXhrLoad(self);
      };
      const scheduler =
        scope && typeof scope.setTimeout === 'function'
          ? scope.setTimeout.bind(scope)
          : typeof globalThis.setTimeout === 'function'
            ? globalThis.setTimeout.bind(globalThis)
            : null;
      if (scheduler) scheduler(deliver, 0);
      else deliver();
      return;
    }
    return originalSend.apply(this, args);
  };
  return XHRClass;
}

function installRendererHook(scope) {
  seedIdentity(scope);
  if (scope.fetch) {
    try {
      scope.fetch = createFetchWrapper(scope.fetch.bind(scope), scope);
    } catch (error) {
      // Leave the original fetch alone rather than breaking networking.
    }
  }
  if (scope.XMLHttpRequest) {
    try {
      patchXhr(scope.XMLHttpRequest, scope);
    } catch (error) {
      // Leave the original XHR alone rather than breaking networking.
    }
  }
  return scope.__HERETEK__;
}

// Names embedded into pop-out/preview windows that missed the preload
// (heretek-hook.cjs, did-finish-load fallback). Every name below must be
// self-contained apart from the embedded consts — the vm-sandbox test in
// tests/launcher/preload.test.cjs fails if a closure leaks.
const FALLBACK_EMBEDDED_CONSTS = [
  'USAGE_API_BASE',
  'SPOOFED_LIMITS_PATH',
  'SPOOFED_SUBSCRIPTION_PATH',
  'UNLOCKED_SUBSCRIPTION',
  'UNLOCKED_CAPABILITIES',
];
const FALLBACK_EMBEDDED_FUNCTIONS = [
  'isSpoofedUsageUrl',
  'buildSubscriptionPayload',
  'buildLimitsPayload',
  'spoofBodyForUrl',
  'seedIdentity',
  'resolveUrlSafe',
  'spoofBodyForRequest',
  'recordSpoof',
  'createFetchWrapper',
  'setXhrResponse',
  'fireXhrLoad',
  'patchXhr',
  'installRendererHook',
];

function getRendererFallbackSource() {
  const payloads = require('./unlock-payloads.cjs');
  const preload = module.exports;
  const namespace = Object.assign({}, payloads, preload);
  const consts = FALLBACK_EMBEDDED_CONSTS.map(
    name => `var ${name} = ${JSON.stringify(payloads[name])};`
  ).join('\n');
  const fns = FALLBACK_EMBEDDED_FUNCTIONS.map(name => {
    const fn = namespace[name];
    if (typeof fn !== 'function')
      throw new Error(`[heretek] cannot embed missing function: ${name}`);
    return fn.toString();
  }).join('\n');
  return (
    '(function(){\n' +
    consts +
    '\n' +
    fns +
    '\ninstallRendererHook(window);\n' +
    '})();'
  );
}

// Auto-install in a real renderer only. In Node (tests, main process)
// `window` is undefined and this module is side-effect free.
if (typeof window !== 'undefined' && window && window.document) {
  installRendererHook(window);
}

module.exports = {
  seedIdentity,
  resolveUrlSafe,
  spoofBodyForRequest,
  recordSpoof,
  createFetchWrapper,
  setXhrResponse,
  fireXhrLoad,
  patchXhr,
  installRendererHook,
  getRendererFallbackSource,
  FALLBACK_EMBEDDED_CONSTS,
  FALLBACK_EMBEDDED_FUNCTIONS,
};
