// CI helper: turn a `--heretek-smoke` run log into a pass/fail gate.
//
//   node scripts/assert-smoke-verdict.mjs <smoke.log>
//
// The app prints one `HERETEK_SMOKE:<json>` line (launcher/heretek-hook.cjs)
// among Chromium noise. The last such line is the verdict. Exit 0 only for
// `ok: true`; a log with no verdict line fails too (the app never reached
// the probe — crash, no window, or the hook is not installed).
import fs from 'node:fs';

const MARKER = 'HERETEK_SMOKE:';

export function readVerdict(logText) {
  const lines = logText.split(/\r?\n/).filter(line => line.includes(MARKER));
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  return JSON.parse(last.slice(last.indexOf(MARKER) + MARKER.length));
}

const logPath = process.argv[2];
if (logPath) {
  if (!fs.existsSync(logPath)) {
    console.error(`[smoke] log not found: ${logPath}`);
    process.exit(2);
  }
  // latin1: Chromium writes arbitrary bytes; never let decoding throw.
  const verdict = readVerdict(fs.readFileSync(logPath, 'latin1'));
  if (!verdict) {
    console.error(
      `[smoke] no ${MARKER} line in ${logPath} — the app never reported a verdict.`
    );
    process.exit(1);
  }
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.ok !== true) {
    console.error('[smoke] FAILED:', verdict.failures);
    process.exit(1);
  }
  console.log('[smoke] passed.');
}
