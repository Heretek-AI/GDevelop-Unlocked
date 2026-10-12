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

// In-memory renderer log (T02): the main-process JSONL appender cannot be
// reached from here, so renderer events buffer on
// `window.__HERETEK_LOGGER__` (capped) for inspection via
// executeJavaScript / smoke. Fully self-contained (no module-scope frees)
// so it embeds into the did-finish-load fallback source. `Date` is probed,
// not assumed: exotic realms may not provide it.
function createRendererLogger(scope) {
  var events = [];
  var MAX_RENDERER_LOG_EVENTS = 500;
  function now() {
    try {
      if (typeof Date !== 'undefined' && Date && typeof Date.now === 'function')
        return Date.now();
    } catch (error) {
      // No clock: fall through to 0.
    }
    return 0;
  }
  function isoFor(ts) {
    try {
      if (typeof Date !== 'undefined' && Date)
        return new Date(ts).toISOString();
    } catch (error) {
      // Leave iso empty rather than breaking the log path.
    }
    return '';
  }
  function pushRecord(level, event, data) {
    var ts = now();
    var record = {
      ts: ts,
      iso: isoFor(ts),
      source: 'renderer',
      level: level,
      event: event,
      data: data && typeof data === 'object' ? data : {},
    };
    try {
      events.push(record);
      while (events.length > MAX_RENDERER_LOG_EVENTS) events.shift();
    } catch (error) {
      // Observability only.
    }
    return record;
  }
  return {
    events: events,
    push: pushRecord,
    debug: function rendererLogDebug(event, data) {
      return pushRecord('debug', event, data);
    },
    info: function rendererLogInfo(event, data) {
      return pushRecord('info', event, data);
    },
    warn: function rendererLogWarn(event, data) {
      return pushRecord('warn', event, data);
    },
    error: function rendererLogError(event, data) {
      return pushRecord('error', event, data);
    },
  };
}

function installRendererLogger(scope) {
  var rendererLogger = createRendererLogger(scope);
  try {
    scope.__HERETEK_LOGGER__ = rendererLogger;
  } catch (error) {
    return rendererLogger;
  }
  // Renderer crash observability: hook first, before wrapping console, so
  // a failure below still leaves the error taps installed.
  try {
    if (scope && typeof scope.addEventListener === 'function') {
      scope.addEventListener('error', function heretekRendererError(event) {
        pushRendererError(rendererLogger, event);
      });
      scope.addEventListener('unhandledrejection', function heretekUnhandledRejection(event) {
        var reason =
          event && event.reason !== undefined ? event.reason : event;
        rendererLogger.error('unhandled-rejection', {
          reason: reason instanceof Error ? reason.message : String(reason),
        });
      });
    }
  } catch (error) {
    // Taps are best-effort.
  }
  // Intercept console.error/warn: record the call, then pass through so
  // devtools output is unchanged.
  try {
    if (scope && scope.console) {
      ['error', 'warn'].forEach(function tapConsoleLevel(level) {
        var original = scope.console[level];
        if (typeof original !== 'function') return;
        scope.console[level] = function heretekConsoleTap() {
          var args = Array.prototype.slice.call(arguments);
          rendererLogger[level === 'error' ? 'error' : 'warn'](
            level === 'error' ? 'console-error' : 'console-warn',
            { args: args.map(safeConsoleArg) }
          );
          return original.apply(this, args);
        };
      });
    }
  } catch (error) {
    // Never break console.
  }
  return rendererLogger;
}

function pushRendererError(rendererLogger, event) {
  var message = '';
  try {
    if (event) {
      if (typeof event.message === 'string') message = event.message;
      else message = String(event);
    }
  } catch (error) {
    message = '';
  }
  var data = { message: message };
  try {
    if (event && typeof event.filename === 'string')
      data.filename = event.filename;
    if (event && typeof event.lineno === 'number') data.lineno = event.lineno;
  } catch (error) {
    // Keep the message-only record.
  }
  rendererLogger.error('renderer-error', data);
}

