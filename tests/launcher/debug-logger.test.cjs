// T02 client debug logging (issue: debug-logger subsystem): file creation,
// JSONL schema, argv/env activation, graceful fallback on invalid paths,
// zero-dependency source, renderer logger contract, hook integration, and
// the dump-debug-log CLI — all with real I/O on TMPDIR scratch, no mocks
// of the code under test.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const debugLogger = require('../../launcher/debug-logger.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const scratchDirs = [];
function mkScratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-logger-test-'));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (scratchDirs.length) {
    fs.rmSync(scratchDirs.pop(), { recursive: true, force: true });
  }
  delete process.env.HERETEK_DEBUG_LOG;
});

describe('debug-logger: activation', () => {
  it('resolves --heretek-debug-log <path> from argv first', () => {
    const p = debugLogger.resolveDebugLogPath({
      argv: ['node', 'app', '--heretek-debug-log', '/tmp/x.jsonl'],
      env: {},
    });
    assert.equal(p, '/tmp/x.jsonl');
  });

  it('falls back to HERETEK_DEBUG_LOG env', () => {
    const p = debugLogger.resolveDebugLogPath({
      argv: ['node', 'app'],
      env: { HERETEK_DEBUG_LOG: '/tmp/y.jsonl' },
    });
    assert.equal(p, '/tmp/y.jsonl');
  });

  it('is inactive when neither flag nor env is set', () => {
    assert.equal(
      debugLogger.resolveDebugLogPath({ argv: ['node', 'app'], env: {} }),
      null
    );
  });

  it('treats a flag with no path as inactive, not a crash', () => {
    assert.equal(
      debugLogger.resolveDebugLogPath({
        argv: ['node', 'app', '--heretek-debug-log'],
        env: {},
      }),
      null
    );
  });
});

describe('debug-logger: file appender', () => {
  it('creates the file and appends one JSON object per line (schema)', () => {
    const file = path.join(mkScratch(), 'app.jsonl');
    const log = debugLogger.createDebugLogger({
      logPath: file,
      source: 'main',
    });
    assert.equal(log.enabled, true);
    assert.ok(fs.existsSync(file), 'log file created eagerly');
    const rec = log.log('info', 'hook-installed', { wrapped: true });
    assert.equal(rec.level, 'info');
    assert.equal(rec.event, 'hook-installed');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(typeof parsed.ts, 'number');
    assert.equal(typeof parsed.iso, 'string');
    assert.ok(!Number.isNaN(Date.parse(parsed.iso)), 'iso parses');
    assert.equal(parsed.source, 'main');
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.event, 'hook-installed');
    assert.deepEqual(parsed.data, { wrapped: true });
  });

  it('level helpers write their own level', () => {
    const file = path.join(mkScratch(), 'levels.jsonl');
    const log = debugLogger.createDebugLogger({ logPath: file });
    log.debug('d', {});
    log.info('i', {});
    log.warn('w', {});
    log.error('e', { bad: true });
    const levels = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line).level);
    assert.deepEqual(levels, ['debug', 'info', 'warn', 'error']);
  });

  it('falls back gracefully on an invalid path (no throw, no-op writes)', () => {
    const file = path.join(mkScratch(), 'no-such-dir', 'x.jsonl');
    const log = debugLogger.createDebugLogger({ logPath: file });
    assert.equal(log.enabled, false);
    assert.ok(log.openError, 'surfaces the cause');
    assert.equal(log.log('info', 'lost-event', {}), null);
    assert.equal(log.warn('also-lost', {}), null);
    assert.ok(!fs.existsSync(file));
  });

  it('falls back gracefully when the path is a directory', () => {
    const dir = mkScratch();
    const log = debugLogger.createDebugLogger({ logPath: dir });
    assert.equal(log.enabled, false);
    assert.equal(log.log('info', 'lost', {}), null);
  });

  it('heavy sync logging stays parseable (100 rapid writes)', () => {
    const file = path.join(mkScratch(), 'heavy.jsonl');
    const log = debugLogger.createDebugLogger({ logPath: file });
    for (let i = 0; i < 100; i++) log.info('tick', { i });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 100);
    for (const line of lines) {
      const rec = JSON.parse(line);
      assert.equal(rec.event, 'tick');
      assert.equal(typeof rec.data.i, 'number');
    }
  });

  it('depends only on node builtins (zero npm deps)', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'launcher', 'debug-logger.cjs'),
      'utf8'
    );
    const required = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(
      m => m[1]
    );
    for (const name of required) {
      assert.ok(
        ['fs', 'path', 'os'].includes(name) ||
          name.startsWith('node:') ||
          name.startsWith('./'),
        `non-builtin require: ${name}`
      );
    }
    assert.ok(!src.includes('node_modules'));
  });
});

