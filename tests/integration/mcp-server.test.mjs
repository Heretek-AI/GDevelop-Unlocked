// Integration tests for Model Context Protocol (MCP) STDIO server (Tier 4).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import {
  MCP_PROTOCOL_VERSION,
  SERVER_NAME,
  handleRpcMessage,
  startMcpStdioServer,
  SecurityEngine,
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
        layers: [{ name: 'Base layer', visibility: true, effects: [], cameras: [] }],
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
    assert.ok(resp.result.capabilities.logging);
  });

  it('lists all native and legacy GDevelop tools with valid JSON schemas', async () => {
    const req = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    const resp = await handleRpcMessage(req);
    assert.equal(resp.id, 2);
    const tools = resp.result.tools;
    assert.ok(tools.length >= 10);
    const names = tools.map(t => t.name);

    // Native Tier 4 tools
    assert.ok(names.includes('gd_project_read'));
    assert.ok(names.includes('gd_project_write'));
    assert.ok(names.includes('gd_scene_create'));
    assert.ok(names.includes('gd_object_create_or_replace'));
    assert.ok(names.includes('gd_behavior_add'));
    assert.ok(names.includes('gd_event_inject'));
    assert.ok(names.includes('gd_extension_build'));
    assert.ok(names.includes('gd_preview_run'));
    assert.ok(names.includes('gd_preview_stop'));
    assert.ok(names.includes('gd_debugger_eval'));

    // Legacy aliases
    assert.ok(names.includes('gdevelop_project_read'));
    assert.ok(names.includes('gdevelop_project_create_scene'));
    assert.ok(names.includes('gdevelop_project_create_object'));
    assert.ok(names.includes('gdevelop_project_add_behavior'));
    assert.ok(names.includes('gdevelop_project_add_events'));
    assert.ok(names.includes('gdevelop_cli_run'));

    for (const t of tools) {
      assert.ok(t.description);
      assert.equal(t.inputSchema.type, 'object');
      assert.ok(t.inputSchema.properties);
    }
  });

  it('executes native gd_* AST mutation tools on real disk project', async () => {
    const { dir, projectPath } = makeScratchProject();
    try {
      // 1. Read project
      const readResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'gd_project_read',
          arguments: { projectPath },
        },
      });
      assert.equal(readResp.result.isError, false);
      const parsedOutput = JSON.parse(readResp.result.content[0].text);
      assert.equal(parsedOutput.projectName, 'McpTestGame');
      assert.equal(parsedOutput.scenes.length, 1);

      // 2. Create scene
      const sceneResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'gd_scene_create',
          arguments: { projectPath, sceneName: 'Level1' },
        },
      });
      assert.equal(sceneResp.result.isError, false);

      // 3. Create object in scene
      const objResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'gd_object_create_or_replace',
          arguments: {
            projectPath,
            sceneName: 'Level1',
            objectName: 'Player',
            objectType: 'Sprite',
          },
        },
      });
      assert.equal(objResp.result.isError, false);

      // 4. Add behavior
      const behResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'gd_behavior_add',
          arguments: {
            projectPath,
            sceneName: 'Level1',
            objectName: 'Player',
            behaviorName: 'PlatformerObject',
            behaviorType: 'PlatformBehavior::PlatformerObjectBehavior',
          },
        },
      });
      assert.equal(behResp.result.isError, false);

      // 5. Inject events
      const evtResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'gd_event_inject',
          arguments: {
            projectPath,
            sceneName: 'Level1',
            conditions: [{ type: { value: 'KeyPressed' }, parameters: ['Space'] }],
            actions: [{ type: { value: 'DoStep' }, parameters: ['Player'] }],
          },
        },
      });
      assert.equal(evtResp.result.isError, false);

      // 6. Build extension
      const extResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'gd_extension_build',
          arguments: {
            projectPath,
            extensionName: 'FastMath',
            jsCode: 'return Math.hypot(10, 20);',
            functionName: 'CalculateHypot',
          },
        },
      });
      assert.equal(extResp.result.isError, false);

      // 7. Verify all mutations persisted directly to disk
      const updated = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
      assert.equal(updated.layouts.length, 2);
      const level1 = updated.layouts.find(l => l.name === 'Level1');
      assert.ok(level1);
      assert.equal(level1.objects.length, 1);
      assert.equal(level1.objects[0].name, 'Player');
      assert.equal(level1.objects[0].behaviors.length, 1);
      assert.equal(level1.events.length, 1);
      assert.equal(updated.eventsFunctionsExtensions.length, 1);
      assert.equal(updated.eventsFunctionsExtensions[0].name, 'FastMath');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs and terminates managed loopback game preview (gd_preview_run / gd_preview_stop)', async () => {
    const { dir, projectPath } = makeScratchProject();
    try {
      const runResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'gd_preview_run',
          arguments: { projectPath, port: 3847 },
        },
      });
      assert.equal(runResp.result.isError, false);
      const runData = JSON.parse(runResp.result.content[0].text);
      assert.ok(runData.previewId);
      assert.equal(runData.status, 'running');
      assert.equal(runData.port, 3847);
      assert.equal(runData.host, '127.0.0.1');

      // Stop the preview
      const stopResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'gd_preview_stop',
          arguments: { previewId: runData.previewId },
        },
      });
      assert.equal(stopResp.result.isError, false);
      const stopData = JSON.parse(stopResp.result.content[0].text);
      assert.equal(stopData.stopped, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('evaluates debugger expressions over loopback WebSocket bridge (gd_debugger_eval)', async () => {
    // Spin up a minimal RFC6455 loopback WebSocket server double on an ephemeral port
    const port = 3982;
    const server = net.createServer(socket => {
      let handshook = false;
      socket.on('data', chunk => {
        if (!handshook) {
          const head = chunk.toString('latin1');
          const key = /Sec-WebSocket-Key:\s*(.*)/i.exec(head)?.[1].trim();
          const accept = crypto
            .createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');
          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
          );
          handshook = true;
          return;
        }
        // Respond with an unmasked text frame containing telemetry
        const respPayload = Buffer.from(JSON.stringify({ status: 'ok', fps: 60 }), 'utf8');
        socket.write(Buffer.concat([Buffer.from([0x81, respPayload.length]), respPayload]));
      });
    });

    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

    try {
      const evalResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'gd_debugger_eval',
          arguments: {
            port,
            command: 'getSceneState',
            expression: 'gdjs.RuntimeGame',
          },
        },
      });
      assert.equal(evalResp.result.isError, false);
      const parsed = JSON.parse(evalResp.result.content[0].text);
      assert.equal(parsed.command, 'getSceneState');
      assert.equal(parsed.response.fps, 60);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('lists and dynamically reads GDevelop resources and templates', async () => {
    const { dir, projectPath } = makeScratchProject();
    try {
      // Prime active project
      await handleRpcMessage({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'gd_project_read', arguments: { projectPath } },
      });

      // 1. List static resources
      const listResp = await handleRpcMessage({ jsonrpc: '2.0', id: 13, method: 'resources/list' });
      assert.ok(listResp.result.resources.length >= 5);

      // 2. List resource templates
      const templatesResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 14,
        method: 'resources/templates/list',
      });
      assert.ok(templatesResp.result.resourceTemplates.length >= 2);
      assert.ok(
        templatesResp.result.resourceTemplates.some(t =>
          t.uriTemplate.includes('gdevelop://scene/{scene_name}')
        )
      );

      // 3. Dynamic read: current project
      const currResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 15,
        method: 'resources/read',
        params: { uri: 'gdevelop://project/current' },
      });
      assert.equal(currResp.result.contents[0].uri, 'gdevelop://project/current');
      const currProject = JSON.parse(currResp.result.contents[0].text);
      assert.equal(currProject.properties.name, 'McpTestGame');

      // 4. Dynamic read: parameterized scene
      const sceneResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 16,
        method: 'resources/read',
        params: { uri: 'gdevelop://scene/MainScene' },
      });
      const sceneData = JSON.parse(sceneResp.result.contents[0].text);
      assert.equal(sceneData.name, 'MainScene');

      // 5. Dynamic read: parameterized events
      const eventsResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 17,
        method: 'resources/read',
        params: { uri: 'gdevelop://events/MainScene' },
      });
      const eventsData = JSON.parse(eventsResp.result.contents[0].text);
      assert.ok(Array.isArray(eventsData));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists and generates prompt templates for architectural guidance', async () => {
    const listResp = await handleRpcMessage({ jsonrpc: '2.0', id: 18, method: 'prompts/list' });
    const promptNames = listResp.result.prompts.map(p => p.name);
    assert.ok(promptNames.includes('architect-game-scene'));
    assert.ok(promptNames.includes('debug-event-sheet'));
    assert.ok(promptNames.includes('wrap-js-extension'));
    assert.ok(promptNames.includes('inspect-runtime-performance'));

    const getResp = await handleRpcMessage({
      jsonrpc: '2.0',
      id: 19,
      method: 'prompts/get',
      params: {
        name: 'architect-game-scene',
        arguments: { sceneName: 'BossRoom', genre: 'Metroidvania', dimension: '2D' },
      },
    });
    const msg = getResp.result.messages[0];
    assert.equal(msg.role, 'user');
    assert.ok(msg.content.text.includes('BossRoom'));
    assert.ok(msg.content.text.includes('Metroidvania'));
  });

  it('enforces strict security gates: path containment, zero-egress, and confirmation', async () => {
    const { dir, projectPath } = makeScratchProject();
    try {
      // 1. Path Containment Enforcement
      const securityWithBoundary = new SecurityEngine({
        allowedProjectRoots: [dir],
      });
      const escapedPath = path.resolve(dir, '../../evil-game.json');
      const containResp = await handleRpcMessage(
        {
          jsonrpc: '2.0',
          id: 20,
          method: 'tools/call',
          params: {
            name: 'gd_project_read',
            arguments: { projectPath: escapedPath },
          },
        },
        { security: securityWithBoundary }
      );
      assert.equal(containResp.result.isError, true);
      assert.ok(containResp.result.content[0].text.includes('Path containment violation'));

      // 2. Zero-Egress Enforcement (blocks api.gdevelop.io & external endpoints)
      const egressResp = await handleRpcMessage({
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'gd_extension_build',
          arguments: {
            projectPath,
            extensionName: 'CloudLeak',
            description: 'Calls https://api.gdevelop.io/v1/auth',
          },
        },
      });
      assert.equal(egressResp.result.isError, true);
      assert.ok(egressResp.result.content[0].text.includes('Zero-egress violation'));

      // 3. Confirmation Requirement Enforcement (ask policy requires confirmed: true)
      const securityWithConfirmation = new SecurityEngine({
        mutatingPermission: 'ask',
      });
      const unconfirmedResp = await handleRpcMessage(
        {
          jsonrpc: '2.0',
          id: 22,
          method: 'tools/call',
          params: {
            name: 'gd_scene_create',
            arguments: { projectPath, sceneName: 'GateScene' },
          },
        },
        { security: securityWithConfirmation }
      );
      assert.equal(unconfirmedResp.result.isError, true);
      assert.ok(unconfirmedResp.result.content[0].text.includes('Confirmation required'));

      // Succeeds when confirmed: true is provided
      const confirmedResp = await handleRpcMessage(
        {
          jsonrpc: '2.0',
          id: 23,
          method: 'tools/call',
          params: {
            name: 'gd_scene_create',
            arguments: { projectPath, sceneName: 'GateScene', confirmed: true },
          },
        },
        { security: securityWithConfirmation }
      );
      assert.equal(confirmedResp.result.isError, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('streams request and response over STDIO readline interface with notifications', async () => {
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
