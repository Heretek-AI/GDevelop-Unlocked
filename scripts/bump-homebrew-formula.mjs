// Automated bumper for Linux Homebrew Formula (Phase 4 tap distribution).
//
// Updates Formula/gdevelop-unlocked.rb with new release URLs, tag version,
// and computed SHA-256 integrity checksums.
//
// Usage: node scripts/bump-homebrew-formula.mjs \
//          --tag <release-tag> \
//          --sha256-x64 <hash> \
//          [--sha256-arm64 <hash>] \
//          [--formula <path>]

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tag') out.tag = argv[++i];
    else if (a === '--version') out.version = argv[++i];
    else if (a === '--sha256-x64') out.sha256X64 = argv[++i];
    else if (a === '--sha256-arm64') out.sha256Arm64 = argv[++i];
    else if (a === '--url-x64') out.urlX64 = argv[++i];
    else if (a === '--url-arm64') out.urlArm64 = argv[++i];
    else if (a === '--formula') out.formula = path.resolve(argv[++i]);
  }
  return out;
}

export function updateFormulaText(text, {
  tag,
  version,
  sha256X64,
  sha256Arm64,
  urlX64,
  urlArm64,
}) {
  let updated = text;

  // 1. Version update
  if (version) {
    updated = updated.replace(/version\s+"[^"]+"/, `version "${version}"`);
  } else if (tag) {
    const cleanVer = tag.replace(/^unlocked-/, '').replace(/^v/, '');
    updated = updated.replace(/version\s+"[^"]+"/, `version "${cleanVer}"`);
  }

  // 2. Intel / x86_64 URL and SHA
  if (urlX64) {
    updated = updated.replace(
      /(on_intel\s+do\s+url\s+)"[^"]+"/,
      `$1"${urlX64}"`
    );
  } else if (tag) {
    const defaultUrlX64 = `https://github.com/Heretek-AI/GDevelop-Unlocked/releases/download/${tag}/gdevelop-unlocked-linux-x64-${tag.replace(/^unlocked-/, '')}.zip`;
    updated = updated.replace(
      /(on_intel\s+do\s+url\s+)"[^"]+"/,
      `$1"${defaultUrlX64}"`
    );
  }

  if (sha256X64) {
    updated = updated.replace(
      /(on_intel\s+do[\s\S]*?sha256\s+)"[^"]+"/,
      `$1"${sha256X64}"`
    );
  }

  // 3. ARM64 URL and SHA
  if (urlArm64) {
    updated = updated.replace(
      /(on_arm\s+do\s+url\s+)"[^"]+"/,
      `$1"${urlArm64}"`
    );
  } else if (tag) {
    const defaultUrlArm64 = `https://github.com/Heretek-AI/GDevelop-Unlocked/releases/download/${tag}/gdevelop-unlocked-linux-arm64-${tag.replace(/^unlocked-/, '')}.zip`;
    updated = updated.replace(
      /(on_arm\s+do\s+url\s+)"[^"]+"/,
      `$1"${defaultUrlArm64}"`
    );
  }

  if (sha256Arm64) {
    updated = updated.replace(
      /(on_arm\s+do[\s\S]*?sha256\s+)"[^"]+"/,
      `$1"${sha256Arm64}"`
    );
  }

  return updated;
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = parseArgs(process.argv.slice(2));
  const formulaPath = args.formula || path.resolve('Formula', 'gdevelop-unlocked.rb');

  if (!fs.existsSync(formulaPath)) {
    console.error(`[bump-homebrew-formula] formula not found: ${formulaPath}`);
    process.exit(1);
  }

  if (!args.tag && !args.sha256X64) {
    console.error('Usage: node scripts/bump-homebrew-formula.mjs --tag <tag> --sha256-x64 <sha> [--sha256-arm64 <sha>]');
    process.exit(2);
  }

  const original = fs.readFileSync(formulaPath, 'utf8');
  const bumped = updateFormulaText(original, args);
  fs.writeFileSync(formulaPath, bumped);
  console.log(`[bump-homebrew-formula] successfully updated ${formulaPath}`);
}
