// Smoke-mode tests (CI E2E): flag parsing, pure verdict, and the arm
// sequence against fake Electron objects (no Electron needed).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const hook = require('../../launcher/heretek-hook.cjs');

function makeLogger() {
  const records = { info: [], warn: [], error: [] };
  return {
    logger: {
      info: msg => records.info.push(String(msg)),
      warn: msg => records.warn.push(String(msg)),
      error: msg => records.error.push(String(msg)),
    },
    records,
  };
}

const GOOD_RESULTS = {
  seed: true,
  limits: { status: 200, maxCloudProjects: 999 },
  subscription: { status: 200, planId: 'gdevelop_startup' },
  passthrough: { resolved: false, spoofed: false, error: 'fetch failed' },
  errors: [],
};

function makeFakeElectron(probeResults) {
  const listeners = {};
  let loadCb = null;
  const webContents = {
    once: (event, cb) => {
      loadCb = cb;
    },
    executeJavaScript: () => Promise.resolve(probeResults),
  };
  return {
    electron: {
      app: {
        on: (event, cb) => (listeners[event] = cb),
        whenReady: () => Promise.resolve(),
        exit: code => {
          throw new Error('app.exit should not be called in tests');
        },
      },
    },
    listeners,
    fireWindowCreated() {
      listeners['browser-window-created']({}, { webContents });
    },
    fireLoad() {
      loadCb();
    },
  };
}

describe('smoke: verdict', () => {
  it('passes unlocked transport, fails everything else', () => {
    assert.deepEqual(hook.verdictSmokeResults(GOOD_RESULTS), {
      ok: true,
      failures: [],
    });
    assert.equal(
      hook.verdictSmokeResults({ ...GOOD_RESULTS, seed: false }).ok,
      false
    );
    assert.equal(
      hook.verdictSmokeResults({
        ...GOOD_RESULTS,
        limits: { status: 200, maxCloudProjects: 3 },
      }).ok,
      false
    );
    assert.equal(
      hook.verdictSmokeResults({
        ...GOOD_RESULTS,
        subscription: { status: 200, planId: 'gdevelop_silver' },
      }).ok,
      false
    );
    assert.equal(
      hook.verdictSmokeResults({
        ...GOOD_RESULTS,
        passthrough: { resolved: true, spoofed: true, status: 200 },
      }).ok,
      false
    );
    assert.equal(hook.verdictSmokeResults(null).ok, false);
  });

  it('flag parsing ignores position after the binary', () => {
    assert.equal(hook.isSmokeMode(['node', 'app', '--heretek-smoke']), true);
    assert.equal(hook.isSmokeMode(['node', 'app']), false);
    // Packaged Electron argv has no script slot: [exe, ...userArgs].
    // The flag must be found even when it is the FIRST user argument
    // (previously slice(2) silently dropped it and smoke never armed).
    assert.equal(hook.isSmokeMode(['/tmp/e2e/app/gdevelop', '--heretek-smoke']), true);
    assert.equal(
      hook.isSmokeMode(['/tmp/e2e/app/gdevelop', '--heretek-smoke', '--no-sandbox']),
      true
    );
    assert.equal(hook.isSmokeMode(['/tmp/e2e/app/gdevelop']), false);
  });
});

describe('smoke: arm sequence', () => {
  it('prints HERETEK_SMOKE ok:true and exits 0 on unlocked build', async () => {
    const { electron, listeners, fireWindowCreated, fireLoad } =
      makeFakeElectron(GOOD_RESULTS);
    const { logger, records } = makeLogger();
    let exitCode = null;
    const armed = hook.armSmokeMode(electron, {
      argv: ['node', 'app', '--heretek-smoke'],
      logger,
      exitFn: code => (exitCode = code),
      timeoutMs: 1000,
    });
    assert.equal(armed.armed, true);
    assert.ok(listeners['browser-window-created']);
    fireWindowCreated();
    fireLoad();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(exitCode, 0);
    const line = records.info.find(l => l.startsWith('HERETEK_SMOKE:'));
    assert.ok(line, 'smoke JSON line missing');
    assert.equal(JSON.parse(line.slice('HERETEK_SMOKE:'.length)).ok, true);
  });

  it('exits 1 with failures on locked build', async () => {
    const { electron, fireWindowCreated, fireLoad } = makeFakeElectron({
      ...GOOD_RESULTS,
      seed: false,
    });
    const { logger, records } = makeLogger();
    let exitCode = null;
    hook.armSmokeMode(electron, {
      argv: ['node', 'app', '--heretek-smoke'],
      logger,
      exitFn: code => (exitCode = code),
      timeoutMs: 1000,
    });
    fireWindowCreated();
    fireLoad();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(exitCode, 1);
    const line = records.info.find(l => l.startsWith('HERETEK_SMOKE:'));
    assert.ok(JSON.parse(line.slice('HERETEK_SMOKE:'.length)).failures.length > 0);
  });

  it('exits 2 on timeout with no window', async () => {
    const { electron } = makeFakeElectron(GOOD_RESULTS);
    const { logger, records } = makeLogger();
    let exitCode = null;
    hook.armSmokeMode(electron, {
      argv: ['node', 'app', '--heretek-smoke'],
      logger,
      exitFn: code => (exitCode = code),
      timeoutMs: 30,
    });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(exitCode, 2);
    assert.ok(
      records.info.some(l => l.includes('timeout waiting for first window'))
    );
  });

  it('a failing existing-window scan is logged, and later windows still probe', async () => {
    const { electron, fireWindowCreated, fireLoad } =
      makeFakeElectron(GOOD_RESULTS);
    const { logger, records } = makeLogger();
    let exitCode = null;
    hook.armSmokeMode(electron, {
      argv: ['node', 'app', '--heretek-smoke'],
      logger,
      exitFn: code => (exitCode = code),
      timeoutMs: 1000,
      existingWindows: () => {
        throw new Error('getAllWindows unavailable');
      },
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(exitCode, null, 'scan failure must not decide the verdict');
    assert.ok(
      records.error.some(l => l.includes('existing-window scan failed'))
    );
    fireWindowCreated();
    fireLoad();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(exitCode, 0);
  });

  it('does nothing without the flag', () => {
    const { electron, listeners } = makeFakeElectron(GOOD_RESULTS);
    const { logger } = makeLogger();
    const armed = hook.armSmokeMode(electron, {
      argv: ['node', 'app'],
      logger,
      exitFn: () => {
        throw new Error('must not exit');
      },
    });
    assert.equal(armed.armed, false);
    assert.equal(listeners['browser-window-created'], undefined);
  });
});
