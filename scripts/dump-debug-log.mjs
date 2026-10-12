// Inspect a T02 client debug log (JSONL from launcher/debug-logger.cjs).
//
//   node scripts/dump-debug-log.mjs <logfile>
//     [--event <name>]... [--level <level>]... [--request <id>]...
//     [--json] [--limit <n>]
//
// Filters combine (AND): exact match on event and level; a request id
// matches data.requestId / data.aiRequestId / data.callId /
// data.parentAiRequestId. Default output is one human line per record;
// --json prints the filtered records as a JSON array. Malformed lines are
// skipped (count on stderr). Missing file exits 2; anything else exits 0.
import fs from 'node:fs';

const REQUEST_ID_KEYS = [
  'requestId',
  'aiRequestId',
  'callId',
  'parentAiRequestId',
];

export function parseLogText(text) {
  const records = [];
  let malformed = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object') records.push(record);
      else malformed++;
    } catch (error) {
      malformed++;
    }
  }
  return { records, malformed };
}

export function recordMatches(record, filters) {
  if (filters.events.length > 0 && !filters.events.includes(record.event))
    return false;
  if (filters.levels.length > 0 && !filters.levels.includes(record.level))
    return false;
  if (filters.requests.length > 0) {
    const data = record.data || {};
    const ids = REQUEST_ID_KEYS.map(key => data[key]).filter(
      value => typeof value === 'string'
    );
    if (!filters.requests.some(wanted => ids.includes(wanted))) return false;
  }
  return true;
}

export function filterRecords(records, filters) {
  return records.filter(record => recordMatches(record, filters));
}

export function formatRecord(record) {
  const data = record.data ? JSON.stringify(record.data) : '{}';
  return `[${record.iso || record.ts}] [${record.level}] [${record.source}] ${record.event} ${data}`;
}

function takeFlag(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) {
      values.push(args[i + 1]);
      i++;
    } else if (args[i].startsWith(name + '=')) {
      values.push(args[i].slice(name.length + 1));
    }
  }
  return values;
}

const cliArgs = process.argv.slice(2);
// Import-safe (like assert-smoke-verdict.mjs): no positional arg, no run.
const positional = cliArgs.filter(arg => !arg.startsWith('--'));
const logPath = positional[0];
if (logPath) {
  if (!fs.existsSync(logPath)) {
    console.error(`[dump-debug-log] log not found: ${logPath}`);
    process.exit(2);
  }
  const { records, malformed } = parseLogText(
    fs.readFileSync(logPath, 'utf8')
  );
  if (malformed > 0)
    console.error(`[dump-debug-log] skipped ${malformed} malformed line(s).`);
  const limitValues = takeFlag(cliArgs, '--limit');
  const limit =
    limitValues.length > 0 ? Number.parseInt(limitValues[0], 10) : -1;
  const filtered = filterRecords(records, {
    events: takeFlag(cliArgs, '--event'),
    levels: takeFlag(cliArgs, '--level'),
    requests: takeFlag(cliArgs, '--request'),
  });
  const shown = limit >= 0 ? filtered.slice(0, limit) : filtered;
  if (cliArgs.includes('--json')) {
    console.log(JSON.stringify(shown, null, 2));
  } else {
    for (const record of shown) console.log(formatRecord(record));
  }
  console.error(
    `[dump-debug-log] ${shown.length}/${records.length} record(s) shown.`
  );
}
