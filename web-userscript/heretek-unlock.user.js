// ==UserScript==
// @name         GDevelop-Unlocked (web demo)
// @namespace    https://github.com/Heretek-AI/GDevelop-Unlocked
// @version      0.1.0
// @description  DEMO ONLY: Tier-1 unlock (?Tier-2 BYOK config widget) on editor.gdevelop.io. Not a delivery path for the Studio loop.
// @match        https://editor.gdevelop.io/*
// @grant        none
// @run-at       document-start
// ==/UserScript==
//
// DEMO ONLY — see web-userscript/README.md. Known limits:
//   - Ollama CORS: this page is https, Ollama is http://localhost:11434.
//     Start Ollama with OLLAMA_ORIGINS=https://editor.gdevelop.io (or a
//     CORS proxy), otherwise the browser blocks the BYOK calls.
//   - LAN preview is unreachable from the hosted page (private IPs are not
//     routable from editor.gdevelop.io); use desktop for wifi preview.
//   - No filesystem access; every web rebuild may change chunk hashes and
//     break the webpackChunk tap below (re-install wrappers on each push).
(function () {
  'use strict';

  var USAGE_BASE = 'https://api.gdevelop.io/usage';
  var LIMITS_PATH = '/limits';
  var SUB_PATH = '/subscription-v2';

  var UNLOCKED_SUBSCRIPTION = {
    userId: 'local-byok-user',
    planId: 'gdevelop_startup',
    pricingSystemId: 'HERETEK_UNLOCKED',
    createdAt: 0,
    updatedAt: 0,
  };

  var UNLOCKED_CAPABILITIES = {
    analytics: { sessions: true, players: true, retention: true, sessionsTimeStats: true, platforms: true },
    cloudProjects: { maximumCount: 999, canMaximumCountBeIncreased: true, maximumGuestCollaboratorsPerProject: 99, projectRestorationTimeWindowInSeconds: -1, deletedProjectRetentionInDays: 365 },
    leaderboards: { maximumCountPerGame: 999, canMaximumCountPerGameBeIncreased: true, themeCustomizationCapabilities: 'FULL', canUseCustomCss: true, canDisableLoginInLeaderboard: true },
    multiplayer: { lobbiesCount: 99, maxPlayersPerLobby: 64, themeCustomizationCapabilities: 'FULL' },
    versionHistory: { enabled: true, retentionDays: 365 },
    ai: { availablePresets: [], versionHistory: { enabled: true, retentionDays: 365 } },
  };

  function isSpoofed(url, method) {
    if (typeof url !== 'string') return false;
    if ((method || 'GET').toUpperCase() !== 'GET') return false;
    if (url.indexOf(USAGE_BASE) !== 0) return false;
    var rest = url.slice(USAGE_BASE.length);
    return (
      rest === LIMITS_PATH || rest.indexOf(LIMITS_PATH + '?') === 0 ||
      rest === SUB_PATH || rest.indexOf(SUB_PATH + '?') === 0
    );
  }

  function bodyFor(url) {
    var rest = url.slice(USAGE_BASE.length);
    if (rest === LIMITS_PATH || rest.indexOf(LIMITS_PATH + '?') === 0) {
      return { quotas: {}, capabilities: UNLOCKED_CAPABILITIES, credits: { userBalance: { amount: 999999 }, prices: {}, purchasableQuantities: [] } };
    }
    return UNLOCKED_SUBSCRIPTION;
  }

  function absUrl(url) {
    if (/^https?:\/\//.test(url)) return url;
    try {
      return new URL(url, location.href).toString();
    } catch (e) {
      return null;
    }
  }

  function installWrappers() {
    if (window.__HERETEK_WEB__ && window.__HERETEK_WEB__.wrapped) return;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var raw = typeof input === 'string' ? input : input && input.url;
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = absUrl(raw);
      if (url && isSpoofed(url, method)) {
        return Promise.resolve(
          new Response(JSON.stringify(bodyFor(url)), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }
      return originalFetch(input, init);
    };

    var XHR = window.XMLHttpRequest;
    if (XHR && !XHR.prototype.__heretekWrapped) {
      var origOpen = XHR.prototype.open;
      var origSend = XHR.prototype.send;
      XHR.prototype.open = function (method, url) {
        this.__heretekMethod = method;
        this.__heretekUrl = url;
        return origOpen.apply(this, arguments);
      };
      XHR.prototype.send = function () {
        var self = this;
        var args = arguments;
        var url = absUrl(this.__heretekUrl);
        if (url && isSpoofed(url, this.__heretekMethod)) {
          var text = JSON.stringify(bodyFor(url));
          setTimeout(function () {
            self.readyState = 4;
            self.status = 200;
            try {
              self.responseText = text;
              self.response = text;
            } catch (e) {
              /* getter-only prototype: best effort */
            }
            if (self.onreadystatechange) self.onreadystatechange();
            if (self.onload) self.onload();
          }, 0);
          return;
        }
        return origSend.apply(this, args);
      };
      XHR.prototype.__heretekWrapped = true;
    }
    window.__HERETEK_WEB__ = { unlocked: true, wrapped: true };
  }

  // webpackChunk tap: every lazily pushed chunk re-runs the app bootstrap
  // paths that capture fetch/XHR, so re-install (idempotent) on each push.
  // Hash churn breaks module-index surgery on every rebuild — this tap
  // deliberately does NOT touch module factories, only re-applies the
  // transport wrappers above.
  function tapWebpackChunks() {
    try {
      Object.keys(window)
        .filter(function (k) { return k.indexOf('webpackChunk') === 0; })
        .forEach(function (k) {
          var arr = window[k];
          if (arr && arr.push && !arr.__heretekTapped) {
            var origPush = arr.push.bind(arr);
            arr.push = function () {
              var r = origPush.apply(null, arguments);
              installWrappers();
              return r;
            };
            arr.__heretekTapped = true;
          }
        });
    } catch (e) {
      /* DOM not ready or chunks absent yet — retry below */
    }
  }

  // Minimal BYOK config widget: persists the custom endpoint base URL to
  // the same `gd-custom-ai-config` key the desktop client reads. Cosmetic
  // demo aid — the Studio loop itself is desktop-only.
  function mountConfigWidget() {
    if (document.getElementById('heretek-byok-demo')) return;
    var box = document.createElement('div');
    box.id = 'heretek-byok-demo';
    box.style.cssText =
      'position:fixed;bottom:12px;right:12px;z-index:99999;background:#111;color:#eee;' +
      'border:1px solid #6c6;font:12px sans-serif;padding:8px 10px;border-radius:8px;opacity:.92';
    box.innerHTML =
      '<b>Heretek web demo</b> (Tier-1 unlocked)<br/>' +
      '<label>BYOK base URL <input id="heretek-base" size="28" placeholder="http://localhost:11434/v1"/></label> ' +
      '<button id="heretek-save">Save</button> <span id="heretek-msg"></span>';
    document.documentElement.appendChild(box);
    document.getElementById('heretek-save').onclick = function () {
      var base = document.getElementById('heretek-base').value.trim();
      try {
        var raw = localStorage.getItem('gd-custom-ai-config');
        var cfg = raw ? JSON.parse(raw) : {};
        cfg.enabled = true;
        cfg.baseUrl = base;
        localStorage.setItem('gd-custom-ai-config', JSON.stringify(cfg));
        document.getElementById('heretek-msg').textContent = 'saved (needs Ollama CORS ORIGINS, see header)';
      } catch (e) {
        document.getElementById('heretek-msg').textContent = 'save failed: ' + e.message;
      }
    };
  }

  installWrappers();
  tapWebpackChunks();
  var chunksTimer = setInterval(function () {
    tapWebpackChunks();
    if (document.documentElement) {
      mountConfigWidget();
      clearInterval(chunksTimer);
    }
  }, 500);
})();
