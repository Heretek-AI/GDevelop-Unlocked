// Phase 1 seam: Tier-1 entitlement funnel.
// Audit: `newIDE/app/src/Utils/GDevelopServices/Usage.js:605-620` —
// every paywall funnels through `hasValidSubscriptionPlan`.
// Shape asserted here; Phase 2 hunk 1 rewrites the body to `return true`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readUpstream,
  mustContain,
  mustMatchWord,
  mustBeNearLine,
} from './helpers.mjs';

const REL = 'newIDE/app/src/Utils/GDevelopServices/Usage.js';

describe('seam: Usage.hasValidSubscriptionPlan', () => {
  const file = readUpstream(REL);

  it('exports the hasValidSubscriptionPlan predicate', () => {
    // Word-boundary match: a rename (even to a superstring) must trip.
    mustMatchWord(file, 'export const hasValidSubscriptionPlan', {
      what: 'Tier-1 funnel predicate',
      hint: 'Phase 2 hunk 1 + preload Module._load intercept both target this export',
    });
  });

  it('sits at its audited hunk (~line 605, tolerance ±40)', () => {
    mustBeNearLine(
      file,
      /export const hasValidSubscriptionPlan(?![\w$])/,
      605,
      40,
      'hasValidSubscriptionPlan'
    );
  });

  it('keeps the planId + redemption-code gate shape', () => {
    for (const token of [
      'subscription.planId',
      'redemptionCodeValidUntil',
      'Date.now()',
    ]) {
      mustContain(file, token, {
        what: 'gate condition inside hasValidSubscriptionPlan',
      });
    }
    mustContain(file, 'return true', { what: 'valid-subscription branch' });
    mustContain(file, 'return false', { what: 'default-deny branch' });
  });

  it('predicate takes a Subscription and returns boolean', () => {
    const idx = file.text.indexOf('export const hasValidSubscriptionPlan');
    assert.ok(idx !== -1, `SEAM DRIFT: predicate missing. File: ${file.abs}`);
    const window = file.text.slice(idx, idx + 600);
    assert.ok(
      window.includes('Subscription') && window.includes('boolean'),
      `SEAM DRIFT: predicate signature drifted (expected (subscription: ?Subscription) => boolean). ` +
        `File: ${file.abs}. Slice: ${JSON.stringify(window.slice(0, 200))}`
    );
  });
});
