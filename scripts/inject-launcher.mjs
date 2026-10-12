// Injects the Phase 3 launcher into an EXTRACTED app (release asar
// contents) or any tree holding electron-app's main.js — without needing
// the source-checkout patches (06 covers checkouts; this covers release
// artifacts whose renderer is bundled).
//
//   node scripts/inject-launcher.mjs --appdir <extracted-asar-root>
//
// Idempotent: re-running against an injected tree is a verified no-op
// (loader line detected, launcher files byte-compared). Fails loudly if
// the `const electron = require('electron');` anchor is absent — the
// wrap must precede the BrowserWindow destructure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const LAUNCHER_DIR = path.join(ROOT, 'launcher');
const LAUNCHER_FILES = [
  'heretek-hook.cjs',
  'preload-unlock.cjs',
  'unlock-payloads.cjs',
  'debug-logger.cjs',
];

const ANCHOR = "const electron = require('electron');";
const LOADER = `// GDevelop-Unlocked (Phase 3): Tier-1 runtime hook. Injected by
// scripts/inject-launcher.mjs (release-asar path; source checkouts use
// patches/06-electron-hook.patch instead). Must stay above the
// \`electron.BrowserWindow\` destructure. See launcher/README.md.
try {
  require('./heretek-hook.cjs').installPreloadHook();
} catch (error) {
  console.error(
    '[heretek] hook install failed (Tier-1 runtime fallback only):',
    error
  );
}
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--appdir') out.appdir = path.resolve(argv[++i]);
  }
  return out;
}

/** Locate main.js: extracted asars are flat, checkouts nest under newIDE/. */
export function findMainJs(appdir) {
  const candidates = [
    path.join(appdir, 'main.js'),
    path.join(appdir, 'newIDE', 'electron-app', 'app', 'main.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `[inject] main.js not found under ${appdir} (tried flat + newIDE/electron-app/app).`
  );
}

export function injectIntoAppDir(appdir) {
  const mainJs = findMainJs(appdir);
  const dir = path.dirname(mainJs);
  let text = fs.readFileSync(mainJs, 'utf8');
  const result = { mainJs, loaderAdded: false, filesSynced: [] };

  if (!text.includes("require('./heretek-hook.cjs').installPreloadHook()")) {
    const idx = text.indexOf(ANCHOR);
    if (idx === -1) {
      throw new Error(
        `[inject] anchor missing in ${mainJs}: ${JSON.stringify(ANCHOR)}. ` +
          `Upstream restructured main.js — update the loader insertion point.`
      );
    }
    text = text.slice(0, idx) + LOADER + text.slice(idx);
    fs.writeFileSync(mainJs, text);
    result.loaderAdded = true;
  }

  for (const file of LAUNCHER_FILES) {
    const src = path.join(LAUNCHER_DIR, file);
    const dest = path.join(dir, file);
    const wanted = fs.readFileSync(src, 'utf8');
    if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== wanted) {
      fs.writeFileSync(dest, wanted);
      result.filesSynced.push(file);
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (args.appdir) {
  const r = injectIntoAppDir(args.appdir);
  console.log(
    `[inject] ${r.mainJs}: loader ${r.loaderAdded ? 'added' : 'already present'}, ` +
      `files synced: ${r.filesSynced.length ? r.filesSynced.join(', ') : 'none (all current)'}`
  );
}
