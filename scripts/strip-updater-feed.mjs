// Release build helper: neuter the auto-updater feed in a build tree.
//
// Upstream ships `publish: [{ provider: 'github' }]` in
// newIDE/electron-app/electron-builder-config.js, which points
// electron-updater at 4ian/GDevelop releases. An unlocked build must never
// follow that feed (it would download stock code over the patched app).
//
// The key is REPLACED with `publish: null`, not deleted. Deleting it is
// not enough: with no publish config, electron-builder (26.x,
// PublishManager.getPublishConfigsForUpdateInfo) falls back to the
// `repository` field of package.json and still writes
// resources/app-update.yml pointing at 4ian/GDevelop — found in the first
// CI-built artifact. Only an explicit `null` disables that fallback.
// Without app-update.yml the app's update check has nothing to read.
//
// Usage: node scripts/strip-updater-feed.mjs <upstream-checkout-root>
// Exits non-zero unless the evaluated config ends with `publish === null`
// (loud is better than shipping an updatable build by accident). A config
// with no `publish` key at all is NOT treated as neutered, for the reason
// above.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const CONFIG_REL = 'newIDE/electron-app/electron-builder-config.js';
const NEUTERED = /\bpublish:\s*null\b/;

function neuterPublishBlock(text) {
  const keyIdx = text.indexOf('publish:');
  if (keyIdx === -1) throw new Error('no `publish:` key found');
  const bracketIdx = text.indexOf('[', keyIdx);
  if (bracketIdx === -1) throw new Error('`publish:` has no array value');
  let depth = 0;
  let end = -1;
  for (let i = bracketIdx; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error('unterminated `publish:` array');
  return text.slice(0, keyIdx) + 'publish: null' + text.slice(end + 1);
}

/** Evaluate the build config the way electron-builder will. */
function loadedPublishValue(abs) {
  const require = createRequire(import.meta.url);
  delete require.cache[abs];
  return require(abs).publish;
}

const root = path.resolve(process.argv[2] || '.');
const abs = path.join(root, CONFIG_REL);
// One descriptor for the whole read-modify-write: the file that was
// inspected is the file that gets rewritten (no check-then-reopen by path).
let fd;
try {
  fd = fs.openSync(abs, 'r+');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.error(`[strip-updater-feed] missing: ${abs}`);
  process.exit(2);
}
let refusal = null;
try {
  const before = fs.readFileSync(fd, 'utf8');
  if (NEUTERED.test(before)) {
    console.log('[strip-updater-feed] publish already null — neutered.');
  } else if (!before.includes('publish:')) {
    refusal =
      '[strip-updater-feed] no `publish:` key in the build config. ' +
      'electron-builder would then derive the update feed from ' +
      'package.json `repository` — refusing to call that neutered.';
  } else {
    const after = neuterPublishBlock(before);
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, after, 0, 'utf8');
    console.log(`[strip-updater-feed] set publish: null in ${CONFIG_REL}`);
  }
} finally {
  fs.closeSync(fd);
}
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const publish = loadedPublishValue(abs);
if (publish !== null) {
  console.error(
    `[strip-updater-feed] evaluated config still has publish = ${JSON.stringify(publish)}`
  );
  process.exit(1);
}
