// Electron fuse inspector and hardener (Phase 2 hardening).
//
// Hardens production Electron executables by setting security fuses:
//   - RunAsNode: disabled (prevents ELECTRON_RUN_AS_NODE=1 arbitrary code execution)
//   - EnableNodeCliInspectArguments: disabled (blocks remote inspector arguments like --inspect)
//   - EnableEmbeddedAsarIntegrityValidation: enabled (validates embedded asar signature)
//   - OnlyLoadAppFromAsar: enabled (prevents loading code from unpacked directories)
//
// Zero external dependencies: directly manipulates the Electron fuse sentinel wire format.
//
// Usage: node scripts/configure-electron-fuses.mjs [--check] <electron-binary-path>

import fs from 'node:fs';
import path from 'node:path';

// Electron Fuse Wire Format Sentinel (30 bytes)
export const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PujgMnAQALDM8NKxn', 'utf8');

export const FUSE_NAMES = [
  'runAsNode',
  'enableCookieEncryption',
  'enableNodeOptionsEnvironmentVariable',
  'enableNodeCliInspectArguments',
  'enableEmbeddedAsarIntegrityValidation',
  'onlyLoadAppFromAsar',
  'loadBrowserProcessSpecificV8Snapshot',
  'grantFileProtocolExtraPrivileges',
];

export const FUSE_STATE = {
  DISABLED: 0x30, // '0'
  ENABLED: 0x31,  // '1'
  REMOVED: 0x32,  // '2'
  INHERIT: 0x90,  // sentinel default
};

/** Locate fuse sentinel in binary buffer. Returns offset or -1. */
export function findFuseOffset(buffer) {
  return buffer.indexOf(FUSE_SENTINEL);
}

/** Read fuse states from an Electron binary buffer. */
export function readFuses(buffer) {
  const offset = findFuseOffset(buffer);
  if (offset === -1) {
    return { found: false, fuses: {} };
  }

  const fuseVersionOffset = offset + FUSE_SENTINEL.length;
  const fuseVersion = buffer[fuseVersionOffset];
  const fuses = {};

  const fusesStart = fuseVersionOffset + 1;
  for (let i = 0; i < FUSE_NAMES.length; i++) {
    const byte = buffer[fusesStart + i];
    fuses[FUSE_NAMES[i]] = byte === FUSE_STATE.ENABLED
      ? 'enabled'
      : byte === FUSE_STATE.DISABLED
        ? 'disabled'
        : 'default';
  }

  return { found: true, fuseVersion, fuses, offset };
}

/** Harden fuses on a buffer in-place. */
export function applyHardenedFuses(buffer) {
  const offset = findFuseOffset(buffer);
  if (offset === -1) {
    throw new Error('[configure-electron-fuses] fuse sentinel not found in binary');
  }

  const fusesStart = offset + FUSE_SENTINEL.length + 1;
  const changes = [];

  function setFuse(index, name, targetState) {
    const current = buffer[fusesStart + index];
    if (current !== targetState) {
      buffer[fusesStart + index] = targetState;
      changes.push({ name, from: current, to: targetState });
    }
  }

  // 1. Disable RunAsNode
  setFuse(0, 'runAsNode', FUSE_STATE.DISABLED);
  // 2. Disable Node Cli Inspect Arguments
  setFuse(3, 'enableNodeCliInspectArguments', FUSE_STATE.DISABLED);
  // 3. Enable Embedded Asar Integrity Validation
  setFuse(4, 'enableEmbeddedAsarIntegrityValidation', FUSE_STATE.ENABLED);
  // 4. Enforce OnlyLoadAppFromAsar
  setFuse(5, 'onlyLoadAppFromAsar', FUSE_STATE.ENABLED);

  return { offset, changes };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const binPath = args.find(a => !a.startsWith('--'));

  if (!binPath) {
    console.error('Usage: node scripts/configure-electron-fuses.mjs [--check] <electron-binary-path>');
    process.exit(2);
  }

  const resolved = path.resolve(binPath);
  if (!fs.existsSync(resolved)) {
    console.error(`[configure-electron-fuses] binary not found: ${resolved}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(resolved);
  const info = readFuses(buf);

  if (!info.found) {
    console.warn(`[configure-electron-fuses] warning: fuse sentinel not found in ${resolved} (not an Electron binary or stripped)`);
    process.exit(0);
  }

  console.log(`[configure-electron-fuses] Current fuses for ${path.basename(resolved)}:`);
  for (const [k, v] of Object.entries(info.fuses)) {
    console.log(`  ${k}: ${v}`);
  }

  if (!checkOnly) {
    const result = applyHardenedFuses(buf);
    fs.writeFileSync(resolved, buf);
    console.log(`[configure-electron-fuses] Hardened ${result.changes.length} fuse(s) in ${resolved}`);
  }
}
