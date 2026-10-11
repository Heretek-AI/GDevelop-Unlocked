// Phase 1 seam: Electron hookability + absence of plugin architecture.
// Audit: `electron-app/app/main.js:174-187` (webPreferences),
// `Utils/UrlLoader.js:5-53` (gdide:// + file://), `main.js:361`
// (did-create-window), PreviewWindow.js, zero preload files.
// Also freezes the "no IDE plugin registry" verdict: `newIDE/app/src`
// must contain zero plugin-registry matches.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UPSTREAM_DIR, readUpstream, mustContain, mustMatchWord, mustBeNearLine } from './helpers.mjs';

const MAIN = 'newIDE/electron-app/app/main.js';
const URL_LOADER = 'newIDE/electron-app/app/Utils/UrlLoader.js';

function walkJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkJsFiles(abs, out);
    } else if (/\.m?js$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

describe('seam: Electron launcher hook surface', () => {
  const main = readUpstream(MAIN);
  const urlLoader = readUpstream(URL_LOADER);

  it('renderer stays hookable: nodeIntegration + no isolation + no webSecurity', () => {
    mustContain(main, 'nodeIntegration: true', {
      what: 'renderer Node access (Vector A precondition)',
    });
    mustContain(main, 'contextIsolation: false', {
      what: 'shared-global precondition for preload seed',
    });
    mustContain(main, 'webSecurity: false', {
      what: 'local-file access',
    });
  });

  it('covers window-creation funnels the hook must attach to', () => {
    mustMatchWord(main, 'createNewWindow', {
      what: 'single funnel Phase 3 hooks (~10 lines)',
    });
    mustContain(main, 'did-create-window', {
      what: 'portal pop-out coverage (main.js:361)',
    });
    mustContain(main, 'PreviewWindow', {
      what: 'preview-window coverage',
    });
  });

  it('main.js require anchor is stable (06 loader insertion point)', () => {
    // Patch 06 inserts the hook loader BEFORE this line: the wrap must
    // precede the `electron.BrowserWindow` destructure (main.js:6) or the
    // already-captured references (main.js:226, PreviewWindow.js:52)
    // escape it.
    mustBeNearLine(
      main,
      /^const electron = require\('electron'\);/,
      1,
      3,
      'electron require anchor'
    );
    mustContain(main, 'const newWindow = new BrowserWindow(options);', {
      what: 'wrapped-constructor call site',
    });
  });

  it('preview windows flow through the wrapped constructor', () => {
    const preview = readUpstream('newIDE/electron-app/app/PreviewWindow.js');
    mustContain(preview, 'new BrowserWindow(browserWindowOptions)', {
      what: 'preview constructor the hook wraps',
    });
  });

  it('UrlLoader keeps the gdide:// + file:// loading paths', () => {
    mustContain(urlLoader, 'registerGdideProtocol', {
      what: 'custom-scheme loader',
    });
    mustContain(urlLoader, 'registerBufferProtocol', {
      what: 'production gdide:// path',
    });
    mustContain(urlLoader, 'file://', { what: 'production file load' });
  });

  it('documents the auto-updater pin (hook must survive updates)', () => {
    mustContain(main, 'autoUpdater', {
      what: 'updater path Phase 3 must pin/document',
    });
  });

  it('flags any new preload file (hook-attachment point changed)', () => {
    const appDir = path.join(UPSTREAM_DIR, 'newIDE/electron-app/app');
    const withPreloadOption = walkJsFiles(appDir).filter(abs =>
      /preload\s*:/.test(fs.readFileSync(abs, 'utf8'))
    );
    assert.deepEqual(
      withPreloadOption,
      [],
      `SEAM DRIFT: upstream added a preload option: ${withPreloadOption.join(', ')}. ` +
        `Re-evaluate the Phase 3 attachment (preload-unlock.cjs) against the new loader.`
    );
  });
});

describe('seam: no IDE plugin registry (verdict freeze)', () => {
  it('newIDE/app/src contains zero plugin-registry seams', () => {
    const srcDir = path.join(UPSTREAM_DIR, 'newIDE/app/src');
    const hits = walkJsFiles(srcDir)
      .filter(abs =>
        /registerIDEPlugin|pluginRegistry|registerPlugin|extensionPoint/i.test(
          fs.readFileSync(abs, 'utf8')
        )
      )
      .map(abs => path.relative(UPSTREAM_DIR, abs));
    assert.deepEqual(
      hits,
      [],
      `SEAM DRIFT: a plugin-registry-like seam appeared: ${hits.join(', ')}. ` +
        `Re-evaluate the no-plugin-architecture verdict before building Tier-2 as a package.`
    );
  });

  it('webpack chunk-splitting convention still exists (Vector D tap)', () => {
    const index = readUpstream('newIDE/app/src/index.js');
    mustContain(index, 'webpackChunkName: "local-app"', {
      what: 'CRA chunk convention the userscript taps',
    });
    mustContain(index, 'webpackChunkName: "browser-app"', {
      what: 'web-editor chunk the userscript taps',
    });
  });
});
