// Unit tests for Linux Homebrew Formula bumper and integrity.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { updateFormulaText } from '../../scripts/bump-homebrew-formula.mjs';

describe('release: linux homebrew formula bumper', () => {
  it('updates formula version, URLs, and sha256 checksums', () => {
    const original = `class GdevelopUnlocked < Formula
  desc "Unlocked desktop IDE"
  version "0.1.0"

  on_linux do
    on_intel do
      url "https://old/x64.zip"
      sha256 "oldhash64"
    end

    on_arm do
      url "https://old/arm64.zip"
      sha256 "oldhasharm"
    end
  end
end`;

    const bumped = updateFormulaText(original, {
      tag: 'unlocked-abcdef1234',
      sha256X64: 'newhash64',
      sha256Arm64: 'newhasharm',
    });

    assert.ok(bumped.includes('version "abcdef1234"'));
    assert.ok(bumped.includes('sha256 "newhash64"'));
    assert.ok(bumped.includes('sha256 "newhasharm"'));
    assert.ok(bumped.includes('unlocked-abcdef1234'));
  });

  it('validates Formula/gdevelop-unlocked.rb syntax and structure on disk', () => {
    const formulaPath = path.resolve('Formula', 'gdevelop-unlocked.rb');
    assert.ok(fs.existsSync(formulaPath), 'Formula/gdevelop-unlocked.rb missing');
    const content = fs.readFileSync(formulaPath, 'utf8');

    assert.ok(content.includes('class GdevelopUnlocked < Formula'));
    assert.ok(content.includes('on_linux do'));
    assert.ok(content.includes('on_intel do'));
    assert.ok(content.includes('on_arm do'));
    assert.ok(content.includes('def install'));
    assert.ok(content.includes('def caveats'));
    assert.ok(content.includes('bubblewrap'));
    assert.ok(content.includes('gdevelop-unlocked'));
  });
});
