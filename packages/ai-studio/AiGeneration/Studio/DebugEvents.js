// @flow
/**
 * Studio-side debug events (T02 client debug logging).
 *
 * The main-process JSONL appender (launcher/debug-logger.cjs) cannot be
 * reached from the renderer bundle, so instrumented turn events buffer on
 * `window.__HERETEK_LOGGER__` (installed by launcher/preload-unlock.cjs,
 * capped at 500 records) for inspection via executeJavaScript / smoke.
 *
 * Zero-cost when debug logging is off: every emit is guarded on the
 * logger's presence and wrapped in try/catch, so the agent loop can never
 * break because observability failed. Overlaid into the patched tree by
 * the driver (see TIER2_FILES in scripts/apply-patches.mjs) alongside the
 * other Studio modules; integrity pinned in MANIFEST.json like them.
 */

export type StudioDebugEvent =
  | '[AI_REQUEST_START]'
  | '[TOOL_CALL]'
  | '[TOOL_RESULT]'
  | '[GUARD_EVALUATE]'
  | '[REQUEST_STATE_CHANGE]';

/**
 * Push one debug record to the renderer logger when it exists.
 * No-op (never throws) when the launcher debug logger is off.
 */
export const emitStudioDebugEvent = (
  event: StudioDebugEvent,
  data?: { [string]: mixed }
): void => {
  try {
    if (typeof window === 'undefined') return;
    const target = (window: any).__HERETEK_LOGGER__;
    if (!target || typeof target.push !== 'function') return;
    target.push('debug', event, data || {});
  } catch (error) {
    // Observability only — never break the agent loop.
  }
};
