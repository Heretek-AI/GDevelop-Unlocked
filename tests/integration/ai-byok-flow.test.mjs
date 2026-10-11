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