function safeConsoleArg(value) {
  try {
    if (value instanceof Error)
      return { error: value.message, stack: String(value.stack).slice(0, 500) };
    if (value && typeof value === 'object') {
      return JSON.parse(JSON.stringify(value), function sanitizeKey(k, v) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype')
          return undefined;
        return v;
      });
    }
    if (typeof value === 'function') return '[function]';
    if (typeof value === 'undefined') return '[undefined]';
    return value;
  } catch (error) {
    return '[unserializable]';
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
  const state = {
    readyState: 4,
    status: 200,
    statusText: 'OK',
    responseText: text,
    response: xhr.responseType === 'json' ? body : text,
  };
  // Real XHR state attributes are getter-only prototype accessors:
  // assignment throws in strict code but silently no-ops in sloppy code,
  // so a try/assign/catch leaves readyState at 1 there and the consumer
  // never settles (seen live on Electron 32, issue #12). Always shadow
  // per instance instead of assigning.
  Object.keys(state).forEach(function shadowXhrState(name) {
    Object.defineProperty(xhr, name, {
      value: state[name],
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });
  // Remembered so the next open() on this instance can remove them.
  xhr.__heretekShadowed = Object.keys(state);
}

function fireXhrLoad(xhr) {
  // A real XHR is an EventTarget: dispatching reaches the on* handler
  // attributes AND addEventListener listeners, in the order a real
  // response fires them (axios < 0.22 settles on readystatechange, newer
  // on loadend). Fakes without dispatchEvent get their handler
  // properties called directly.
  const canDispatch =
    typeof xhr.dispatchEvent === 'function' && typeof Event === 'function';
  ['readystatechange', 'load', 'loadend'].forEach(function fire(type) {
    try {
      if (canDispatch) xhr.dispatchEvent(new Event(type));
      else if (typeof xhr['on' + type] === 'function') xhr['on' + type]();
    } catch (error) {
      // Listener errors must not break the spoof.
    }
  });
}

function patchXhr(XHRClass, scope) {
  const originalOpen = XHRClass.prototype.open;
  const originalSend = XHRClass.prototype.send;
  XHRClass.prototype.open = function heretekOpen(method, url) {
    // open() re-initializes an XHR: drop the state a previous spoofed
    // response shadowed onto this instance, so the native getters show
    // through again for whatever request comes next.
    if (this.__heretekShadowed) {
      const self = this;
      this.__heretekShadowed.forEach(function unshadowXhrState(name) {
        delete self[name];
      });
      this.__heretekShadowed = null;
    }
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
  installRendererLogger(scope);
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
  try {
    if (
      scope &&
      scope.contextBridge &&
      typeof scope.contextBridge.exposeInMainWorld === 'function' &&
      typeof process !== 'undefined' &&
      process &&
      process.contextIsolated
    ) {
      scope.contextBridge.exposeInMainWorld('__HERETEK__', {
        unlocked: true,
        planId: 'gdevelop_startup',
        source: 'context-bridge',
      });
    }
  } catch (error) {
    // Context bridge fallback is best-effort.
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
  'createRendererLogger',
  'pushRendererError',
  'safeConsoleArg',
  'installRendererLogger',
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
  // 'use strict' keeps the embedded functions on the semantics they were
  // written and unit-tested under (this module is strict); Function#toString
  // does not carry the directive across.
  return (
    "(function(){\n'use strict';\n" +
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
  createRendererLogger,
  pushRendererError,
  safeConsoleArg,
  installRendererLogger,
  createFetchWrapper,
  setXhrResponse,
  fireXhrLoad,
  patchXhr,
  installRendererHook,
  getRendererFallbackSource,
  FALLBACK_EMBEDDED_CONSTS,
  FALLBACK_EMBEDDED_FUNCTIONS,
};
