// Integration Test: OpenAI-compatible provider daemon (T08, issue #18).
//
// Boots the real packages/opencode-provider/ HTTP daemon on an ephemeral
// loopback port and exercises it with REAL http requests: model listing,
// CORS preflight, non-streaming completions + usage, SSE streaming chunks +
// data:[DONE], function-call → tool_calls mapping for the 39 editor
// functions, malformed-payload rejection, and zero egress to api.gdevelop.io.
//
// Bare node:test + builtins only. No mocks of the code under test.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  startServer,
  EDITOR_TOOLS,
  OPENAI_MODEL_ID,
} from '../../packages/opencode-provider/server.mjs';
import {
  EDITOR_FUNCTION_NAMES,
  openAiMessagesToSession,
  mapFunctionCallToToolCall,
  parseFunctionCallMessage,
} from '../../packages/opencode-provider/adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const postJson = (port, body, { raw, headers } = {}) =>
  new Promise((resolve, reject) => {
    const payload = typeof raw === 'string' ? raw : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data })
        );
      }
    );
    req.on('error', reject);
    req.end(payload);
  });

describe('integration: opencode provider daemon (real HTTP)', () => {
  let server;
  let port;

  before(async () => {
    server = await startServer({ host: '127.0.0.1', port: 0 });
    port = server.address().port;
    assert.ok(port > 0, 'ephemeral port assigned');
  });

  after(async () => {
    await server.close();
  });

  it('GET /v1/models lists the local model', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const data = await res.json();
    assert.equal(data.object, 'list');
    assert.ok(
      data.data.some(m => m.id === OPENAI_MODEL_ID),
      'local model id advertised'
    );
  });

  it('CORS preflight OPTIONS answers 204 permissively', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'OPTIONS',
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  });

  it('POST stream:false returns a standard completion with usage', async () => {
    const { status, body } = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: [{ role: 'user', content: 'Hello local bridge' }],
      stream: false,
    });
    assert.equal(status, 200);
    const data = JSON.parse(body);
    assert.equal(data.object, 'chat.completion');
    assert.equal(data.choices.length, 1);
    assert.equal(data.choices[0].message.role, 'assistant');
    assert.ok(data.choices[0].message.content.length > 0);
    assert.ok(data.usage.total_tokens >= data.usage.prompt_tokens);
    assert.ok(data.usage.completion_tokens > 0);
  });

  it('POST stream:true emits SSE chunk deltas ending in data:[DONE]', async () => {
    const { status, headers, body } = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: [{ role: 'user', content: 'Stream me' }],
      stream: true,
    });
    assert.equal(status, 200);
    assert.match(headers['content-type'] || '', /text\/event-stream/);
    assert.ok(body.includes('data: '), 'SSE data frames present');
    const frames = body
      .split('\n\n')
      .map(f => f.trim())
      .filter(Boolean);
    assert.ok(frames.length >= 2, 'at least one delta plus DONE');
    assert.equal(frames[frames.length - 1], 'data: [DONE]');
    const first = JSON.parse(frames[0].replace(/^data: /, ''));
    assert.equal(first.choices[0].delta.role, 'assistant');
    const contentFrames = frames
      .slice(0, -1)
      .map(f => JSON.parse(f.replace(/^data: /, '')))
      .filter(c => typeof c.choices[0].delta.content === 'string');
    assert.ok(contentFrames.length > 0, 'deltas carry content');
    const reassembled = frames
      .slice(0, -1)
      .map(f => JSON.parse(f.replace(/^data: /, '')))
      .map(c => c.choices[0].delta.content || '')
      .join('');
    assert.ok(reassembled.length > 0, 'deltas reassemble to content');
  });

  it('maps a function-call message to a tool_calls payload (39 editor fns)', async () => {
    const { status, body } = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'user', content: 'Build the first level' },
        {
          role: 'user',
          content: JSON.stringify({
            name: 'create_scene',
            arguments: { scene_name: 'Level1' },
          }),
        },
      ],
      tools: EDITOR_TOOLS.map(t => ({
        type: 'function',
        function: { name: t.function.name, description: t.function.description },
      })),
      stream: false,
    });
    assert.equal(status, 200);
    const data = JSON.parse(body);
    assert.equal(data.choices[0].finish_reason, 'tool_calls');
    const calls = data.choices[0].message.tool_calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'function');
    assert.equal(calls[0].function.name, 'create_scene');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), {
      scene_name: 'Level1',
    });
    assert.match(calls[0].id, /^call_/);
  });

  it('streams tool_calls as SSE deltas for function-call messages', async () => {
    const { status, headers, body } = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            name: 'add_behavior',
            arguments: {
              object_name: 'Hero',
              behavior_name: 'Platformer',
              behavior_type: 'PlatformBehavior::PlatformerObjectBehavior',
            },
          }),
        },
      ],
      stream: true,
    });
    assert.equal(status, 200);
    assert.match(headers['content-type'] || '', /text\/event-stream/);
    assert.ok(body.includes('tool_calls'), 'streamed deltas carry tool_calls');
    assert.ok(body.trimEnd().endsWith('data: [DONE]'));
  });

  it('rejects malformed OpenAI payloads with 400 JSON errors', async () => {
    // Not JSON.
    const bad = await postJson(port, null, { raw: '{oops' });
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(bad.body).error.type, 'invalid_request_error');
    // Missing messages.
    const missing = await postJson(port, { model: OPENAI_MODEL_ID });
    assert.equal(missing.status, 400);
    // Messages not an array.
    const wrongType = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: 'hello',
    });
    assert.equal(wrongType.status, 400);
    // Unknown function name in a function-call message.
    const unknownFn = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'user', content: JSON.stringify({ name: 'delete_everything', arguments: {} }) },
      ],
    });
    assert.equal(unknownFn.status, 400);
    assert.match(JSON.parse(unknownFn.body).error.message, /unknown function/i);
    // Malformed tool definition.
    const badTool = await postJson(port, {
      model: OPENAI_MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function' }],
    });
    assert.equal(badTool.status, 400);
  });

  it('answers 404 JSON on unknown routes and 405 on wrong methods', async () => {
    const missing = await fetch(`http://127.0.0.1:${port}/v1/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'not_found');
    const wrongMethod = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`);
    assert.equal(wrongMethod.status, 405);
  });

  it('survives an SSE client abort mid-stream (truncation)', async () => {
    await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        model: OPENAI_MODEL_ID,
        messages: [{ role: 'user', content: 'x'.repeat(4000) }],
        stream: true,
      });
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        res => {
          res.on('data', () => req.destroy());
          res.on('close', resolve);
          res.on('error', () => resolve());
        }
      );
      req.on('error', () => resolve());
      req.end(payload);
      setTimeout(resolve, 2000);
    });
    // Daemon still serves afterwards.
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(res.status, 200);
  });
});

