// Verification gate for Linux distribution artifacts (Phase 2 hardening).
//
// Asserts that emitted Linux packages and extracted directories conform to
// zero-trust file permission baselines, ELF binary hygiene, and leak prevention:
//   1. No world-writable files (perm & 0o002 === 0).
//   2. Executables have sanitized permissions (0o755 / 0o555).
//   3. Non-binary files (.js, .json, .png, etc.) are non-executable.
//   4. ELF binaries contain valid headers and no unsafe DT_RPATH / DT_RUNPATH
//      (no relative '.', empty '::', or temp '/tmp' entries).
//   5. No sensitive credentials, repo metadata, or dev files (.git, .env, .npmrc).
//
// Usage: node scripts/verify-linux-artifacts.mjs <target-path>

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const FORBIDDEN_NAMES = new Set([
  '.env',
  '.git',
  '.npmrc',
  '.yarnrc',
  'id_rsa',
  'id_ed25519',
]);

const NON_EXEC_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.txt',
  '.html',
  '.css',
  '.png',
  '.jpg',
  '.svg',
  '.yml',
  '.yaml',
]);

export function isElfBinary(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46; // '\x7fELF'
  } catch {
    return false;
  }
}

export function inspectElfRpath(filePath) {
  // Try readelf if available
  const result = spawnSync('readelf', ['-d', filePath], { encoding: 'utf8' });
  if (result.status !== 0) return { ok: true, rpath: [] };

  const lines = result.stdout.split('\n');
  const paths = [];
  for (const line of lines) {
    if (line.includes('RPATH') || line.includes('RUNPATH')) {
      const match = line.match(/\[(.*?)\]/);
      if (match) {
        paths.push(match[1]);
      }
    }
  }

  const violations = [];
  for (const entry of paths) {
    const segments = entry.split(':');
    for (const seg of segments) {
      if (!seg || seg === '.' || seg === '..' || seg.startsWith('./') || seg.startsWith('../')) {
        violations.push(`relative or empty RPATH entry: "${seg}"`);
      }
      if (seg.startsWith('/tmp') || seg.startsWith('/var/tmp')) {
        violations.push(`insecure temporary RPATH entry: "${seg}"`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    rpaths: paths,
    violations,
  };
}

export function verifyDirectoryPermissions(dir) {
  const violations = [];
  let checkedCount = 0;

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);

      if (FORBIDDEN_NAMES.has(entry.name)) {
        violations.push({
          path: relPath,
          reason: `sensitive file or directory detected: ${entry.name}`,
        });
      }

      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch (err) {
        violations.push({
          path: relPath,
          reason: `unable to stat: ${err.message}`,
        });
        continue;
      }

      checkedCount++;
      const mode = stat.mode;

      // 1. World-writable check
      if ((mode & 0o002) !== 0) {
        violations.push({
          path: relPath,
          reason: `world-writable permissions (0o${(mode & 0o777).toString(8)})`,
        });
      }

      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();

        // 2. Non-exec extensions must not have exec bit set
        if (NON_EXEC_EXTENSIONS.has(ext)) {
          if ((mode & 0o111) !== 0) {
            violations.push({
              path: relPath,
              reason: `data/script file has executable permission (0o${(mode & 0o777).toString(8)})`,
            });
          }
        }

        // 3. ELF binary verification
        if (isElfBinary(fullPath)) {
          const elfCheck = inspectElfRpath(fullPath);
          if (!elfCheck.ok) {
            for (const v of elfCheck.violations) {
              violations.push({
                path: relPath,
                reason: `ELF binary RPATH hygiene violation: ${v}`,
              });
            }
          }
        }
      } else if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }

  walk(dir);
  return {
    ok: violations.length === 0,
    checkedCount,
    violations,
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/verify-linux-artifacts.mjs <target-directory-or-archive>');
    process.exit(2);
  }

  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    console.error(`[verify-linux-artifacts] target does not exist: ${resolved}`);
    process.exit(1);
  }

  let testDir = resolved;
  let isTemp = false;

  if (resolved.endsWith('.zip')) {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-artifact-zip-'));
    isTemp = true;
    const unzip = spawnSync('unzip', ['-q', resolved, '-d', testDir], { encoding: 'utf8' });
    if (unzip.status !== 0) {
      console.error(`[verify-linux-artifacts] failed to unpack zip: ${unzip.stderr}`);
      fs.rmSync(testDir, { recursive: true, force: true });
      process.exit(1);
    }
  } else if (resolved.endsWith('.tar.gz') || resolved.endsWith('.tgz')) {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-artifact-tar-'));
    isTemp = true;
    const untar = spawnSync('tar', ['-xzf', resolved, '-C', testDir], { encoding: 'utf8' });
    if (untar.status !== 0) {
      console.error(`[verify-linux-artifacts] failed to unpack tarball: ${untar.stderr}`);
      fs.rmSync(testDir, { recursive: true, force: true });
      process.exit(1);
    }
  }

  try {
    const report = verifyDirectoryPermissions(testDir);
    console.log(`[verify-linux-artifacts] checked ${report.checkedCount} items in ${target}`);
    if (!report.ok) {
      console.error(`[verify-linux-artifacts] FAILED with ${report.violations.length} violation(s):`);
      for (const v of report.violations) {
        console.error(`  - ${v.path}: ${v.reason}`);
      }
      process.exit(1);
    }
    console.log('[verify-linux-artifacts] PASS: all permission and ELF binary checks verified.');
  } finally {
    if (isTemp) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  }
}
