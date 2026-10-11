// Release build helper: neuter the auto-updater feed in a build tree.
//
// Upstream ships `publish: [{ provider: 'github' }]` in
// newIDE/electron-app/electron-builder-config.js, which points
// electron-updater at 4ian/GDevelop releases. A unlocked build must never
// phone that feed (it would download stock code over the patched app), so
// the release workflow strips the `publish` key before building. With no
// feed, checkForUpdatesAndNotify resolves empty and the explicit
// updates-check IPC becomes a graceful no-op.
//
// Usage: node scripts/strip-updater-feed.mjs <upstream-checkout-root>
// Exits non-zero if no publish block is found (loud is better than
// shipping an updatable build by accident).
import fs from 'node:fs';
import path from 'node:path';

const CONFIG_REL = 'newIDE/electron-app/electron-builder-config.js';

function stripPublishBlock(text) {
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
  // Extend to swallow a trailing comma and the preceding separator comma.
  let after = end + 1;
  while (after < text.length && /[\s,]/.test(text[after])) after++;
  return text.slice(0, keyIdx) + text.slice(after);
}

const root = path.resolve(process.argv[2] || '.');
const abs = path.join(root, CONFIG_REL);
if (!fs.existsSync(abs)) {
  console.error(`[strip-updater-feed] missing: ${abs}`);
  process.exit(2);
}
const before = fs.readFileSync(abs, 'utf8');
if (!before.includes('publish:')) {
  console.log('[strip-updater-feed] no publish block — already neutered.');
  process.exit(0);
}
const afterText = stripPublishBlock(before);
if (afterText.includes('publish:'))
  throw new Error('publish block survived stripping');
fs.writeFileSync(abs, afterText);
console.log(`[strip-updater-feed] removed update feed from ${CONFIG_REL}`);
