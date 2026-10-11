// Generation shim tests (Phase 4): routing predicates + the
// fail-closed leak guard. These invariants are what stop `local-ai-*`
// ids from ever reaching the hosted generation API.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLocalAiRequestId,
  partitionAiRequestIds,
  isCustomEndpointEnabled,
  selectBackend,
  assertNoLocalIdsLeak,
  guardHostedCall,
} from '../../packages/unlock-shim/generation-shim.mjs';

const CUSTOM = { enabled: true, baseUrl: 'http://localhost:11434/v1' };

describe('shim: id classification', () => {
  it('recognizes local-ai-* ids exactly', () => {
    assert.equal(isLocalAiRequestId('local-ai-abc123'), true);
    assert.equal(isLocalAiRequestId('hosted-uuid'), false);
    assert.equal(isLocalAiRequestId('LOCAL-AI-x'), false);
    assert.equal(isLocalAiRequestId(null), false);
    assert.equal(isLocalAiRequestId(undefined), false);
  });

  it('partitions mixed batches (fork 07 split)', () => {
    assert.deepEqual(
      partitionAiRequestIds(['local-ai-1', 'h-1', 'local-ai-2', 'h-2']),
      { localIds: ['local-ai-1', 'local-ai-2'], hostedIds: ['h-1', 'h-2'] }
    );
    assert.deepEqual(partitionAiRequestIds([]), { localIds: [], hostedIds: [] });
  });
});

describe('shim: backend selection', () => {
  it('local ids win over everything (no hosted representation)', () => {
    assert.equal(
      selectBackend({ aiRequestId: 'local-ai-1', customConfig: null }),
      'custom'
    );
    assert.equal(
      selectBackend({ aiRequestIds: ['h-1', 'local-ai-2'], customConfig: null }),
      'custom'
    );
  });

  it('enabled endpoint routes hosted-shaped traffic to custom', () => {
    assert.equal(
      selectBackend({ aiRequestId: 'h-1', customConfig: CUSTOM }),
      'custom'
    );
  });

  it('disabled/absent config stays hosted', () => {
    assert.equal(
      selectBackend({ aiRequestId: 'h-1', customConfig: null }),
      'hosted'
    );
    assert.equal(
      selectBackend({
        aiRequestId: 'h-1',
        customConfig: { enabled: false, baseUrl: 'http://x/v1' },
      }),
      'hosted'
    );
    assert.equal(
      selectBackend({
        aiRequestId: 'h-1',
        customConfig: { enabled: true, baseUrl: '' },
      }),
      'hosted'
    );
  });
});

describe('shim: leak guard (fail-closed)', () => {
  it('throws on local ids aimed at hosted endpoints', () => {
    assert.throws(
      () => assertNoLocalIdsLeak(['h-1', 'local-ai-9'], 'POST /generation'),
      /refusing hosted call/
    );
    assert.doesNotThrow(() => assertNoLocalIdsLeak(['h-1'], 'POST /generation'));
    assert.doesNotThrow(() => assertNoLocalIdsLeak([], 'POST /generation'));
  });

  it('guardHostedCall blocks before the hosted fn runs', () => {
    let ran = false;
    const guarded = guardHostedCall(
      () => (ran = true),
      'POST /generation',
      (...args) => args[0]
    );
    guarded(['h-1']);
    assert.equal(ran, true);
    assert.throws(() => guarded(['local-ai-1']), /refusing hosted call/);
    assert.equal(ran, true);
  });
});