describe('debug-logger: hook integration', () => {
  function makeFakeElectron() {
    const listeners = {};
    const webRequests = [];
    class FakeWindow {
      constructor(options) {
        this.options = options;
      }
    }
    return {
      electron: {
        app: { on: (event, cb) => (listeners[event] = cb) },
        session: {
          defaultSession: {
            webRequest: {
              onBeforeRequest: (filter, cb) =>
                webRequests.push({ filter, cb }),
            },
          },
        },
        BrowserWindow: FakeWindow,
      },
      listeners,
      webRequests,
    };
  }

  it('logs install + window creation, and flags hosted api attempts', () => {
    const hook = require('../../launcher/heretek-hook.cjs');
    const file = path.join(mkScratch(), 'hook.jsonl');
    const debug = debugLogger.createDebugLogger({
      logPath: file,
      source: 'main',
    });
    const quiet = { info: () => {}, warn: () => {}, error: () => {} };
    const { electron, listeners, webRequests } = makeFakeElectron();
    const result = hook.installPreloadHook(electron, {
      logger: quiet,
      skipUpdaterWatch: true,
      debugLogger: debug,
    });
    assert.equal(result.debugEnabled, true);

    const contents = {
      once: (event, cb) => (contents._loaded = cb),
      on: () => {},
      executeJavaScript: () => Promise.resolve(true),
    };
    listeners['browser-window-created']({}, { webContents: contents });
    contents._loaded();

    const handler = webRequests[0].cb;
    handler(
      { url: 'https://api.gdevelop.io/generation', method: 'POST' },
      () => {}
    );
    handler(
      { url: 'https://api.gdevelop.io/usage/limits?userId=x', method: 'GET' },
      () => {}
    );

    const events = fs
      .readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    const names = events.map(e => e.event);
    assert.ok(names.includes('hook-installed'), 'install recorded');
    assert.ok(names.includes('window-created'), 'window creation recorded');
    const hosted = events.find(e => e.event === 'hosted-api-attempt');
    assert.ok(hosted, 'hosted attempt flagged');
    assert.equal(hosted.level, 'warn');
    assert.ok(hosted.data.url.includes('api.gdevelop.io'));
  });
});

