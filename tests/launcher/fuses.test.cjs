// Electron fuse hardener unit tests.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  FUSE_SENTINEL,
  FUSE_STATE,
  findFuseOffset,
  readFuses,
  applyHardenedFuses,
} = require('../../scripts/configure-electron-fuses.mjs');

function createSyntheticBinary() {
  const prefix = Buffer.alloc(100, 0x90);
  const sentinel = FUSE_SENTINEL;
  const version = Buffer.from([0x01]);
  // 8 fuses in default unconfigured state (0x90)
  const fuses = Buffer.alloc(8, 0x90);
  const suffix = Buffer.alloc(100, 0x90);
  return Buffer.concat([prefix, sentinel, version, fuses, suffix]);
}

describe('launcher: electron security fuses', () => {
  it('detects fuse sentinel in synthetic binary', () => {
    const bin = createSyntheticBinary();
    const offset = findFuseOffset(bin);
    assert.equal(offset, 100);

    const info = readFuses(bin);
    assert.equal(info.found, true);
    assert.equal(info.fuseVersion, 1);
    assert.equal(info.fuses.runAsNode, 'default');
  });

  it('fails gracefully when sentinel is absent', () => {
    const dummy = Buffer.alloc(200, 0x00);
    const info = readFuses(dummy);
    assert.equal(info.found, false);
    assert.throws(() => applyHardenedFuses(dummy), /fuse sentinel not found/);
  });

  it('applies hardened fuse states (disables RunAsNode & CliInspect, enables Asar)', () => {
    const bin = createSyntheticBinary();
    const result = applyHardenedFuses(bin);
    assert.ok(result.changes.length >= 4);

    const updated = readFuses(bin);
    assert.equal(updated.fuses.runAsNode, 'disabled');
    assert.equal(updated.fuses.enableNodeCliInspectArguments, 'disabled');
    assert.equal(updated.fuses.enableEmbeddedAsarIntegrityValidation, 'enabled');
    assert.equal(updated.fuses.onlyLoadAppFromAsar, 'enabled');
  });
});
