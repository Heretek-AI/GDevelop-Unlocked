// Integration tests for Model Context Protocol (MCP) STDIO server.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  handleRpcMessage,
  startMcpStdioServer,
} from '../../packages/opencode-provider/mcp-server.mjs';

function makeScratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  const projectPath = path.join(dir, 'game.json');
  const initial = {
    properties: { name: 'McpTestGame', version: '1.0.0' },
    resources: { resources: [] },
    objects: [],
    layouts: [
      {
        name: 'MainScene',
        objects: [],
        layers: [{ name: '', visibility: true }],
        events: [],
        variables: [],
      },
    ],
  };
  fs.writeFileSync(projectPath, JSON.stringify(initial, null, 2));
  return { dir, projectPath };
}

describe('integration: mcp server protocol and lifecycle', () => {
  it('handles initialize negotiation with compliant capabilities', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        clientInfo: { name: 'claude-code', version: '1.0.0' },
      },
    };
    const resp = await handleRpcMessage(req);
    assert.equal(resp.jsonrpc, '2.0');
    assert.equal(resp.id, 1);
    assert.equal(resp.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(resp.result.serverInfo.name, SERVER_NAME);
    assert.ok(resp.result.capabilities.tools);
    assert.ok(resp.result.capabilities.resources);
    assert.ok(resp.result.capabilities.prompts);
  });

  it('lists all 6 GDevelop tools with valid JSON schemas', async () => {
    const req = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    const resp = await handleRpcMessage(req);
    assert.equal(resp.id, 2);
    const tools = resp.result.tools;
    assert.equal(tools.length, 6);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('gdevelop_project_read'));
    assert.ok(names.includes('gdevelop_project_create_scene'));
    assert.ok(names.includes('gdevelop_project_create_object'));
    assert.ok(names.includes('gdevelop_project_add_behavior'));
    assert.ok(names.includes('gdevelop_project_add_events'));
    assert.ok(names.includes('gdevelop_cli_run'));

    for (const t of tools) {
      assert.ok(t.description);
      assert.equal(t.inputSchema.type, 'object');
      assert.ok(Array.isArray(t.inputSchema.required));
    }
  });

  it('executes gdevelop_project_read and gdevelop_project_create_scene on real disk project', async () => {
    const { dir, projectPath } = makeScratchProject();
    try {
      // 1. Read project
      const readReq = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'gdevelop_project_read',
          arguments: { projectPath },
        },
      };
      const readResp = await handleRpcMessage(readReq);
      assert.equal(readResp.result.isError, false);
      const parsedOutput = JSON.parse(readResp.result.content[0].text);
      assert.equal(parsedOutput.projectName, 'McpTestGame');
      assert.equal(parsedOutput.scenes.length, 1);

      // 2. Create scene
      const createReq = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'gdevelop_project_create_scene',
          arguments: { projectPath, sceneName: 'Level2' },
        },
      };
      const createResp = await handleRpcMessage(createReq);
      assert.equal(createResp.result.isError, false);

      // 3. Verify on disk
      const updated = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
      assert.equal(updated.layouts.length, 2);
      assert.ok(updated.layouts.some(l => l.name === 'Level2'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns structured isError: true on invalid tool arguments', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'gdevelop_project_read',
        arguments: { projectPath: '/non/existent/path/game.json' },
      },
    };
    const resp = await handleRpcMessage(req);
    assert.equal(resp.result.isError, true);
    assert.ok(resp.result.content[0].text.includes('project path not found'));
  });

  it('lists and reads GDevelop resources', async () => {
    const listReq = { jsonrpc: '2.0', id: 6, method: 'resources/list' };
    const listResp = await handleRpcMessage(listReq);
    assert.ok(listResp.result.resources.length >= 3);

    const readReq = {
      jsonrpc: '2.0',
      id: 7,
      method: 'resources/read',
      params: { uri: 'gdevelop://docs/engine-architecture' },
    };
    const readResp = await handleRpcMessage(readReq);
    assert.equal(readResp.result.contents[0].uri, 'gdevelop://docs/engine-architecture');
    assert.ok(readResp.result.contents[0].text.includes('GDJS Lifecycle'));
  });

  it('lists and generates prompt templates', async () => {
    const listReq = { jsonrpc: '2.0', id: 8, method: 'prompts/list' };
    const listResp = await handleRpcMessage(listReq);
    assert.ok(listResp.result.prompts.some(p => p.name === 'gdevelop_game_architect'));

    const getReq = {
      jsonrpc: '2.0',
      id: 9,
      method: 'prompts/get',
      params: {
        name: 'gdevelop_game_architect',
        arguments: { genre: 'Physics Puzzle' },
      },
    };
    const getResp = await handleRpcMessage(getReq);
    const msg = getResp.result.messages[0];
    assert.equal(msg.role, 'user');
    assert.ok(msg.content.text.includes('Physics Puzzle'));
  });

  it('streams request and response over STDIO readline interface', async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const rl = startMcpStdioServer(inStream, outStream);

    let outputData = '';
    outStream.on('data', chunk => {
      outputData += chunk.toString('utf8');
    });

    inStream.write(JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'ping' }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 50));
    rl.close();

    assert.ok(outputData.includes('"id":42'));
    assert.ok(outputData.includes('"result":{}'));
  });
});
