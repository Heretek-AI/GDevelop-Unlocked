// Web userscript demo tests (Phase 5, issue #5): syntax validity,
// Tampermonkey header contract, spoof surface, and documented limits.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SCRIPT = path.join(ROOT, 'web-userscript', 'heretek-unlock.user.js');
const text = fs.readFileSync(SCRIPT, 'utf8');

describe('web demo: userscript contract', () => {
  it('parses as valid JavaScript', () => {
    const r = spawnSync('node', ['--check', SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 0, `syntax error:\n${r.stderr}`);
  });

  it('targets the web editor only, at document start', () => {
    assert.ok(text.includes('@match        https://editor.gdevelop.io/*'));
    assert.ok(text.includes('@run-at       document-start'));
    assert.ok(text.includes('DEMO ONLY'));
  });

  it('spoofs exactly the Tier-1 usage endpoints', () => {
    assert.ok(text.includes('https://api.gdevelop.io/usage'));
    assert.ok(text.includes("'/limits'") || text.includes('/limits'));
    assert.ok(text.includes('/subscription-v2'));
    assert.ok(!text.includes('/generation'), 'demo must not touch generation');
  });

  it('documents all three known limits in the header', () => {
    assert.ok(text.includes('OLLAMA_ORIGINS'), 'Ollama CORS setup missing');
    assert.ok(text.includes('LAN preview'), 'LAN limitation missing');
    assert.ok(
      text.includes('chunk') || text.includes('Chunk'),
      'hash-churn limitation missing'
    );
  });

  it('taps webpackChunk without module-factory surgery', () => {
    assert.ok(text.includes('webpackChunk'));
    assert.ok(!text.includes('.m =') && !text.includes('__webpack_require__'));
  });
});
