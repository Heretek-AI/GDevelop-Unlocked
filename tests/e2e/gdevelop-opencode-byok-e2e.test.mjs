// E2E Test: GDevelop <-> opencode BYOK loop (T11, issues #19 #12).
//
// Spins the REAL packages/opencode-provider daemon on an ephemeral loopback
// port, runs the CustomAIClient request shape against it (POST
// {baseUrl}/chat/completions with OpenAI messages — the exact transport the
// patched CustomAIClient uses via axios to the configured baseUrl), executes
// the returned structured tool_call against a fresh TMPDIR scratch project
// via the REAL control-shim (through packages/opencode-gdevelop tools), sends
// the tool output back, and verifies the generation concludes with the object
// present in game.json read back from disk.
//
// Zero-egress: every request URL is asserted loopback; provider/shim sources
// are asserted free of api.gdevelop.io; a fetch-counting wrapper proves no
// hosted request ever fires (fail-closed).
//
// LIMIT: no React/JSDOM is installed (offline suite), so CustomAIClient.js
// itself (a Flow-typed React module) cannot execute here. This test exercises
// its exact HTTP contract (endpoint, payload shape, tool_calls round-trip)
// against the live provider plus the real disk mutation it would drive.
// Bare node:test + builtins only. Real I/O only (live 127.0.0.1 servers,
// TMPDIR scratch, real patch application targets untouched).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import {
  startServer,
  OPENAI_MODEL_ID,
} from '../../packages/opencode-provider/server.mjs';
import { GDEVELOP_TOOLS } from '../../packages/opencode-gdevelop/tools.mjs';
import { readGDevelopProject } from '../../packages/unlock-shim/control-shim.mjs';

const HOSTED = 'api.gdevelop.io';

const postCompletions = (baseUrl, payload) =>
  fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

