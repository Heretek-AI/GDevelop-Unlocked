// Integration Test: unlock-shim <-> patch 07 duplication contract (audit S2).
//
// packages/unlock-shim/generation-shim.mjs is a REFERENCE implementation:
// the shipped renderer never imports it — patch 07 inlines the same
// predicates into Generation.js. This test is what stops the two copies
// drifting apart. It applies the real patch 07 to a pristine fixture copy
// and proves, for every hosted call site in the patched file, that the
// inlined BYOK branch sits before the first hosted request and uses the
// shim's id prefix.
//
// Limit (stated, not faked): this is source-order proof on the patched
// file, not execution. Generation.js is Flow-typed webpack input and
// cannot be imported here (no Babel/React in-repo). A guard that precedes
// the request but never fires at runtime would pass — that residual is
// the live zero-egress proof tracked in issue #12.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCAL_AI_REQUEST_ID_PREFIX,
  isLocalAiRequestId,
} from '../../packages/unlock-shim/generation-shim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const UPSTREAM =
  process.env.UPSTREAM_DIR || path.join(ROOT, 'review', 'GDevelop');
const REL = 'newIDE/app/src/Utils/GDevelopServices/Generation.js';

// Every top-level function in patched Generation.js that issues a hosted
// request, and how patch 07 keeps BYOK traffic away from it. A hosted
// call site missing from this table fails the suite: classify it (and
// decide its BYOK behavior) at rebase time instead of shipping it blind.
const CALL_SITES = {
  // Hosted URL carries the request id: the inlined isLocalAiRequestId
  // check must return before the request (shim invariant 3, no leakage).
  getAiRequest: 'id',
  addMessageToAiRequest: 'id',
  retryAiRequest: 'id',
  suspendAiRequest: 'id',
  updateAiRequest: 'id',
  deleteAiRequest: 'id',
  updateAiRequestMessage: 'id',
  sendAiRequestFeedback: 'id',
  getAiRequestSuggestions: 'id',
  forkAiRequest: 'id',
  // Batch: inlined partitionAiRequestIds — only hosted ids go out.
  getAiRequestStatuses: 'partition',
  // No id yet / no id at all: inlined selectBackend endpoint switch.
  createAiRequest: 'endpoint',
  createAiGeneratedEvent: 'endpoint',
  createAssetSearch: 'endpoint',
  createResourceSearch: 'endpoint',
  createAiUserContentPresignedUrls: 'endpoint',
  fetchAiSettings: 'endpoint',
  // Offline BYOK user never lists hosted chats.
  getAiRequestSummaries: 'user',
  // Locally generated events carry their own `local-evt-` ids.
  getAiGeneratedEvent: 'event',
  // KNOWN GAP (issue #12): upstream-new attachment endpoints, preserved
  // by the 07 forward-port with no BYOK branch — a chat attachment is
  // sent to the hosted API even when the custom endpoint is enabled.
  createAiAttachmentUploads: 'unguarded',
  createAiAttachmentDownloads: 'unguarded',
};

const GUARDS = {
  id: "aiRequestId.startsWith('local-ai-')",
  partition: "!id.startsWith('local-ai-')",
  endpoint: 'isCustomEndpointEnabled()',
  user: 'userId === LOCAL_BYOK_USER_ID',
  event: "aiGeneratedEventId.startsWith('local-evt-')",
};

