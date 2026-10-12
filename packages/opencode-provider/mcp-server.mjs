#!/usr/bin/env node
// Model Context Protocol (MCP) Server for GDevelop (Phase 3 integration).
//
// Exposes GDevelop project inspection, manipulation, CLI dispatch, resources,
// and prompt templates over standard MCP STDIO JSON-RPC 2.0 transport.
//
// Compatible with Claude Code, OpenCode, Cursor, Aider, and Antigravity.
// Zero external dependencies: native Node.js builtins only.

import readline from 'node:readline';
import {
  readGDevelopProject,
  writeGDevelopProject,
  createScene,
  createOrReplaceObject,
  addBehavior,
  addStandardEvent,
  buildGDevelopCliCommand,
} from '../unlock-shim/control-shim.mjs';
import { GDEVELOP_TOOLS } from '../opencode-gdevelop/tools.mjs';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'gdevelop-mcp-server';
export const SERVER_VERSION = '0.1.0';

export const MCP_RESOURCES = [
  {
    uri: 'gdevelop://schema/project-structure',
    name: 'GDevelop Project Structure',
    description: 'Structure specification for GDevelop game.json and split-storage references.',
    mimeType: 'application/json',
    text: JSON.stringify({
      description: 'GDevelop project file hierarchy and split folder semantics',
      rootKeys: ['properties', 'resources', 'objects', 'layouts', 'externalEvents', 'eventsFunctionsExtensions'],
      splitObjectMarker: '__REFERENCE_TO_SPLIT_OBJECT',
      layoutKeys: ['name', 'objects', 'layers', 'events', 'variables', 'r', 'v', 'b'],
    }, null, 2),
  },
  {
    uri: 'gdevelop://docs/engine-architecture',
    name: 'GDevelop Engine Architecture',
    description: 'Runtime model: GDJS game loops, scene lifecycles, and event evaluation.',
    mimeType: 'text/markdown',
    text: `# GDevelop 5 Runtime Architecture
- **GDJS Lifecycle**: Initialization -> Step (scene events, behaviors, physics) -> Render (PixiJS 2D / Three.js 3D).
- **Scene Storage**: Layouts hold scene instances, layers, local variables, and event sheets.
- **Event Engine**: Instruction sequences composed of conditions (boolean test) and actions (state mutations).
- **Zero-Egress Design**: Fully self-contained local project files without cloud lock-in.`,
  },
  {
    uri: 'gdevelop://docs/behavior-catalog',
    name: 'Standard Behavior Catalog',
    description: 'Catalog of core GDevelop 2D and 3D behaviors.',
    mimeType: 'text/markdown',
    text: `# Standard GDevelop Behaviors
- **Platformer**: \`PlatformBehavior::PlatformerObjectBehavior\`, \`PlatformBehavior::PlatformBehavior\`
- **Physics**: \`Physics2::Physics2Behavior\`, \`Physics3D::Physics3DBehavior\`
- **Movement**: \`TopDownMovementBehavior::TopDownMovementBehavior\`, \`PathfindingBehavior::PathfindingBehavior\`
- **Tweening**: \`Tween::TweenBehavior\``,
  },
];

export const MCP_PROMPTS = [
  {
    name: 'gdevelop_game_architect',
    description: 'System instructions for architecting a GDevelop 5 game with clean AST modifications.',
    arguments: [
      {
        name: 'genre',
        description: 'Game genre (e.g. platformer, top-down, puzzle)',
        required: false,
      },
    ],
    generate: (args = {}) => {
      const genre = args.genre || '2D / 3D game';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are an expert GDevelop 5 game architect. Your mission is to plan and implement a ${genre} using local GDevelop project control tools. Always inspect the project first using gdevelop_project_read, plan standard object hierarchies, attach appropriate behaviors, and construct event sheets with conditions and actions.`,
          },
        },
      ];
    },
  },
];

/** Convert host GDEVELOP_TOOLS into MCP tool definitions. */
export function getMcpTools() {
  return GDEVELOP_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input,
  }));
}

/** Execute an MCP tool call by name. */
export async function handleToolCall(name, args) {
  const tool = GDEVELOP_TOOLS.find(t => t.name === name);
  if (!tool) {
    throw new Error(`[mcp] unknown tool: "${name}"`);
  }
  const result = await tool.execute(args || {});
  return {
    content: [
      {
        type: 'text',
        text: typeof result.output === 'object'
          ? JSON.stringify(result.output, null, 2)
          : String(result.content || result.output),
      },
    ],
    isError: false,
  };
}

/** Dispatch incoming JSON-RPC 2.0 message. */
export async function handleRpcMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const { id, method, params } = msg;

  // Notifications (no id)
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      // client initialized acknowledgement
      return null;
    }
    return null;
  }

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              resources: {},
              prompts: {},
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          },
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: getMcpTools(),
          },
        };
      }

      case 'tools/call': {
        if (!params || !params.name) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name parameter' },
          };
        }
        try {
          const callResult = await handleToolCall(params.name, params.arguments);
          return {
            jsonrpc: '2.0',
            id,
            result: callResult,
          };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: err.message }],
              isError: true,
            },
          };
        }
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resources: MCP_RESOURCES.map(r => ({
              uri: r.uri,
              name: r.name,
              description: r.description,
              mimeType: r.mimeType,
            })),
          },
        };
      }

      case 'resources/read': {
        const uri = params && params.uri;
        const res = MCP_RESOURCES.find(r => r.uri === uri);
        if (!res) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Resource not found: ${uri}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri: res.uri,
                mimeType: res.mimeType,
                text: res.text,
              },
            ],
          },
        };
      }

      case 'prompts/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            prompts: MCP_PROMPTS.map(p => ({
              name: p.name,
              description: p.description,
              arguments: p.arguments,
            })),
          },
        };
      }

      case 'prompts/get': {
        const promptName = params && params.name;
        const p = MCP_PROMPTS.find(entry => entry.name === promptName);
        if (!p) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Prompt not found: ${promptName}` },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            messages: p.generate(params && params.arguments),
          },
        };
      }

      default: {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: `Internal error: ${err.message}` },
    };
  }
}

/**
 * Start the MCP STDIO server listening on stdin / stdout.
 */
export function startMcpStdioServer(inStream = process.stdin, outStream = process.stdout) {
  const rl = readline.createInterface({
    input: inStream,
    output: null,
    terminal: false,
  });

  rl.on('line', async line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let payloadText = trimmed;
    // Tolerate optional LSP-style Content-Length prefix if passed
    if (trimmed.startsWith('Content-Length:')) {
      const parts = trimmed.split('\r\n\r\n');
      if (parts.length > 1) payloadText = parts[1].trim();
    }

    try {
      const msg = JSON.parse(payloadText);
      const resp = await handleRpcMessage(msg);
      if (resp) {
        outStream.write(JSON.stringify(resp) + '\n');
      }
    } catch (parseErr) {
      const errResp = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      outStream.write(JSON.stringify(errResp) + '\n');
    }
  });

  return rl;
}

// Auto-run if executed directly as a script
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  startMcpStdioServer();
}