describe('debug-logger: renderer logger (preload)', () => {
  function makeRendererScope() {
    const handlers = {};
    const calls = [];
    return {
      scope: {
        location: { href: 'https://editor.gdevelop.io/' },
        addEventListener: (type, cb) => (handlers[type] = cb),
        console: {
          error: (...args) => calls.push(['error', ...args]),
          warn: (...args) => calls.push(['warn', ...args]),
        },
      },
      handlers,
      calls,
    };
  }

  it('exposes window.__HERETEK_LOGGER__ and records console + errors', () => {
    const preload = require('../../launcher/preload-unlock.cjs');
    const { scope, handlers, calls } = makeRendererScope();
    preload.installRendererHook(scope);
    const rl = scope.__HERETEK_LOGGER__;
    assert.ok(rl, '__HERETEK_LOGGER__ exposed');
    assert.ok(Array.isArray(rl.events));

    scope.console.error('boom', { code: 7 });
    assert.deepEqual(calls, [['error', 'boom', { code: 7 }]]);
    const consoleRec = rl.events.find(e => e.event === 'console-error');
    assert.ok(consoleRec, 'console.error intercepted');
    assert.equal(consoleRec.level, 'error');
    assert.equal(consoleRec.source, 'renderer');

    handlers.error({ message: 'kaboom', filename: 'app.js' });
    assert.ok(
      rl.events.some(
        e => e.event === 'renderer-error' && e.data.message === 'kaboom'
      )
    );
    handlers.unhandledrejection({ reason: 'nope' });
    assert.ok(rl.events.some(e => e.event === 'unhandled-rejection'));

    const pushed = rl.push('debug', 'custom', { n: 1 });
    assert.equal(pushed.event, 'custom');
    assert.equal(typeof pushed.ts, 'number');
  });

  it('caps the in-memory buffer instead of growing forever', () => {
    const preload = require('../../launcher/preload-unlock.cjs');
    const { scope } = makeRendererScope();
    preload.installRendererHook(scope);
    for (let i = 0; i < 600; i++) scope.__HERETEK_LOGGER__.push('debug', 'x', {});
    assert.ok(scope.__HERETEK_LOGGER__.events.length <= 500);
  });

  it('renderer logger survives the vm-sandbox fallback path', () => {
    const preload = require('../../launcher/preload-unlock.cjs');
    const scope = {
      location: { href: 'https://editor.gdevelop.io/' },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    };
    const sandbox = {
      window: scope,
      URL,
      Promise,
      JSON,
      Object,
      setTimeout,
    };
    vm.createContext(sandbox);
    vm.runInContext(preload.getRendererFallbackSource(), sandbox);
    assert.ok(sandbox.window.__HERETEK_LOGGER__, 'logger in fallback seed');
    assert.ok(Array.isArray(sandbox.window.__HERETEK_LOGGER__.events));
  });
});

describe('debug-logger: dump-debug-log CLI', () => {
  function writeFixture(dir) {
    const file = path.join(dir, 'fixture.jsonl');
    const recs = [
      {
        ts: 1,
        iso: '2026-10-12T00:00:00.000Z',
        source: 'main',
        level: 'info',
        event: 'hook-installed',
        data: {},
      },
      {
        ts: 2,
        iso: '2026-10-12T00:00:01.000Z',
        source: 'renderer',
        level: 'error',
        event: 'renderer-error',
        data: { requestId: 'req-1' },
      },
      {
        ts: 3,
        iso: '2026-10-12T00:00:02.000Z',
        source: 'main',
        level: 'warn',
        event: 'hosted-api-attempt',
        data: { requestId: 'req-1', url: 'https://api.gdevelop.io/x' },
      },
    ];
    fs.writeFileSync(
      file,
      recs.map(r => JSON.stringify(r)).join('\n') + '\n{broken\n'
    );
    return file;
  }

  function dump(args) {
    return spawnSync('node', [path.join(ROOT, 'scripts', 'dump-debug-log.mjs'), ...args], {
      encoding: 'utf8',
    });
  }

  it('filters by event, level, and request id; missing file exits 2', () => {
    const file = writeFixture(mkScratch());
    let r = dump([file, '--event', 'renderer-error']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('renderer-error'));
    assert.ok(!r.stdout.includes('hook-installed'));

    r = dump([file, '--level', 'warn']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('hosted-api-attempt'));
    assert.ok(!r.stdout.includes('renderer-error'));

    r = dump([file, '--request', 'req-1']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('renderer-error'));
    assert.ok(r.stdout.includes('hosted-api-attempt'));
    assert.ok(!r.stdout.includes('hook-installed'));

    r = dump([path.join(ROOT, 'does-not-exist.jsonl')]);
    assert.equal(r.status, 2);
  });
});
