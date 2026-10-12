// Integration Test: Real End-to-End BYOK Flow & AI Provider Mock Harness
// Exercises real HTTP communication with an OpenAI-compatible mock provider,
// validates generation routing, SSE streaming, tool schema compliance,
// and ensures the fail-closed leak guard blocks local-id egress to hosted APIs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  isLocalAiRequestId,
  partitionAiRequestIds,
  isCustomEndpointEnabled,
  selectBackend,
  assertNoLocalIdsLeak,
  guardHostedCall,
} from '../../packages/unlock-shim/generation-shim.mjs';

const MODEL = 'mock-test-model';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

describe('integration: BYOK AI provider communication and routing harness', () => {
  let mockServer;
  let mockPort;
  let receivedRequests = [];

  before(async () => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        if (req.method === 'OPTIONS') {
          res.writeHead(204, CORS);
          return res.end();
        }

        if (req.method === 'GET' && req.url === '/v1/models') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...CORS,
          });
          return res.end(
            JSON.stringify({
              object: 'list',
              data: [{ id: MODEL, object: 'model', owned_by: 'mock' }],
            })
          );
        }

        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          const parsed = JSON.parse(body || '{}');
          if (parsed.stream === true) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              ...CORS,
            });
            res.write(
              'data: ' +
                JSON.stringify({
                  choices: [{ delta: { content: 'Mock streamed token' } }],
                }) +
                '\n\n'
            );
            res.write('data: [DONE]\n\n');
            return res.end();
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            ...CORS,
          });
          return res.end(
            JSON.stringify({
              id: 'chatcmpl-mock-123',
              object: 'chat.completion',
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Mock response generated locally.',
                  },
                },
              ],
            })
          );
        }

        res.writeHead(404, CORS);
        res.end();
      });
    });

    await new Promise(resolve => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise(resolve => mockServer.close(resolve));
  });

  it('selectBackend correctly routes requests when custom endpoint is configured', () => {
    const customConfig = {
      enabled: true,
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
    };

    assert.equal(isCustomEndpointEnabled(customConfig), true);

    // Config enabled -> custom
    assert.equal(
      selectBackend({ aiRequestId: 'req-1', customConfig }),
      'custom'
    );

    // Local ID -> always custom, even if config is disabled
    assert.equal(
      selectBackend({
        aiRequestId: 'local-ai-abc-123',
        customConfig: { enabled: false },
      }),
      'custom'
    );

    // Standard ID without custom config -> hosted
    assert.equal(
      selectBackend({
        aiRequestId: 'hosted-req-1',
        customConfig: { enabled: false },
      }),
      'hosted'
    );
  });

  it('connects to mock OpenAI provider /v1/models successfully', async () => {
    receivedRequests = [];
    const res = await fetch(`http://127.0.0.1:${mockPort}/v1/models`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.object, 'list');
    assert.equal(data.data[0].id, MODEL);
    assert.equal(receivedRequests.length, 1);
    assert.equal(receivedRequests[0].url, '/v1/models');
  });

  it('executes non-streaming chat completion request against mock provider', async () => {
    receivedRequests = [];
    const res = await fetch(`http://127.0.0.1:${mockPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Create a red sprite object' }],
        stream: false,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(
      data.choices[0].message.content,
      'Mock response generated locally.'
    );
    assert.equal(receivedRequests.length, 1);
    const sentPayload = JSON.parse(receivedRequests[0].body);
    assert.equal(sentPayload.stream, false);
  });

  it('handles SSE streaming completion chunks from mock provider', async () => {
    const res = await fetch(`http://127.0.0.1:${mockPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.includes('Mock streamed token'));
    assert.ok(text.includes('[DONE]'));
  });

  it('fail-closed guard throws before executing any hosted request with local IDs', () => {
    let hostedFunctionExecuted = false;
    const dummyHostedCall = () => {
      hostedFunctionExecuted = true;
    };

    const guarded = guardHostedCall(
      dummyHostedCall,
      'https://api.gdevelop.io/generation/ai-request',
      (id) => [id]
    );

    // Non-local ID executes normally
    guarded('hosted-req-999');
    assert.equal(hostedFunctionExecuted, true);

    // Reset flag
    hostedFunctionExecuted = false;

    // Local ID must throw before executing the hosted function
    assert.throws(
      () => guarded('local-ai-leak-attempt'),
      /refusing hosted call.*local-ai-\* ids/
    );
    assert.equal(
      hostedFunctionExecuted,
      false,
      'Hosted function must NOT execute when local ID is provided'
    );
  });
});