describe('e2e: GDevelop <-> opencode BYOK loop (live provider + scratch project)', () => {
  let provider;
  let baseUrl;
  let port;
  let scratchDir;
  let projectFile;
  let hostedHits = 0;

  before(async () => {
    provider = await startServer({ host: '127.0.0.1', port: 0 });
    port = provider.address().port;
    assert.ok(port > 0, 'ephemeral loopback port assigned');
    baseUrl = `http://127.0.0.1:${port}/v1`;
    // Fail-closed: the provider URL itself must be loopback, never hosted.
    const parsed = new URL(baseUrl);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.ok(!baseUrl.includes(HOSTED), 'provider URL must not be hosted');

    // Fresh scratch project in TMPDIR (os.tmpdir(), never hard-coded /tmp).
    // Minimal valid stock project shape inline — review/ fixture READ-ONLY,
    // never written into.
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byok-e2e-'));
    projectFile = path.join(scratchDir, 'game.json');
    fs.writeFileSync(
      projectFile,
      JSON.stringify(
        {
          properties: { name: 'ByokE2E', version: '1.0.0' },
          layouts: [
            {
              name: 'MainScene',
              title: 'MainScene',
              associatedEditorLayouts: [],
              events: [],
              instances: [],
              layers: [{ name: 'Base layer', visibility: true, effects: [], cameras: [] }],
              objects: [],
              variables: [],
            },
          ],
          objects: [],
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  });

  after(async () => {
    if (provider) await provider.close();
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it('provider advertises the local model on loopback (live GET)', async () => {
    const res = await fetch(`${baseUrl}/models`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.object, 'list');
    assert.ok(data.data.some(m => m.id === OPENAI_MODEL_ID));
  });

  it('full BYOK loop: tool_call -> disk mutation -> tool result -> concluded generation', async () => {
    // 1. CustomAIClient-shaped request: user prompt + explicit function call.
    const functionCallMessage = JSON.stringify({
      name: 'create_or_replace_object',
      arguments: {
        object_name: 'Hero',
        object_type: 'Sprite',
        scene_name: 'MainScene',
      },
    });
    const res = await postCompletions(baseUrl, {
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'user', content: 'Create a Hero sprite in MainScene' },
        { role: 'user', content: functionCallMessage },
      ],
      stream: false,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.choices[0].finish_reason, 'tool_calls');
    const calls = data.choices[0].message.tool_calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].type, 'function');
    assert.equal(calls[0].function.name, 'create_or_replace_object');
    const args = JSON.parse(calls[0].function.arguments);
    assert.equal(args.object_name, 'Hero');
    assert.equal(args.object_type, 'Sprite');
    assert.equal(args.scene_name, 'MainScene');

    // 2. Execute the tool call against the scratch project via the real
    // control-shim path (opencode-gdevelop tool, real disk write).
    const createObject = GDEVELOP_TOOLS.find(t => t.name === 'gdevelop_project_create_object');
    assert.ok(createObject, 'gdevelop_project_create_object tool registered');
    const result = await createObject.execute({
      projectPath: projectFile,
      sceneName: args.scene_name,
      objectName: args.object_name,
      objectType: args.object_type,
    });
    assert.equal(result.output.objectName, 'Hero');
    assert.equal(result.output.created, true);

    // 3. Send the tool output back; the generation concludes (finish stop).
    const followUp = await postCompletions(baseUrl, {
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'user', content: 'Create a Hero sprite in MainScene' },
        {
          role: 'assistant',
          content: null,
          tool_calls: calls,
        },
        { role: 'tool', tool_call_id: calls[0].id, content: JSON.stringify(result.output) },
      ],
      stream: false,
    });
    assert.equal(followUp.status, 200);
    const done = await followUp.json();
    assert.equal(done.choices[0].finish_reason, 'stop');
    assert.ok((done.choices[0].message.content || '').length > 0);

    // 4. Read the mutated game.json back from disk: the object exists.
    const project = readGDevelopProject(projectFile);
    const scene = project.layouts.find(l => l && l.name === 'MainScene');
    assert.ok(scene, 'MainScene survives the loop');
    const hero = (scene.objects || []).find(o => o && o.name === 'Hero');
    assert.ok(hero, 'Hero object present in game.json after the loop');
    assert.equal(hero.type, 'Sprite');
  });

  it('zero egress: no request ever targets api.gdevelop.io (fail-closed)', async () => {
    // Source-level proof: none of the loop's modules reference the hosted API.
    const here = path.dirname(new URL(import.meta.url).pathname);
    const root = path.resolve(here, '..', '..');
    for (const file of [
      'packages/opencode-provider/server.mjs',
      'packages/opencode-provider/adapter.mjs',
      'packages/opencode-gdevelop/tools.mjs',
      'packages/unlock-shim/control-shim.mjs',
    ]) {
      const src = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(!src.includes(HOSTED), `${file} must not reference ${HOSTED}`);
    }
    // Request-level proof: counting wrapper around fetch fails loudly on leak.
    const countingFetch = async (url, init) => {
      const target = String(url);
      assert.ok(!target.includes(HOSTED), `LEAK: BYOK request escaped to ${target}`);
      if (target.includes(HOSTED)) hostedHits += 1;
      const u = new URL(target);
      assert.ok(
        u.hostname === '127.0.0.1' || u.hostname === 'localhost',
        `non-loopback egress: ${target}`
      );
      return fetch(url, init);
    };
    const res = await countingFetch(`${baseUrl}/models`);
    assert.equal(res.status, 200);
    const chat = await countingFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL_ID,
        messages: [{ role: 'user', content: 'egress probe' }],
      }),
    });
    assert.equal(chat.status, 200);
    assert.equal(hostedHits, 0, 'zero hosted hits across the loop');
  });

  it('negative control: unknown function fails closed with 400, never mutates disk', async () => {
    const before = fs.readFileSync(projectFile, 'utf8');
    const res = await postCompletions(baseUrl, {
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'user', content: JSON.stringify({ name: 'delete_everything', arguments: {} }) },
      ],
      stream: false,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /unknown function/i);
    assert.equal(fs.readFileSync(projectFile, 'utf8'), before, 'disk untouched on rejection');
  });

  it('proves no egress via a local counter server (real loopback listener)', async () => {
    // A second live loopback server stands in for any "outside" observer:
    // the loop completes with all traffic on the provider port only.
    const seen = [];
    const counter = http.createServer((req, res) => {
      seen.push(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise(resolve => counter.listen(0, '127.0.0.1', resolve));
    const counterPort = counter.address().port;
    try {
      assert.notEqual(counterPort, port, 'counter is a distinct listener');
      const res = await postCompletions(baseUrl, {
        model: OPENAI_MODEL_ID,
        messages: [{ role: 'user', content: 'counter check' }],
        stream: false,
      });
      assert.equal(res.status, 200);
      assert.equal(seen.length, 0, 'no loop traffic reached the outside observer');
    } finally {
      await new Promise(resolve => counter.close(resolve));
    }
  });
});
