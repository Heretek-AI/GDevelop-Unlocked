// Tier-2 extraction tests (Phase 4): packages/ai-studio/ stays
// byte-identical to the fork donor, and the extracted client keeps the
// BYOK invariant (no hosted generation references).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PACKAGE = path.join(ROOT, 'packages', 'ai-studio');
const FORK =
  process.env.FORK_DIR || path.join(ROOT, 'review', 'GDevelop-Heretek');

function sha256(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

describe('tier-2: verbatim extraction', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE, 'MANIFEST.json'), 'utf8')
  );

  it('every manifest file matches the donor byte-for-byte', () => {
    assert.ok(
      Object.keys(manifest.files).length >= 19,
      'manifest looks truncated'
    );
    for (const [pkgRel, meta] of Object.entries(manifest.files)) {
      const pkgAbs = path.join(PACKAGE, pkgRel);
      const donorAbs = path.join(FORK, meta.donor);
      assert.ok(fs.existsSync(pkgAbs), `package file missing: ${pkgRel}`);
      assert.ok(
        fs.existsSync(donorAbs),
        `donor moved in fork: ${meta.donor} (update scripts/extract-tier2.mjs explicitly)`
      );
      assert.equal(
        sha256(pkgAbs),
        sha256(donorAbs),
        `drift vs donor: ${pkgRel}`
      );
      assert.equal(
        sha256(pkgAbs),
        meta.sha256,
        `manifest stale for ${pkgRel} (re-run the extractor)`
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