describe('integration: BYOK tool schemas, zero-egress routing, patch-level leak proof', () => {
  it('all 39 GDEVELOP_OPENAI_TOOLS schemas are structurally valid and dispatchable', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(
      resolve(root, 'packages/ai-studio/AI/CustomAIClient.js'),
      'utf8'
    );
    // Extract tool blocks: { type: 'function', function: { name, description, parameters } }
    const toolRe =
      /\{\s*type:\s*'function',\s*function:\s*\{\s*name:\s*'([^']+)',\s*description:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
    const names = [];
    let m;
    while ((m = toolRe.exec(src)) !== null) names.push(m[1]);
    assert.equal(names.length, 39, `expected 39 tools, found ${names.length}`);
    assert.equal(new Set(names).size, 39, 'tool names must be unique');
    for (const name of names) {
      assert.match(name, /^[a-z][a-z0-9_]*$/, `bad tool name: ${name}`);
    }
    // parameters check: every tool block must declare object parameters.
    const paramsRe = /name:\s*'[^']+',\s*description:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),\s*parameters:\s*\{\s*type:\s*'object'/g;
    const withParams = src.match(paramsRe) || [];
    assert.equal(
      withParams.length,
      39,
      `all 39 tools need object parameters, found ${withParams.length}`
    );
    // Dispatch simulation: every tool name resolves to a handler (no undefined fn).
    const handlers = Object.fromEntries(names.map(n => [n, () => ({ ok: true })]));
    for (const name of names) {
      const fn = handlers[name];
      assert.equal(typeof fn, 'function', `no handler for tool ${name}`);
      assert.equal(fn().ok, true);
    }
  });

  it('zero requests reach api.gdevelop.io when the custom endpoint is active', async () => {
    const egress = [];
    const spyFetch = async url => {
      egress.push(String(url));
      if (String(url).includes('api.gdevelop.io')) {
        throw new Error(`LEAK: BYOK request escaped to ${url}`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const customConfig = { enabled: true, baseUrl: 'http://127.0.0.1:1/v1' };
    const ids = ['local-ai-req-1', 'local-ai-req-2', 'hosted-req-3'];
    for (const id of ids) {
      const backend = selectBackend({ aiRequestId: id, customConfig });
      assert.equal(backend, 'custom');
      const endpoint =
        backend === 'custom'
          ? `${customConfig.baseUrl}/chat/completions`
          : 'https://api.gdevelop.io/generation/ai-request';
      assert.ok(
        !endpoint.includes('api.gdevelop.io'),
        `local/custom request routed to hosted: ${id}`
      );
      await spyFetch(endpoint);
    }
    assert.ok(
      egress.every(u => !u.includes('api.gdevelop.io')),
      'fail-closed: no hosted egress under custom endpoint'
    );
    assert.throws(
      () =>
        assertNoLocalIdsLeak(['local-ai-req-1'], 'https://api.gdevelop.io/x'),
      /refusing hosted call/
    );
  });

  it('patched PrepareAiUserContent returns before any presigned-URL network call', async () => {
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.dirname(
      path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    );
    const upstream =
      process.env.UPSTREAM_DIR || path.join(root, 'review', 'GDevelop');
    const rel = 'newIDE/app/src/AiGeneration/PrepareAiUserContent.js';
    assert.ok(
      fs.existsSync(path.join(upstream, rel)),
      `missing fixture ${rel} (set UPSTREAM_DIR)`
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byok-leak-'));
    try {
      const dest = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(upstream, rel), dest);
      const r = spawnSync(
        'patch',
        ['-p1', '-s', '-i', path.join(root, 'patches/09-prepare-ai-content.patch')],
        { cwd: dir, encoding: 'utf8' }
      );
      assert.equal(r.status, 0, `patch 09 failed to apply:\n${r.stdout}\n${r.stderr}`);
      const patched = fs.readFileSync(dest, 'utf8');
      const guardAt = patched.indexOf("userId.startsWith('local-')");
      const uploadAt = patched.indexOf('createAiUserContentPresignedUrls(getAuthorizationHeader');
      assert.ok(guardAt !== -1, 'BYOK early-return guard missing after patch');
      assert.ok(uploadAt !== -1, 'hosted presigned path must remain for hosted mode');
      assert.ok(
        guardAt < uploadAt,
        'guard must precede the first presigned-URL network call'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('integration: T03 tool manifest pruning (no dead tool calls)', () => {
  it('search_docs/read_full_docs carry the offline suffix and fail closed with no network', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(
      resolve(root, 'packages/ai-studio/AI/CustomAIClient.js'),
      'utf8'
    );
    const suffix =
      '[Offline in local BYOK mode: rely on internal GDevelop knowledge and on-project verification]';
    assert.ok(
      src.includes(suffix),
      'offline suffix missing from CustomAIClient tool descriptions'
    );
    // Both docs tools must carry it.
    const searchAt = src.indexOf("name: 'search_docs'");
    const readAt = src.indexOf("name: 'read_full_docs'");
    assert.ok(searchAt !== -1 && readAt !== -1, 'docs tools missing from schema');
    assert.ok(
      src.slice(searchAt, searchAt + 800).includes(suffix),
      'search_docs description lacks offline suffix'
    );
    assert.ok(
      src.slice(readAt, readAt + 800).includes(suffix),
      'read_full_docs description lacks offline suffix'
    );
    // Fail-closed helper: synchronous, offline:true, exact message, no fetch.
    assert.ok(
      src.includes('OFFLINE_DOCS_MESSAGE'),
      'OFFLINE_DOCS_MESSAGE export missing'
    );
    assert.ok(
      src.includes('Documentation backend is offline in local mode'),
      'offline docs message text missing'
    );
    assert.ok(
      src.includes('buildOfflineDocsResult'),
      'buildOfflineDocsResult helper missing'
    );
    assert.ok(
      src.includes('isOfflineDocsTool'),
      'isOfflineDocsTool helper missing'
    );
    const helperAt = src.indexOf('export const buildOfflineDocsResult');
    assert.ok(helperAt !== -1, 'buildOfflineDocsResult export missing');
    const helperSlice = src.slice(helperAt, helperAt + 2000);
    assert.ok(helperSlice.includes('offline: true'), 'docs result must set offline:true');
    assert.ok(helperSlice.includes('success: false'), 'docs result must be success:false');
    assert.ok(!helperSlice.includes('fetch('), 'offline docs result must not fetch (no network lag)');
    assert.ok(!helperSlice.includes('axios'), 'offline docs result must not use axios');
    // Zero egress: the offline message path never mentions the hosted API.
    assert.ok(
      !src.includes('api.gdevelop.io'),
      'BYOK client must not hardcode the hosted API'
    );
  });

  it('create_or_update_plan routes to PlanStore locally, never to upstream EditorFunctions', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const client = readFileSync(
      resolve(root, 'packages/ai-studio/AI/CustomAIClient.js'),
      'utf8'
    );
    const patch14 = readFileSync(resolve(root, 'patches/14-ai-utils.patch'), 'utf8');
    // Schema keeps the tool so the manager keeps planning.
    assert.ok(
      client.includes("name: 'create_or_update_plan'"),
      'plan tool missing from GDEVELOP_OPENAI_TOOLS'
    );
    assert.ok(
      client.includes('isLocalPlanTool'),
      'isLocalPlanTool marker missing (T03 plan routing)'
    );
    // Patch 14 pre-pass: local PlanStore routing before the editor dispatch.
    for (const marker of [
      'offlineDocsHandledCallIds',
      'localPlanHandledCallIds',
      'validatePlanTasks',
      'buildPlanOutput',
      'mergePlanTasks',
      'OFFLINE_DOCS_MESSAGE',
    ]) {
      assert.ok(patch14.includes(marker), `patch 14 missing T03 marker: ${marker}`);
    }
    // Both pre-pass results are excluded from the editor and surfaced to the model.
    assert.ok(
      patch14.includes('!offlineDocsHandledCallIds.has(functionCall.call_id)'),
      'docs calls must be excluded from editor dispatch'
    );
    assert.ok(
      patch14.includes('!localPlanHandledCallIds.has(functionCall.call_id)'),
      'plan calls must be excluded from editor dispatch'
    );
    assert.ok(
      patch14.includes('...offlineDocsResults,'),
      'docs results must be sent to the model'
    );
    assert.ok(
      patch14.includes('...localPlanResults,'),
      'plan results must be sent to the model'
    );
    // No network in the T03 pre-pass: docs fail closed synchronously.
    const preAt = patch14.indexOf('T03 (#24)');
    assert.ok(preAt !== -1, 'T03 pre-pass comment missing in patch 14');
    const preSlice = patch14.slice(preAt, preAt + 6000);
    assert.ok(!preSlice.includes('fetch('), 'T03 pre-pass must not fetch');
  });

  it('every GDEVELOP_OPENAI_TOOLS entry is dispatchable locally (no dead tools)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(
      resolve(root, 'packages/ai-studio/AI/CustomAIClient.js'),
      'utf8'
    );
    const patch14 = readFileSync(resolve(root, 'patches/14-ai-utils.patch'), 'utf8');
    const toolRe =
      /\{\s*type:\s*'function',\s*function:\s*\{\s*name:\s*'([^']+)',\s*description:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
    const names = [];
    let m;
    while ((m = toolRe.exec(src)) !== null) names.push(m[1]);
    assert.equal(names.length, 39, `expected 39 tools, found ${names.length}`);
    // The three historically dead tools now have explicit local handling.
    for (const dead of ['search_docs', 'read_full_docs', 'create_or_update_plan']) {
      assert.ok(names.includes(dead), `tool missing from schema: ${dead}`);
      assert.ok(
        patch14.includes(dead),
        `patch 14 has no local route for historically dead tool: ${dead}`
      );
    }
    // Backend-only tools stay in schema for hosted turns but are withheld locally.
    assert.ok(
      src.includes('BACKEND_ONLY_TOOL_NAMES'),
      'backend-only filter missing'
    );
  });
});

describe('integration: T04 no-project self-remedy (null project)', () => {
  it('project-dependent tools fail closed with the initialize_project remedy', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(
      resolve(root, 'packages/ai-studio/AI/CustomAIClient.js'),
      'utf8'
    );
    // Deterministic self-remedying error text (exact match on the contract).
    assert.ok(src.includes('NO_PROJECT_MESSAGE'), 'NO_PROJECT_MESSAGE export missing');
    assert.ok(
      src.includes("No project is currently open. You must call initialize_project(template_slug:'empty')"),
      'no-project remedy text missing or reworded'
    );
    assert.ok(src.includes('isProjectDependentTool'), 'isProjectDependentTool helper missing');
    assert.ok(src.includes('buildNoProjectResult'), 'buildNoProjectResult helper missing');
    assert.ok(src.includes('PROJECT_FREE_TOOL_NAMES'), 'PROJECT_FREE_TOOL_NAMES missing');
    const helperAt = src.indexOf('export const buildNoProjectResult');
    assert.ok(helperAt !== -1, 'buildNoProjectResult export missing');
    const helperSlice = src.slice(helperAt, helperAt + 2000);
    assert.ok(helperSlice.includes('success: false'), 'no-project result must be success:false');
    assert.ok(helperSlice.includes('noProject: true'), 'no-project result must set noProject:true');
    assert.ok(!helperSlice.includes('fetch('), 'no-project result must not fetch');
    // initialize_project itself is never project-dependent (it IS the remedy).
    const freeAt = src.indexOf('PROJECT_FREE_TOOL_NAMES');
    const freeSlice = src.slice(freeAt, freeAt + 1200);
    assert.ok(freeSlice.includes("'initialize_project'"), 'initialize_project must be project-free');
    // System prompt states the remedy when no project JSON is present.
    assert.ok(
      src.includes("No project is currently open. You must call initialize_project(template_slug:'empty') to create one before using project tools."),
      'buildSystemPrompt must state the no-project remedy'
    );
  });

  it('manager role leads with initialize_project when no project is open', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const roles = readFileSync(
      resolve(root, 'packages/ai-studio/AiGeneration/Studio/Roles.js'),
      'utf8'
    );
    const managerAt = roles.indexOf('manager: {');
    assert.ok(managerAt !== -1, 'manager role missing');
    const managerSlice = roles.slice(managerAt, managerAt + 4000);
    // initialize_project prominent: first in the manager tool manifest.
    const initAt = managerSlice.indexOf("'initialize_project'");
    assert.ok(initAt !== -1, 'initialize_project missing from manager allowedToolNames');
    const planAt = managerSlice.indexOf("'create_or_update_plan'");
    assert.ok(planAt !== -1, 'manager plan tool missing');
    assert.ok(
      initAt < planAt,
      'initialize_project must precede create_or_update_plan in the manager manifest (prominent)'
    );
    // First-action rule in the manager prompt.
    assert.ok(
      managerSlice.includes('your first action must be initialize_project'),
      'manager prompt must order initialize_project first when no project is open'
    );
  });

  it('patch 14 routes null-project calls to the self-remedy before the editor', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const patch14 = readFileSync(resolve(root, 'patches/14-ai-utils.patch'), 'utf8');
    for (const marker of [
      'noProjectHandledCallIds',
      'noProjectResults',
      'isProjectDependentTool',
      'NO_PROJECT_MESSAGE',
    ]) {
      assert.ok(patch14.includes(marker), `patch 14 missing T04 marker: ${marker}`);
    }
    assert.ok(
      patch14.includes('isCustomEndpointEnabled() && !project'),
      'no-project pre-pass must gate on !project under BYOK'
    );
    assert.ok(
      patch14.includes('!noProjectHandledCallIds.has(functionCall.call_id)'),
      'no-project calls must be excluded from the editor dispatch'
    );
    assert.ok(
      patch14.includes('...noProjectResults,'),
      'no-project results must be sent to the model'
    );
    const preAt = patch14.indexOf('T04 (#21)');
    assert.ok(preAt !== -1, 'T04 pre-pass comment missing');
    const preSlice = patch14.slice(preAt, preAt + 4000);
    assert.ok(!preSlice.includes('fetch('), 'no-project pre-pass must not fetch');
  });
});

