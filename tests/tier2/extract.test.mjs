// Tier-2 package tests: packages/ai-studio/ is self-contained and intact.
// Tamper-evidence comes from MANIFEST.json hashes pinned in THIS repo —
// no donor checkout, no fork clone, nothing outside this tree.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PACKAGE = path.join(ROOT, 'packages', 'ai-studio');

function sha256(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

describe('tier-2: self-contained package integrity', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE, 'MANIFEST.json'), 'utf8')
  );

  it('every manifest file exists with pinned bytes and hash', () => {
    assert.ok(
      Object.keys(manifest.files).length >= 19,
      'manifest looks truncated'
    );
    for (const [pkgRel, meta] of Object.entries(manifest.files)) {
      const pkgAbs = path.join(PACKAGE, pkgRel);
      assert.ok(fs.existsSync(pkgAbs), `package file missing: ${pkgRel}`);
      assert.equal(
        fs.statSync(pkgAbs).size,
        meta.bytes,
        `size drift (tamper?): ${pkgRel}`
      );
      assert.equal(
        sha256(pkgAbs),
        meta.sha256,
        `hash drift (tamper?): ${pkgRel}`
      );
    }
  });

  it('CustomAIClient has zero hosted-generation references', () => {
    const text = fs.readFileSync(
      path.join(PACKAGE, 'AI', 'CustomAIClient.js'),
      'utf8'
    );
    assert.ok(
      !text.includes('api.gdevelop.io'),
      'BYOK client must not hardcode the hosted API'
    );
    assert.ok(
      text.includes('GDEVELOP_OPENAI_TOOLS'),
      'tool schema missing from extraction'
    );
    assert.ok(
      text.includes('gd-custom-ai-config'),
      'localStorage config key missing from extraction'
    );
  });

  it('all 12 Studio prod modules extracted (no silent drops)', () => {
    const expected = [
      'EditApprovalLabel',
      'FinalizeSubAgents',
      'LoopGuard',
      'NudgePolicy',
      'PlanStore',
      'RequestWriteGate',
      'Roles',
      'RoleToolPolicy',
      'SafeTruncation',
      'SpawnSubAgents',
      'UseStudioNudge',
      'UseStudioRuntime',
    ];
    for (const name of expected) {
      assert.ok(
        fs.existsSync(path.join(PACKAGE, 'AiGeneration', 'Studio', `${name}.js`)),
        `Studio module missing: ${name}`
      );
    }
  });

  it('offline E2E harness extracted', () => {
    assert.ok(
      fs.existsSync(path.join(PACKAGE, 'dev-harness', 'mock-ai-provider.js'))
    );
  });
});