describe('integration: provider adapter translation (pure, real schemas)', () => {
  it('all 39 EDITOR_TOOLS match the upstream CustomAIClient registry', () => {
    const src = fs.readFileSync(
      path.join(root, 'packages/ai-studio/AI/CustomAIClient.js'),
      'utf8'
    );
    const re =
      /\{\s*type:\s*'function',\s*function:\s*\{\s*name:\s*'([^']+)'/g;
    const upstream = [];
    let m;
    while ((m = re.exec(src)) !== null) upstream.push(m[1]);
    assert.equal(upstream.length, 39);
    const shipped = EDITOR_TOOLS.map(t => t.function.name);
    assert.deepEqual([...shipped].sort(), [...upstream].sort());
    assert.deepEqual([...EDITOR_FUNCTION_NAMES].sort(), [...upstream].sort());
    for (const tool of EDITOR_TOOLS) {
      assert.equal(tool.type, 'function');
      assert.match(tool.function.name, /^[a-z][a-z0-9_]*$/);
      assert.ok(tool.function.description.length > 0);
      assert.equal(tool.function.parameters.type, 'object');
    }
  });

  it('openAiMessagesToSession maps roles, tool_calls and tool results', () => {
    const session = openAiMessagesToSession(
      [
        { role: 'system', content: 'You are a builder.' },
        { role: 'user', content: 'Make a hero' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'create_scene',
                arguments: '{"scene_name":"L1"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
      ],
      { sessionId: 'sess-1' }
    );
    assert.equal(session.id, 'sess-1');
    assert.match(session.prompt, /Make a hero/);
    const step = session.steps.find(s => s.type === 'tool_call');
    assert.equal(step.name, 'create_scene');
    assert.deepEqual(step.input, { scene_name: 'L1' });
    const result = session.steps.find(s => s.type === 'tool_result');
    assert.equal(result.toolCallId, 'call_1');
  });

  it('mapFunctionCallToToolCall validates against the 39 and stringifies args', () => {
    const call = mapFunctionCallToToolCall({
      name: 'create_scene',
      args: { scene_name: 'L1' },
    });
    assert.equal(call.type, 'function');
    assert.equal(call.function.name, 'create_scene');
    assert.equal(JSON.parse(call.function.arguments).scene_name, 'L1');
    assert.throws(
      () => mapFunctionCallToToolCall({ name: 'nope_fn', args: {} }),
      /unknown function/i
    );
    assert.equal(parseFunctionCallMessage('just prose'), null);
    assert.deepEqual(parseFunctionCallMessage('{"name":"create_scene","arguments":{}}'), {
      name: 'create_scene',
      args: {},
    });
  });
});

describe('integration: provider zero-egress + packaging', () => {
  it('daemon sources never reference the hosted API and use no external deps', () => {
    for (const file of ['server.mjs', 'adapter.mjs', 'cli.mjs']) {
      const src = fs.readFileSync(
        path.join(root, 'packages/opencode-provider', file),
        'utf8'
      );
      assert.ok(
        !src.includes('api.gdevelop.io'),
        `${file} must not reference the hosted API`
      );
    }
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(root, 'packages/opencode-provider/package.json'),
        'utf8'
      )
    );
    assert.ok(!pkg.dependencies, 'no runtime dependencies allowed');
    assert.ok(!pkg.devDependencies, 'no devDependencies allowed');
  });

  it('cli.mjs boots the daemon on an ephemeral port (real spawn)', async () => {
    const cli = path.join(root, 'packages/opencode-provider/cli.mjs');
    const child = spawn(process.execPath, [cli, '--port', '0', '--host', '127.0.0.1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', c => (out += c));
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('cli boot timeout')), 8000);
        const scan = () => {
          const found = /listening on .*?:(\d+)/.exec(out);
          if (found) {
            clearTimeout(timer);
            resolve(Number(found[1]));
          } else setTimeout(scan, 50);
        };
        child.on('error', reject);
        scan();
      });
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
      assert.equal(res.status, 200);
    } finally {
      child.kill('SIGTERM');
      await new Promise(resolve => child.on('exit', resolve));
    }
  });
});