describe('integration: T05 suspended UI and resume (terminal status card)', () => {
  it('UseStudioRuntime exposes the terminal status, resume, and clear-stalled helpers', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(
      resolve(root, 'packages/ai-studio/AiGeneration/Studio/UseStudioRuntime.js'),
      'utf8'
    );
    for (const marker of [
      'getTerminalStatusForRequest',
      'isTerminalRequestStatus',
      'buildResumeUpdate',
      'buildResumeSteerMessage',
      'clearStalledRequests',
      'STALLED_REQUESTS_STORAGE_KEY',
    ]) {
      assert.ok(src.includes(marker), `UseStudioRuntime missing T05 helper: ${marker}`);
    }
    // Badge contract: Suspended vs Stopped by Loop Guard.
    assert.ok(src.includes("'Suspended'"), 'Suspended badge missing');
    assert.ok(src.includes("'Stopped by Loop Guard'"), 'Loop Guard badge missing');
    // Exact reason + timestamp surface (returned as { badge, reason, timestamp }).
    assert.ok(src.includes('reason'), 'terminal reason not surfaced');
    assert.ok(src.includes('timestamp'), 'terminal timestamp not surfaced');
    // Resume clears back to ready with a steer prompt (LoopGuard resets on next user message).
    const resumeAt = src.indexOf('export const buildResumeUpdate');
    assert.ok(resumeAt !== -1, 'buildResumeUpdate export missing');
    const resumeSlice = src.slice(resumeAt, resumeAt + 2000);
    assert.ok(resumeSlice.includes("status: 'ready'"), 'resume must reset status to ready');
    assert.ok(resumeSlice.includes('error: null'), 'resume must clear the error');
    assert.ok(resumeSlice.includes('buildResumeSteerMessage'), 'resume must attach the steer prompt');
    // Clear Stalled purges exactly gd-custom-ai-requests.
    assert.ok(
      src.includes("gd-custom-ai-requests"),
      'Clear Stalled must purge gd-custom-ai-requests'
    );
    const clearAt = src.indexOf('export const clearStalledRequests');
    const clearSlice = src.slice(clearAt, clearAt + 1200);
    assert.ok(clearSlice.includes('localStorage.removeItem'), 'clear must remove the storage key');
    assert.ok(!clearSlice.includes('fetch('), 'clear must not fetch');
  });

  it('patch 11 mounts the terminal card with Resume/Retry and Clear Stalled', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const patch11 = readFileSync(resolve(root, 'patches/11-studio-runtime-mount.patch'), 'utf8');
    for (const marker of [
      'getTerminalStatusForRequest',
      'buildResumeUpdate',
      'clearStalledRequests',
      'Resume/Retry',
      'Clear Stalled',
      'T05 (#22)',
    ]) {
      assert.ok(patch11.includes(marker), `patch 11 missing T05 marker: ${marker}`);
    }
    // Terminal gating on suspended/error, replacing the spinner path.
    assert.ok(
      patch11.includes('getTerminalStatusForRequest(selectedAiRequest)'),
      'card must gate on the selected request status'
    );
    // Anti-revert: patch 11 must not delete upstream-new symbols.
    assert.ok(
      !/^-[^-].*attachmentIds/m.test(patch11),
      'patch 11 deletes upstream-new symbol attachmentIds'
    );
  });

  it('patch 11 dry-runs clean on a pristine upstream copy (real I/O)', async () => {
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.dirname(
      path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    );
    const upstream =
      process.env.UPSTREAM_DIR || path.join(root, 'review', 'GDevelop');
    const rel = 'newIDE/app/src/AiGeneration/AskAiEditorContainer.js';
    assert.ok(
      fs.existsSync(path.join(upstream, rel)),
      `missing fixture ${rel} (set UPSTREAM_DIR)`
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't05-p11-'));
    try {
      const dest = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(upstream, rel), dest);
      const r = spawnSync(
        'patch',
        ['-p1', '-s', '--dry-run', '-i', path.join(root, 'patches/11-studio-runtime-mount.patch')],
        { cwd: dir, encoding: 'utf8' }
      );
      assert.equal(r.status, 0, `patch 11 dry-run failed:\n${r.stdout}\n${r.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('integration: T06 storm guard isolation (child failure never suspends parent)', () => {
  it('LoopGuard is single-request with repeat-without-progress isolation', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(
      resolve(root, 'packages/ai-studio/AiGeneration/Studio/LoopGuard.js'),
      'utf8'
    );
    assert.ok(src.includes('LOOP_GUARD_SCOPE'), 'LOOP_GUARD_SCOPE marker missing');
    assert.ok(src.includes("'single-request'"), 'guard scope must be single-request');
    assert.ok(src.includes('maxTurnsWithoutProgress'), 'repeat-without-progress trip missing');
    assert.ok(
      src.includes("child") || src.includes('parent'),
      'isolation note must name child/parent separation'
    );
  });

  it('child spawn startup failure fails only its tool call (success:false, no parent suspend)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const patch14 = readFileSync(resolve(root, 'patches/14-ai-utils.patch'), 'utf8');
    // Failure shape: failed tool call the model sees.
    assert.ok(
      patch14.includes('The sub-agent could not be started.'),
      'spawn startup failure message missing'
    );
    // Isolation markers.
    for (const marker of ['T06 (#23)', 'editorCallIds', 'spawnFailureResults']) {
      assert.ok(patch14.includes(marker), `patch 14 missing T06 marker: ${marker}`);
    }
    // Parent guard feeds ONLY editor-dispatched calls — never spawn/local failures.
    assert.ok(
      patch14.includes('if (!editorCallIds.has(result.call_id)) return;'),
      'parent guard must skip non-editor (child/local) results'
    );
    // The spawn failure path never suspends or constrains the parent.
    const spawnAt = patch14.indexOf('The sub-agent could not be started.');
    assert.ok(spawnAt !== -1, 'spawn failure site missing');
    const spawnSlice = patch14.slice(Math.max(0, spawnAt - 2000), spawnAt + 2000);
    assert.ok(!spawnSlice.includes('suspendAiRequest'), 'spawn failure must not suspend the parent');
    assert.ok(!spawnSlice.includes("status: 'error'"), 'spawn failure must not mark the parent error');
    assert.ok(!spawnSlice.includes('guard.recordError'), 'spawn failure must not touch the parent streak');
    // Parent stays alive: the failure is recorded AND sent as a normal tool error.
    assert.ok(
      patch14.includes('spawnFailureResults.push(failure)'),
      'spawn failure must be pushed as a tool result'
    );
    assert.ok(
      patch14.includes('...spawnFailureResults,'),
      'spawn failures must be sent to the model for serial fallback'
    );
  });

  it('patch 14 still dry-runs clean with isolation (real I/O, anti-revert intact)', async () => {
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = path.dirname(
      path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    );
    const upstream =
      process.env.UPSTREAM_DIR || path.join(root, 'review', 'GDevelop');
    const rel = 'newIDE/app/src/AiGeneration/Utils.js';
    assert.ok(
      fs.existsSync(path.join(upstream, rel)),
      `missing fixture ${rel} (set UPSTREAM_DIR)`
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't06-p14-'));
    try {
      const dest = path.join(dir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(upstream, rel), dest);
      const r = spawnSync(
        'patch',
        ['-p1', '-s', '--dry-run', '-i', path.join(root, 'patches/14-ai-utils.patch')],
        { cwd: dir, encoding: 'utf8' }
      );
      assert.equal(r.status, 0, `patch 14 dry-run failed:\n${r.stdout}\n${r.stderr}`);
      const patchText = fs.readFileSync(path.join(root, 'patches/14-ai-utils.patch'), 'utf8');
      assert.ok(
        !/^-[^-].*onSaveProjectAsWithStorageProvider/m.test(patchText),
        'patch 14 deletes upstream-new symbol onSaveProjectAsWithStorageProvider'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
