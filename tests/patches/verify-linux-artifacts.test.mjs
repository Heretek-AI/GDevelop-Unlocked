// Verification gate tests for Linux distribution artifacts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isElfBinary,
  inspectElfRpath,
  verifyDirectoryPermissions,
} from '../../scripts/verify-linux-artifacts.mjs';

describe('release: linux artifact verification gate', () => {
  it('passes on a clean directory with proper permissions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-art-clean-'));
    try {
      fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hello");', { mode: 0o644 });
      fs.writeFileSync(path.join(dir, 'package.json'), '{}', { mode: 0o644 });
      const binDir = path.join(dir, 'bin');
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(binDir, 'gdevelop'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

      const report = verifyDirectoryPermissions(dir);
      assert.equal(report.ok, true);
      assert.equal(report.violations.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when world-writable files exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-art-ww-'));
    try {
      const badFile = path.join(dir, 'bad.txt');
      fs.writeFileSync(badFile, 'insecure');
      fs.chmodSync(badFile, 0o666);
      const report = verifyDirectoryPermissions(dir);
      assert.equal(report.ok, false);
      assert.ok(report.violations.some(v => v.reason.includes('world-writable')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when scripts or data files are given executable bits', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-art-exec-'));
    try {
      fs.writeFileSync(path.join(dir, 'script.js'), 'console.log(1)', { mode: 0o755 });
      const report = verifyDirectoryPermissions(dir);
      assert.equal(report.ok, false);
      assert.ok(report.violations.some(v => v.reason.includes('executable permission')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when forbidden credential or git files are bundled', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-art-leak-'));
    try {
      fs.writeFileSync(path.join(dir, '.env'), 'SECRET=123', { mode: 0o600 });
      const report = verifyDirectoryPermissions(dir);
      assert.equal(report.ok, false);
      assert.ok(report.violations.some(v => v.reason.includes('sensitive file')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('correctly detects ELF magic header', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-art-elf-'));
    try {
      const elfFile = path.join(dir, 'fake_elf');
      fs.writeFileSync(elfFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]));
      assert.equal(isElfBinary(elfFile), true);

      const nonElf = path.join(dir, 'plain.txt');
      fs.writeFileSync(nonElf, 'not an elf');
      assert.equal(isElfBinary(nonElf), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
