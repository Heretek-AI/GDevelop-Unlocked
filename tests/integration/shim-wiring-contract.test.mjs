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
  // No id yet / no id at all: inlined selectBackend endpoint switch. Sites
  // that receive a userId must ALSO branch on the offline BYOK user, so a
  // `local-*` session stays local after the endpoint toggle is turned off.
  createAiRequest: 'endpointOrLocalUser',
  createAiGeneratedEvent: 'endpointOrLocalUser',
  createAssetSearch: 'endpointOrLocalUser',
  createResourceSearch: 'endpointOrLocalUser',
  createAiUserContentPresignedUrls: 'endpointOrLocalUser',
  fetchAiSettings: 'endpoint', // takes no userId
  // Offline BYOK user never lists hosted chats.
  getAiRequestSummaries: 'user',
  // Locally generated events carry their own `local-evt-` ids.
  getAiGeneratedEvent: 'event',
  // Attachments live in GDevelop's storage. Uploading one is refused in
  // BYOK mode (same rule as the presigned project-JSON upload); reading
  // back the attachments of a hosted chat stays hosted, except for the
  // offline BYOK user, who has none.
  createAiAttachmentUploads: 'endpointOrLocalUser',
  createAiAttachmentDownloads: 'offline',
};

// Every listed fragment must appear before the first hosted request.
const GUARDS = {
  id: ["aiRequestId.startsWith('local-ai-')"],
  partition: ["!id.startsWith('local-ai-')"],
  endpoint: ['isCustomEndpointEnabled()'],
  endpointOrLocalUser: ['isCustomEndpointEnabled()', "userId.startsWith('local-')"],
  user: ['userId === LOCAL_BYOK_USER_ID'],
  event: ["aiGeneratedEventId.startsWith('local-evt-')"],
  offline: ["userId.startsWith('local-')"],
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
    const found = text.indexOf('\n};\n', m.index);
    const end = found === -1 ? text.length : found;
    const body = text.slice(m.index, end);
    const hostedAt = body.search(HOSTED_CALL);
    if (hostedAt !== -1)
      sites.set(m[1], { body, hostedAt, start: m.index, end });
  }
  return sites;
}

/**
 * Hosted requests that sit outside every discovered call site — e.g. in a
 * `function` declaration or a class method a rebase introduced. Discovery
 * above is by declaration shape; this is the net under it, by request.
 */
function strayHostedRequests(text, sites) {
  const ranges = [...sites.values()];
  const stray = [];
  const re = new RegExp(HOSTED_CALL.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!ranges.some(r => m.index >= r.start && m.index < r.end))
      stray.push(text.slice(0, m.index).split('\n').length);
  }
  return stray;
}

/** Contract violations for one Generation.js text (empty = holds). */
function contractViolations(text) {
  const violations = [];
  const sites = hostedCallSites(text);
  for (const line of strayHostedRequests(text, sites))
    violations.push(`line ${line}: hosted request outside any classified call site`);
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
    for (const guard of GUARDS[kind]) {
      const guardAt = site.body.indexOf(guard);
      if (guardAt === -1 || guardAt > site.hostedAt)
        violations.push(`${name}: '${guard}' does not precede the hosted request`);
    }
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
    const expected = Object.values(CALL_SITES).reduce(
      (count, kind) => count + GUARDS[kind].length,
      0
    );
    assert.equal(
      violations.filter(v => v.includes('does not precede')).length,
      expected
    );
  });

  it('negative controls: a weakened or undiscovered call site is caught', () => {
    // 1. An endpoint route that keeps the toggle check but loses its
    //    offline-user branch.
    const weakened = patched.replace(
      /(export const createAiRequest = async[\s\S]*?)isCustomEndpointEnabled\(\) \|\| \(userId && userId\.startsWith\('local-'\)\)/,
      '$1isCustomEndpointEnabled()'
    );
    assert.notEqual(weakened, patched, 'fixture did not match — update the control');
    assert.deepEqual(contractViolations(weakened), [
      "createAiRequest: 'userId.startsWith('local-')' does not precede the hosted request",
    ]);
    // 2. A hosted request in a declaration form the discovery regex does
    //    not match (what a rebase could introduce).
    const extra =
      patched + "\nexport async function extra() {\n  return apiClient.post('/x');\n}\n";
    const line =
      extra.split('\n').findIndex(l => l.includes("apiClient.post('/x')")) + 1;
    assert.deepEqual(contractViolations(extra), [
      `line ${line}: hosted request outside any classified call site`,
    ]);
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

  it('BYOK never uploads an attachment: refused before any hosted call', () => {
    // An upload hands the file to GDevelop's storage. A custom endpoint
    // cannot read it back, so in BYOK mode it would be a pure leak —
    // the function must throw, not fall through and not return fake URLs.
    const sites = hostedCallSites(patched);
    const upload = sites.get('createAiAttachmentUploads');
    const beforeHosted = upload.body.slice(0, upload.hostedAt);
    const guardAt = beforeHosted.indexOf(
      "if (isCustomEndpointEnabled() || (userId && userId.startsWith('local-')))"
    );
    assert.ok(guardAt !== -1, 'upload guard missing or weaker than the presigned-URL rule');
    assert.match(beforeHosted.slice(guardAt), /\{\s*throw new Error\(/);
    assert.ok(
      beforeHosted.indexOf('getAuthorizationHeader()') > guardAt,
      'guard must run before the auth header is even requested'
    );

    const download = sites.get('createAiAttachmentDownloads');
    const offline = download.body.slice(0, download.hostedAt);
    assert.match(
      offline,
      /userId\.startsWith\('local-'\)\) \{\s*return attachmentIds\.map\(/,
      'offline BYOK user must get not-found entries, not a hosted call'
    );
    assert.ok(offline.includes("error: 'not-found'"));
  });
});