const HOSTED_CALL = /\b(?:apiClient|axios)\.(?:get|post|put|patch|delete)\(/;

/** Top-level arrow functions that issue a hosted request, by name. */
function hostedCallSites(text) {
  const sites = new Map();
  const re = /^(?:export )?const (\w+) = (?:async )?\(/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Prettier-formatted source: a top-level arrow function ends at the
    // first column-0 `};`.
    const end = text.indexOf('\n};\n', m.index);
    const body = text.slice(m.index, end === -1 ? text.length : end);
    const hostedAt = body.search(HOSTED_CALL);
    if (hostedAt !== -1) sites.set(m[1], { body, hostedAt });
  }
  return sites;
}

/** Contract violations for one Generation.js text (empty = holds). */
function contractViolations(text) {
  const violations = [];
  const sites = hostedCallSites(text);
  for (const name of sites.keys()) {
    if (!(name in CALL_SITES))
      violations.push(`${name}: hosted call site not classified in CALL_SITES`);
  }
  for (const [name, kind] of Object.entries(CALL_SITES)) {
    const site = sites.get(name);
    if (!site) {
      violations.push(`${name}: classified call site no longer issues a hosted request`);
      continue;
    }
    if (kind === 'unguarded') continue;
    const guardAt = site.body.indexOf(GUARDS[kind]);
    if (guardAt === -1 || guardAt > site.hostedAt)
      violations.push(`${name}: '${GUARDS[kind]}' does not precede the hosted request`);
  }
  for (const [name, site] of sites) {
    if (site.body.includes('${aiRequestId}') && CALL_SITES[name] !== 'id')
      violations.push(`${name}: hosted URL carries aiRequestId without the local-id short-circuit`);
  }
  return violations;
}

describe('integration: unlock-shim duplication contract (patch 07)', () => {
  let dir;
  let pristine;
  let patched;

  before(() => {
    const src = path.join(UPSTREAM, REL);
    assert.ok(fs.existsSync(src), `missing fixture ${REL} (set UPSTREAM_DIR)`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-contract-'));
    const dest = path.join(dir, REL);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    pristine = fs.readFileSync(dest, 'utf8');
    const r = spawnSync(
      'patch',
      ['-p1', '-s', '-i', path.join(ROOT, 'patches/07-generation-glue.patch')],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, `patch 07 failed to apply:\n${r.stdout}\n${r.stderr}`);
    patched = fs.readFileSync(dest, 'utf8');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('every hosted call site is classified and branches before the request', () => {
    const violations = contractViolations(patched);
    assert.equal(
      violations.length,
      0,
      `shim duplication contract broken:\n${violations.join('\n')}`
    );
  });

  it('negative control: pristine upstream violates the same contract', () => {
    // Proves the checker can fail: without patch 07 no call site has a
    // BYOK branch, so every guarded entry must be reported.
    const violations = contractViolations(pristine);
    const guarded = Object.values(CALL_SITES).filter(k => k !== 'unguarded');
    assert.equal(violations.filter(v => v.includes('does not precede')).length, guarded.length);
  });

  it('inlined id prefix is the shim prefix, at every id-carrying site', () => {
    const literals = [...patched.matchAll(/startsWith\('(local-ai[^']*)'\)/g)].map(
      m => m[1]
    );
    const idSites = Object.values(CALL_SITES).filter(k => k === 'id').length;
    assert.ok(
      literals.length >= idSites,
      `expected >= ${idSites} inlined local-id checks, found ${literals.length}`
    );
    for (const literal of literals) {
      assert.equal(literal, LOCAL_AI_REQUEST_ID_PREFIX);
      assert.equal(isLocalAiRequestId(`${literal}x`), true);
    }
  });

  it('batch status call sends only non-local ids to the hosted API', () => {
    const { body, hostedAt } = hostedCallSites(patched).get('getAiRequestStatuses');
    const hostedCall = body.slice(hostedAt);
    assert.ok(hostedCall.includes("ids: hostedIds.join(',')"));
    assert.ok(
      !hostedCall.includes('aiRequestIds.join'),
      'unpartitioned ids reach the hosted status call'
    );
  });

  it('known gap stays visible: attachment endpoints have no BYOK branch', () => {
    // Pins the gap so it cannot be forgotten OR silently "fixed" without
    // reclassifying: when a BYOK branch lands, move these to a guarded
    // kind in CALL_SITES and tick the zero-egress item in issue #12.
    const sites = hostedCallSites(patched);
    for (const name of ['createAiAttachmentUploads', 'createAiAttachmentDownloads']) {
      const { body, hostedAt } = sites.get(name);
      const before = body.slice(0, hostedAt);
      for (const guard of Object.values(GUARDS))
        assert.ok(!before.includes(guard), `${name} gained a BYOK branch — reclassify it`);
      assert.ok(!before.includes('local-'), `${name} gained a BYOK branch — reclassify it`);
    }
  });
});
