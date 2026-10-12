// Client debug logging (T02): sync JSONL file appender for the launcher.
//
// Activated only by `--heretek-debug-log <path>` or the
// `HERETEK_DEBUG_LOG` env var; without either, `resolveDebugLogPath`
// returns null and nothing is created. Every record is one JSON object
// per line: {ts, iso, source, level, event, data}.
//
// Zero npm dependencies (node builtins only — pinned by
// tests/launcher/debug-logger.test.cjs). Writes are synchronous
// `fs.appendFileSync` so a crash never loses the line that explains it.
// An invalid path disables the logger instead of throwing: every method
// becomes a no-op returning null and the cause is kept on `.error`.
'use strict';

const fs = require('fs');

const DEBUG_LOG_ARG = '--heretek-debug-log';
const DEBUG_LOG_ENV = 'HERETEK_DEBUG_LOG';

const LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * Where to log, or null when debug logging is off. The argv flag wins;
 * a flag with no following path is treated as inactive (never a crash).
 */
function resolveDebugLogPath(opts) {
  const options = opts || {};
  const argv = options.argv || process.argv;
  const env = options.env || process.env;
  const index = argv.indexOf(DEBUG_LOG_ARG);
  if (index !== -1) {
    const next = argv[index + 1];
    if (typeof next === 'string' && next.length > 0 && next.indexOf('--') !== 0)
      return next;
    return null;
  }
  const fromEnv = env[DEBUG_LOG_ENV];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

function toRecord(source, level, event, data) {
  const ts = Date.now();
  let iso = '';
  try {
    iso = new Date(ts).toISOString();
  } catch (error) {
    iso = '';
  }
  return {
    ts,
    iso,
    source,
    level,
    event,
    data: data && typeof data === 'object' ? data : {},
  };
}

function makeDisabledLogger(logPath, cause) {
  function noop() {
    return null;
  }
  return {
    enabled: false,
    logPath: logPath || null,
    openError: cause,
    log: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    close: () => {},
  };
}

/**
 * Open the JSONL appender. `logPath` missing/unwritable (absent parent
 * dir, a directory, permissions) yields a disabled logger — never throws.
 */
function createDebugLogger(opts) {
  const options = opts || {};
  const logPath = options.logPath;
  const source = options.source || 'main';
  if (typeof logPath !== 'string' || logPath.length === 0) {
    return makeDisabledLogger(
      null,
      new Error('[heretek-debug] no log path configured')
    );
  }
  try {
    // Eager probe: creates the file when missing, proves writability now
    // instead of dropping the first real event later.
    fs.appendFileSync(logPath, '');
  } catch (error) {
    return makeDisabledLogger(logPath, error);
  }
  function log(level, event, data) {
    let record;
    try {
      record = toRecord(source, level, event, data);
      fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
    } catch (error) {
      return null;
    }
    return record;
  }
  return {
    enabled: true,
    logPath,
    openError: null,
    log,
    debug: (event, data) => log('debug', event, data),
    info: (event, data) => log('info', event, data),
    warn: (event, data) => log('warn', event, data),
    error: (event, data) => log('error', event, data),
    close: () => {},
  };
}

/** Parse one JSONL line; null when malformed (callers count and skip). */
function parseDebugLogLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const record = JSON.parse(trimmed);
    if (!record || typeof record !== 'object') return null;
    return record;
  } catch (error) {
    return null;
  }
}

module.exports = {
  DEBUG_LOG_ARG,
  DEBUG_LOG_ENV,
  LEVELS,
  resolveDebugLogPath,
  createDebugLogger,
  parseDebugLogLine,
};
