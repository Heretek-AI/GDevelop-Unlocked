// Payload contract tests (Phase 3): shapes satisfy the upstream
// validators (limits -> `capabilities`, subscription-v2 -> `userId`)
// and only the two Tier-1 GET endpoints are ever spoofed.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  USAGE_API_BASE,
  UNLOCKED_SUBSCRIPTION,
  UNLOCKED_CAPABILITIES,
  buildSubscriptionPayload,
  buildLimitsPayload,
  isSpoofedUsageUrl,
  spoofBodyForUrl,
} = require('../../launcher/unlock-payloads.cjs');

describe('payloads: unlock bodies', () => {
  it('subscription payload carries the startup plan identity', () => {
    const body = buildSubscriptionPayload();
    assert.equal(body.userId, 'local-byok-user');
    assert.equal(body.planId, 'gdevelop_startup');
    assert.equal(body.pricingSystemId, 'HERETEK_UNLOCKED');
  });

  it('limits payload satisfies the upstream capabilities validator', () => {
    const body = buildLimitsPayload();
    assert.ok(body.capabilities, 'ensureObjectHasProperty(..., capabilities)');
    assert.equal(body.capabilities.cloudProjects.maximumCount, 999);
    assert.equal(body.capabilities.versionHistory.retentionDays, 365);
    assert.deepEqual(body.quotas, {});
    assert.equal(body.credits.userBalance.amount, 999999);
  });

  it('builders default to the UNLOCKED_* single source', () => {
    assert.deepEqual(buildSubscriptionPayload(), UNLOCKED_SUBSCRIPTION);
    assert.deepEqual(
      buildLimitsPayload().capabilities,
      UNLOCKED_CAPABILITIES
    );
  });
});

describe('payloads: spoof surface', () => {
  const limits = `${USAGE_API_BASE}/limits`;
  const sub = `${USAGE_API_BASE}/subscription-v2`;

  it('spoofs exactly the two Tier-1 GET endpoints (query strings ok)', () => {
    assert.equal(isSpoofedUsageUrl(limits, 'GET'), true);
    assert.equal(isSpoofedUsageUrl(`${limits}?userId=abc`, 'GET'), true);
    assert.equal(isSpoofedUsageUrl(sub, 'GET'), true);
    assert.equal(isSpoofedUsageUrl(`${sub}?userId=abc`, 'GET'), true);
    assert.equal(isSpoofedUsageUrl(limits, undefined), true);
  });

  it('passes through mutations, other endpoints, other hosts', () => {
    assert.equal(isSpoofedUsageUrl(limits, 'POST'), false);
    assert.equal(isSpoofedUsageUrl(sub, 'DELETE'), false);
    assert.equal(
      isSpoofedUsageUrl(`${USAGE_API_BASE}/generation`, 'GET'),
      false
    );
    assert.equal(isSpoofedUsageUrl(`${USAGE_API_BASE}/usage`, 'GET'), false);
    assert.equal(
      isSpoofedUsageUrl('https://evil.example.com/usage/limits', 'GET'),
      false
    );
    assert.equal(isSpoofedUsageUrl(null, 'GET'), false);
    assert.equal(isSpoofedUsageUrl(`${USAGE_API_BASE}/limits-evil`, 'GET'), false);
  });

  it('spoofBodyForUrl returns validator-satisfying bodies', () => {
    assert.ok(spoofBodyForUrl(limits, 'GET').capabilities);
    assert.equal(spoofBodyForUrl(sub, 'GET').userId, 'local-byok-user');
    assert.equal(
      spoofBodyForUrl(`${USAGE_API_BASE}/generation`, 'GET'),
      null
    );
  });
});
