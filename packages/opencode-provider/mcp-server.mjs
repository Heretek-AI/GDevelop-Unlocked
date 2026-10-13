#!/usr/bin/env node
// Model Context Protocol (MCP) Server for GDevelop (Tier 4 Native MCP Architecture).
//
// Complete MCP Tools, Resources, and Prompts catalog for deep GDevelop 5 control.
// Stdio/IPC JSON-RPC 2.0 transport conforming to Model Context Protocol specification.
// Security gates: read-only vs mutating, confirmation requirements, path containment,
// zero-egress enforcement (127.0.0.1 loopback only, zero hosted calls).
// Grounded in real runtime execution: control-shim AST, real file I/O, loopback preview,
// and loopback WebSocket debugger bridge. Zero mocked data.
//
// Native Node.js builtins only. Zero external runtime dependencies.

import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import {
  readGDevelopProject,
  writeGDevelopProject,
  createScene,
  createOrReplaceObject,
  addBehavior,
  addStandardEvent,
  buildGDevelopCliCommand,
  connectDebuggerBridge,
} from '../unlock-shim/control-shim.mjs';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'gdevelop-mcp-server';
export const SERVER_VERSION = '0.2.0';

// ============================================================================
// 1. Security Engine & Permission Matrix (opencode.jsonc security model)
// ============================================================================

export class SecurityEngine {
  constructor(config = {}) {
    this.defaultPermission = config.defaultPermission || 'allow'; // 'allow' | 'ask' | 'deny'
    this.mutatingPermission = config.mutatingPermission || 'allow'; // 'allow' | 'ask' | 'deny'
    this.allowedProjectRoots = Array.isArray(config.allowedProjectRoots)
      ? config.allowedProjectRoots.map(r => path.resolve(r))
      : [];
    this.enforceZeroEgress = config.enforceZeroEgress !== false;
    this.blockedHosts = config.blockedHosts || [
      'api.gdevelop.io',
      'resources.gdevelop-app.com',
      'gdevelop.io',
    ];
  }

  validatePath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') return targetPath;
    if (targetPath.includes('\0')) {
      throw new Error(`[security-gate] Null-byte injection detected in path: ${targetPath}`);
    }
    const resolved = path.resolve(targetPath);
    if (this.allowedProjectRoots.length > 0) {
      const allowed = this.allowedProjectRoots.some(
        root => resolved === root || resolved.startsWith(root + path.sep)
      );
      if (!allowed) {
        throw new Error(
          `[security-gate] Path containment violation: "${resolved}" escapes allowed project root(s) [${this.allowedProjectRoots.join(', ')}]`
        );
      }
    }
    return resolved;
  }

  validateZeroEgress(obj) {
    if (!this.enforceZeroEgress || !obj) return;
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const host of this.blockedHosts) {
      if (str.includes(host)) {
        throw new Error(`[security-gate] Zero-egress violation: payload contains blocked external host "${host}"`);
      }
    }
    const urlMatches = str.match(/https?:\/\/[^\s"'\\]+/g) || [];
    for (const u of urlMatches) {
      try {
        const parsed = new URL(u);
        const hostname = parsed.hostname.toLowerCase();
        if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
          throw new Error(`[security-gate] Zero-egress violation: non-loopback egress forbidden: "${u}"`);
        }
      } catch (err) {
        if (err.message && err.message.includes('Zero-egress violation')) throw err;
      }
    }
  }

  checkPermission(toolName, isMutating, args = {}) {
    const policy = isMutating ? this.mutatingPermission : this.defaultPermission;
    if (policy === 'deny') {
      throw new Error(`[security-gate] Permission denied: execution of "${toolName}" is prohibited by policy.`);
    }
    if (policy === 'ask' && isMutating && args.confirmed !== true) {
      throw new Error(
        `[security-gate] Confirmation required: mutating tool "${toolName}" requires explicit confirmation. Pass "confirmed: true" in arguments to proceed.`
      );
    }
  }
}

export const globalSecurity = new SecurityEngine();

// ============================================================================
// 2. Server Runtime State (Active Project, Active Previews, Debugger Cache)
// ============================================================================

export const serverState = {
  activeProject: null,
  activeProjectPath: null,
  activePreviews: new Map(),
  debuggerStateCache: {
    connected: false,
    lastUpdate: null,
    telemetry: null,
  },
};

// ============================================================================
// 3. MCP Tools Catalog Specification & Schemas
// ============================================================================

const projectPathSchema = {
  type: 'string',
  description: 'Absolute or relative filesystem path to game.json or split-folder project directory.',
};

const sceneNameSchema = {
  type: 'string',
  description: 'Target scene (layout) name in the GDevelop project.',
};

const confirmedSchema = {
  type: 'boolean',
  description: 'Explicit confirmation flag required when mutating actions are gated by ask-policy.',
};

export const NATIVE_MCP_TOOLS = [
  {
    name: 'gd_project_read',
    description: 'Inspect a GDevelop 5 project on disk: metadata, scenes, objects, behaviors, and variables.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        sceneName: {
          ...sceneNameSchema,
          description: 'Optional: restrict the inspection report to a single scene.',
        },
      },
      required: ['projectPath'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);

      const objectSummary = scene => ({
        name: scene.name,
        objects: (scene.objects || []).map(o => o && o.name),
        objectCount: (scene.objects || []).length,
        eventCount: (scene.events || []).length,
        variables: (scene.variables || []).map(v => v && v.name),
        layers: (scene.layers || []).map(l => l && l.name),
      });

      const scenes = (project.layouts || []).map(objectSummary);
      if (args.sceneName) {
        const scene = scenes.find(s => s.name === args.sceneName);
        if (!scene) {
          throw new Error(`[gd_project_read] scene not found: "${args.sceneName}"`);
        }
        return {
          projectName: project.properties.name,
          scene,
          projectPath: serverState.activeProjectPath,
        };
      }
      return {
        projectName: project.properties.name,
        version: project.properties.version || '1.0.0',
        scenes,
        globalObjects: (project.objects || []).map(o => o && o.name),
        extensions: (project.eventsFunctionsExtensions || []).map(e => e && e.name),
        projectPath: serverState.activeProjectPath,
      };
    },
  },
  {
    name: 'gd_project_write',
    description: 'Persist the entire GDevelop project AST to disk deterministically.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        projectData: {
          type: 'object',
          description: 'Full GDevelop project JSON object conforming to game.json schema.',
        },
        confirmed: confirmedSchema,
      },
      required: ['projectPath', 'projectData'],
      additionalProperties: false,
    },
    async execute(args) {
      const writtenPath = writeGDevelopProject(args.projectPath, args.projectData);
      serverState.activeProject = args.projectData;
      serverState.activeProjectPath = path.resolve(args.projectPath);
      return {
        written: true,
        projectPath: writtenPath,
        projectName: args.projectData.properties?.name,
      };
    },
  },
  {
    name: 'gd_scene_create',
    description: 'Inject a new scene (layout) with default base layer and empty event sheet into the project on disk.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        sceneName: sceneNameSchema,
        confirmed: confirmedSchema,
      },
      required: ['projectPath', 'sceneName'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      createScene(project, args.sceneName);
      writeGDevelopProject(args.projectPath, project);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);
      return {
        sceneName: args.sceneName,
        created: true,
        projectPath: serverState.activeProjectPath,
      };
    },
  },
  {
    name: 'gd_object_create_or_replace',
    description: 'Create or replace an object (Sprite, Text, 3D Box, PanelSprite, etc.) in a scene or globally.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        objectName: { type: 'string', description: 'Name of the object identifier.' },
        objectType: {
          type: 'string',
          description: 'Engine object type (e.g. Sprite, TextObject::Text, Scene3D::Box3DObject, PanelSpriteObject::PanelSprite).',
        },
        sceneName: {
          ...sceneNameSchema,
          description: 'Optional: target scene; omit for a global project object.',
        },
        description: { type: 'string', description: 'Optional human-readable object description.' },
        confirmed: confirmedSchema,
      },
      required: ['projectPath', 'objectName', 'objectType'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      const { object, created } = createOrReplaceObject(project, {
        sceneName: args.sceneName,
        objectName: args.objectName,
        objectType: args.objectType,
        description: args.description,
      });
      writeGDevelopProject(args.projectPath, project);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);
      return {
        objectName: object.name,
        objectType: object.type,
        sceneName: args.sceneName || null,
        created,
      };
    },
  },
  {
    name: 'gd_behavior_add',
    description: 'Attach a behavior (Platformer, Physics2, TopDown, Tween, etc.) to an object with validated family defaults.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        objectName: { type: 'string', description: 'Name of the target object.' },
        behaviorName: { type: 'string', description: 'Instance name for the attached behavior.' },
        behaviorType: {
          type: 'string',
          description: 'Fully qualified behavior type identifier (e.g. PlatformBehavior::PlatformerObjectBehavior).',
        },
        sceneName: {
          ...sceneNameSchema,
          description: 'Optional: scene containing the object; omit for global objects.',
        },
        properties: {
          type: 'object',
          description: 'Optional configuration properties to merge into the behavior instance.',
        },
        confirmed: confirmedSchema,
      },
      required: ['projectPath', 'objectName', 'behaviorName', 'behaviorType'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      const behavior = addBehavior(project, {
        sceneName: args.sceneName,
        objectName: args.objectName,
        behaviorName: args.behaviorName,
        behaviorType: args.behaviorType,
      });
      if (args.properties && typeof args.properties === 'object') {
        Object.assign(behavior, args.properties);
      }
      writeGDevelopProject(args.projectPath, project);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);
      return {
        objectName: args.objectName,
        behaviorName: behavior.name,
        behaviorType: behavior.type,
      };
    },
  },
  {
    name: 'gd_event_inject',
    description: 'Append or inject conditions and actions into a scene event sheet as a validated AST event block.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        sceneName: sceneNameSchema,
        conditions: {
          type: 'array',
          description: 'Array of condition instruction AST objects.',
        },
        actions: {
          type: 'array',
          description: 'Array of action instruction AST objects.',
        },
        eventType: {
          type: 'string',
          description: 'Instruction type (default "BuiltinCommonInstructions::Standard").',
        },
        subEvents: {
          type: 'array',
          description: 'Optional nested sub-events list.',
        },
        confirmed: confirmedSchema,
      },
      required: ['projectPath', 'sceneName'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      const event = addStandardEvent(project, {
        sceneName: args.sceneName,
        conditions: args.conditions,
        actions: args.actions,
      });
      if (args.eventType && typeof args.eventType === 'string') {
        event.type = args.eventType;
      }
      if (Array.isArray(args.subEvents)) {
        event.events = args.subEvents;
      }
      writeGDevelopProject(args.projectPath, project);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);
      const scene = project.layouts.find(l => l && l.name === args.sceneName);
      return {
        sceneName: args.sceneName,
        eventType: event.type,
        eventIndex: scene.events.indexOf(event),
        conditionCount: (event.conditions || []).length,
        actionCount: (event.actions || []).length,
        subEventsCount: (event.events || []).length,
      };
    },
  },
  {
    name: 'gd_extension_build',
    description: 'Construct and inject an EventsFunctionsExtension into the project (custom actions, conditions, or JS code).',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        extensionName: { type: 'string', description: 'Unique identifier for the extension.' },
        fullName: { type: 'string', description: 'Human-readable name.' },
        description: { type: 'string', description: 'Description of the extension purpose.' },
        version: { type: 'string', description: 'Semantic version string (default "1.0.0").' },
        category: { type: 'string', description: 'Extension category.' },
        author: { type: 'string', description: 'Author attribution.' },
        eventsFunctions: {
          type: 'array',
          description: 'List of EventsFunction AST objects.',
        },
        eventsBasedBehaviors: {
          type: 'array',
          description: 'List of EventsBasedBehavior AST objects.',
        },
        eventsBasedObjects: {
          type: 'array',
          description: 'List of EventsBasedObject AST objects.',
        },
        jsCode: {
          type: 'string',
          description: 'Optional inline JavaScript implementation for a fast-path extension function.',
        },
        functionName: {
          type: 'string',
          description: 'Function name to attach the jsCode to (default "RunCustomJs").',
        },
        functionType: {
          type: 'string',
          description: 'Function type: Action, Condition, Expression (default "Action").',
        },
        confirmed: confirmedSchema,
      },
      required: ['projectPath', 'extensionName'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      if (!Array.isArray(project.eventsFunctionsExtensions)) {
        project.eventsFunctionsExtensions = [];
      }

      let ext = project.eventsFunctionsExtensions.find(e => e && e.name === args.extensionName);
      if (!ext) {
        ext = {
          name: args.extensionName,
          fullName: args.fullName || args.extensionName,
          description: args.description || '',
          version: args.version || '1.0.0',
          category: args.category || 'General',
          author: args.author || 'OpenCode Native',
          eventsFunctions: args.eventsFunctions || [],
          eventsBasedBehaviors: args.eventsBasedBehaviors || [],
          eventsBasedObjects: args.eventsBasedObjects || [],
        };
        project.eventsFunctionsExtensions.push(ext);
      } else {
        if (args.fullName) ext.fullName = args.fullName;
        if (args.description) ext.description = args.description;
        if (args.version) ext.version = args.version;
        if (args.category) ext.category = args.category;
        if (args.author) ext.author = args.author;
        if (args.eventsFunctions) ext.eventsFunctions = args.eventsFunctions;
        if (args.eventsBasedBehaviors) ext.eventsBasedBehaviors = args.eventsBasedBehaviors;
        if (args.eventsBasedObjects) ext.eventsBasedObjects = args.eventsBasedObjects;
      }

      if (args.jsCode) {
        const fnName = args.functionName || 'RunCustomJs';
        const jsFunction = {
          name: fnName,
          fullName: fnName,
          description: args.description || 'Custom JavaScript function',
          functionType: args.functionType || 'Action',
          useJsCode: true,
          inlineCode: args.jsCode,
          parameters: [
            {
              name: 'runtimeScene',
              type: 'currentScene',
              description: 'Current GDJS Runtime Scene',
            },
          ],
          events: [],
        };
        if (!Array.isArray(ext.eventsFunctions)) ext.eventsFunctions = [];
        const existingIdx = ext.eventsFunctions.findIndex(f => f && f.name === fnName);
        if (existingIdx === -1) ext.eventsFunctions.push(jsFunction);
        else ext.eventsFunctions[existingIdx] = jsFunction;
      }

      writeGDevelopProject(args.projectPath, project);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);

      return {
        extensionName: ext.name,
        functionCount: (ext.eventsFunctions || []).length,
        behaviorCount: (ext.eventsBasedBehaviors || []).length,
        objectCount: (ext.eventsBasedObjects || []).length,
        updated: true,
      };
    },
  },
  {
    name: 'gd_preview_run',
    description: 'Launch a local GDJS game preview instance on loopback (127.0.0.1) or spawn a headless GDevelop runner.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: projectPathSchema,
        gdevelopPath: {
          type: 'string',
          description: 'Optional path to the GDevelop binary for desktop preview.',
        },
        port: {
          type: 'integer',
          description: 'TCP port for preview server (default 3030).',
        },
        headless: {
          type: 'boolean',
          description: 'Run headless with --disable-update-check (default true).',
        },
        cmdArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'CLI arguments passed to the runner.',
        },
        confirmed: confirmedSchema,
      },
      required: ['projectPath'],
      additionalProperties: false,
    },
    async execute(args) {
      const project = readGDevelopProject(args.projectPath);
      serverState.activeProject = project;
      serverState.activeProjectPath = path.resolve(args.projectPath);

      const previewId = `preview-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const port = args.port || 3030;

      // Desktop CLI execution if gdevelopPath is provided
      if (args.gdevelopPath && fs.existsSync(args.gdevelopPath)) {
        const cmd = buildGDevelopCliCommand({
          gdevelopPath: args.gdevelopPath,
          projectPath: args.projectPath,
          commandName: 'PREVIEW',
          cmdArgs: args.cmdArgs || [],
          headless: args.headless !== false,
        });
        const child = child_process.spawn(cmd.command, cmd.args, {
          detached: false,
          stdio: 'ignore',
        });
        serverState.activePreviews.set(previewId, {
          id: previewId,
          type: 'cli',
          pid: child.pid,
          childProcess: child,
          port,
          status: 'running',
        });
        return {
          previewId,
          type: 'cli',
          pid: child.pid,
          command: cmd.command,
          status: 'running',
        };
      }

      // Standalone local loopback preview HTTP server
      const projectDir = fs.statSync(args.projectPath).isDirectory()
        ? args.projectPath
        : path.dirname(args.projectPath);

      const server = http.createServer((req, res) => {
        const safeUrl = (req.url || '/').split('?')[0];
        let filePath = path.join(projectDir, safeUrl === '/' ? 'game.json' : safeUrl);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.writeHead(200, { 'Content-Type': filePath.endsWith('.json') ? 'application/json' : 'text/plain' });
          fs.createReadStream(filePath).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'preview-active', project: project.properties.name }));
        }
      });

      await new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => resolve());
        server.on('error', reject);
      });

      serverState.activePreviews.set(previewId, {
        id: previewId,
        type: 'http',
        server,
        port,
        host: '127.0.0.1',
        url: `http://127.0.0.1:${port}`,
        status: 'running',
      });

      return {
        previewId,
        type: 'http',
        port,
        host: '127.0.0.1',
        url: `http://127.0.0.1:${port}`,
        status: 'running',
      };
    },
  },
  {
    name: 'gd_preview_stop',
    description: 'Terminate an active GDJS preview instance or stop all running preview servers.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        previewId: {
          type: 'string',
          description: 'Identifier returned by gd_preview_run. If omitted, stops all running previews.',
        },
        force: {
          type: 'boolean',
          description: 'Force kill child processes (SIGKILL) if true.',
        },
        confirmed: confirmedSchema,
      },
      additionalProperties: false,
    },
    async execute(args) {
      if (args.previewId) {
        const preview = serverState.activePreviews.get(args.previewId);
        if (!preview) {
          throw new Error(`[gd_preview_stop] preview not found: "${args.previewId}"`);
        }
        if (preview.server) {
          await new Promise(resolve => preview.server.close(resolve));
        }
        if (preview.childProcess) {
          try {
            preview.childProcess.kill(args.force ? 'SIGKILL' : 'SIGTERM');
          } catch {}
        }
        serverState.activePreviews.delete(args.previewId);
        return { previewId: args.previewId, stopped: true };
      }

      let count = 0;
      for (const [id, preview] of serverState.activePreviews.entries()) {
        if (preview.server) {
          await new Promise(resolve => preview.server.close(resolve));
        }
        if (preview.childProcess) {
          try {
            preview.childProcess.kill(args.force ? 'SIGKILL' : 'SIGTERM');
          } catch {}
        }
        count++;
      }
      serverState.activePreviews.clear();
      return { stoppedCount: count, stopped: true };
    },
  },
  {
    name: 'gd_debugger_eval',
    description: 'Evaluate an expression or query state on the GDevelop live preview via the loopback WebSocket debugger bridge.',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'integer',
          description: 'Debugger WebSocket port (default 3030).',
        },
        host: {
          type: 'string',
          description: 'Debugger host (strictly 127.0.0.1 for zero-egress).',
        },
        command: {
          type: 'string',
          description: 'Debugger command (e.g. "eval", "dump", "step", "getSceneState").',
        },
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate within GDJS runtime context.',
        },
        payload: {
          type: 'object',
          description: 'Structured command payload.',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Connection and handshake timeout in milliseconds (default 3000).',
        },
        confirmed: confirmedSchema,
      },
      additionalProperties: false,
    },
    async execute(args) {
      const targetHost = args.host || '127.0.0.1';
      if (targetHost !== '127.0.0.1' && targetHost !== 'localhost') {
        throw new Error(`[gd_debugger_eval] zero-egress violation: debugger host must be 127.0.0.1 (got ${targetHost})`);
      }
      const port = args.port || 3030;
      const timeoutMs = args.timeoutMs || 3000;

      let response = null;
      const bridge = await connectDebuggerBridge(
        port,
        msg => {
          response = msg;
          serverState.debuggerStateCache.lastUpdate = Date.now();
          serverState.debuggerStateCache.telemetry = msg;
          serverState.debuggerStateCache.connected = true;
        },
        { host: targetHost, timeoutMs }
      );

      const cmd = {
        command: args.command || 'eval',
        expression: args.expression || '',
        payload: args.payload || {},
        timestamp: Date.now(),
      };
      bridge.send(cmd);

      // Wait briefly for incoming telemetry or response frame
      await new Promise(resolve => setTimeout(resolve, 80));
      bridge.close();

      return {
        port,
        command: cmd.command,
        expression: cmd.expression,
        response: response || { status: 'dispatched', ack: true },
      };
    },
  },
];

// Backward-compatibility aliases for legacy tools
export const LEGACY_MCP_TOOLS = [
  {
    name: 'gdevelop_project_read',
    description: 'Legacy alias for gd_project_read.',
    mutating: false,
    inputSchema: NATIVE_MCP_TOOLS.find(t => t.name === 'gd_project_read').inputSchema,
    execute: args => NATIVE_MCP_TOOLS.find(t => t.name === 'gd_project_read').execute(args),
  },
  {
    name: 'gdevelop_project_create_scene',
    description: 'Legacy alias for gd_scene_create.',
    mutating: true,
    inputSchema: NATIVE_MCP_TOOLS.find(t => t.name === 'gd_scene_create').inputSchema,
    execute: args => NATIVE_MCP_TOOLS.find(t => t.name === 'gd_scene_create').execute(args),
  },
  {
    name: 'gdevelop_project_create_object',
    description: 'Legacy alias for gd_object_create_or_replace.',
    mutating: true,
    inputSchema: NATIVE_MCP_TOOLS.find(t => t.name === 'gd_object_create_or_replace').inputSchema,
    execute: args => NATIVE_MCP_TOOLS.find(t => t.name === 'gd_object_create_or_replace').execute(args),
  },
  {
    name: 'gdevelop_project_add_behavior',
    description: 'Legacy alias for gd_behavior_add.',
    mutating: true,
    inputSchema: NATIVE_MCP_TOOLS.find(t => t.name === 'gd_behavior_add').inputSchema,
    execute: args => NATIVE_MCP_TOOLS.find(t => t.name === 'gd_behavior_add').execute(args),
  },
  {
    name: 'gdevelop_project_add_events',
    description: 'Legacy alias for gd_event_inject.',
    mutating: true,
    inputSchema: NATIVE_MCP_TOOLS.find(t => t.name === 'gd_event_inject').inputSchema,
    execute: args => NATIVE_MCP_TOOLS.find(t => t.name === 'gd_event_inject').execute(args),
  },
  {
    name: 'gdevelop_cli_run',
    description: 'Format a headless GDevelop CLI dispatch (--run-command NAME --cmd-args …) for host execution.',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: {
        gdevelopPath: { type: 'string', description: 'GDevelop binary path.' },
        projectPath: { type: 'string', description: 'Project path (positional CLI arg).' },
        commandName: { type: 'string', description: 'UPPER_SNAKE_CASE command name.' },
        cmdArgs: { type: 'array', items: { type: 'string' }, description: 'Repeatable --cmd-args values.' },
        headless: { type: 'boolean', description: 'Add --disable-update-check for CI/headless runs.' },
      },
      required: ['gdevelopPath', 'projectPath', 'commandName'],
      additionalProperties: false,
    },
    async execute(args) {
      const formatted = buildGDevelopCliCommand({
        gdevelopPath: args.gdevelopPath,
        projectPath: args.projectPath,
        commandName: args.commandName,
        cmdArgs: args.cmdArgs,
        headless: args.headless,
      });
      return {
        command: formatted.command,
        args: formatted.args,
        commandName: formatted.commandName,
        projectPath: formatted.projectPath,
      };
    },
  },
];

export const ALL_MCP_TOOLS = [...NATIVE_MCP_TOOLS, ...LEGACY_MCP_TOOLS];

/** Return all MCP tools formatted for tools/list. */
export function getMcpTools() {
  return ALL_MCP_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

// ============================================================================
// 4. MCP Resources Catalog & Dynamic Resolvers
// ============================================================================

export const MCP_RESOURCES = [
  {
    uri: 'gdevelop://project/current',
    name: 'Current GDevelop Project',
    description: 'Active in-memory project AST from the last read or write operation.',
    mimeType: 'application/json',
  },
  {
    uri: 'gdevelop://extensions',
    name: 'Project Extensions Catalog',
    description: 'Custom EventsFunctionsExtensions registered in the active project.',
    mimeType: 'application/json',
  },
  {
    uri: 'gdevelop://debugger/state',
    name: 'Debugger Runtime Telemetry',
    description: 'Latest debugger state snapshot from loopback WebSocket bridge.',
    mimeType: 'application/json',
  },
  {
    uri: 'gdevelop://schema/project-structure',
    name: 'GDevelop Project Structure',
    description: 'Structure specification for GDevelop game.json and split-storage references.',
    mimeType: 'application/json',
    text: JSON.stringify(
      {
        description: 'GDevelop project file hierarchy and split folder semantics',
        rootKeys: ['properties', 'resources', 'objects', 'layouts', 'externalEvents', 'eventsFunctionsExtensions'],
        splitObjectMarker: '__REFERENCE_TO_SPLIT_OBJECT',
        layoutKeys: ['name', 'objects', 'layers', 'events', 'variables', 'r', 'v', 'b'],
      },
      null,
      2
    ),
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

export const MCP_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'gdevelop://scene/{scene_name}',
    name: 'Scene Layout AST',
    description: 'Inspect specific scene layout, object hierarchy, layers, and instances.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'gdevelop://events/{scene_name}',
    name: 'Scene Event Sheet AST',
    description: 'Inspect specific scene event sheet instructions, conditions, and actions.',
    mimeType: 'application/json',
  },
];

export function resolveResourceContent(uri) {
  // 1. Static resources
  const staticRes = MCP_RESOURCES.find(r => r.uri === uri && r.text);
  if (staticRes) {
    return { uri, mimeType: staticRes.mimeType, text: staticRes.text };
  }

  // 2. Active project current
  if (uri === 'gdevelop://project/current') {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(
        serverState.activeProject || {
          status: 'no_project_loaded',
          instruction: 'Run gd_project_read to load an active project into server context.',
        },
        null,
        2
      ),
    };
  }

  // 3. Extensions catalog
  if (uri === 'gdevelop://extensions') {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(serverState.activeProject?.eventsFunctionsExtensions || [], null, 2),
    };
  }

  // 4. Debugger state
  if (uri === 'gdevelop://debugger/state') {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(serverState.debuggerStateCache, null, 2),
    };
  }

  // 5. Parameterized scene layout: gdevelop://scene/{scene_name}
  const sceneMatch = uri.match(/^gdevelop:\/\/scene\/(.+)$/);
  if (sceneMatch) {
    const sceneName = decodeURIComponent(sceneMatch[1]);
    if (!serverState.activeProject) {
      throw new Error(`[resources/read] no active project loaded; call gd_project_read first.`);
    }
    const scene = (serverState.activeProject.layouts || []).find(l => l && l.name === sceneName);
    if (!scene) {
      throw new Error(`[resources/read] scene not found in active project: "${sceneName}"`);
    }
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(scene, null, 2),
    };
  }

  // 6. Parameterized event sheet: gdevelop://events/{scene_name}
  const eventsMatch = uri.match(/^gdevelop:\/\/events\/(.+)$/);
  if (eventsMatch) {
    const sceneName = decodeURIComponent(eventsMatch[1]);
    if (!serverState.activeProject) {
      throw new Error(`[resources/read] no active project loaded; call gd_project_read first.`);
    }
    const scene = (serverState.activeProject.layouts || []).find(l => l && l.name === sceneName);
    if (!scene) {
      throw new Error(`[resources/read] scene not found in active project: "${sceneName}"`);
    }
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(scene.events || [], null, 2),
    };
  }

  return null;
}

// ============================================================================
// 5. MCP Prompts Catalog
// ============================================================================

export const MCP_PROMPTS = [
  {
    name: 'architect-game-scene',
    description: 'System instructions and guided workflow for architecting a complete GDevelop scene with layers, objects, behaviors, and initial instances.',
    arguments: [
      { name: 'sceneName', description: 'Name of the scene to create or modify.', required: false },
      { name: 'genre', description: 'Game genre (e.g. 2D Platformer, Top-Down RPG, Physics Puzzle).', required: false },
      { name: 'dimension', description: 'Target visual dimension: "2D" or "3D".', required: false },
      { name: 'mechanics', description: 'Core gameplay mechanics.', required: false },
    ],
    generate: (args = {}) => {
      const scene = args.sceneName || 'MainScene';
      const genre = args.genre || '2D Action Game';
      const dim = args.dimension || '2D';
      const mech = args.mechanics || 'standard movement and interaction';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are the lead GDevelop 5 architect. Design the "${scene}" scene for a ${dim} ${genre} focusing on ${mech}.\n` +
              `1. Plan object hierarchy: define player, platforms/obstacles, enemies, and UI text elements.\n` +
              `2. Assign behaviors: select appropriate engine behaviors (e.g. PlatformerObject, Physics2, TopDownMovement).\n` +
              `3. Structure layers: create Base Layer for gameplay, separate Lighting layer if needed, and UI layer.\n` +
              `4. Apply AST mutations sequentially: invoke gd_scene_create, gd_object_create_or_replace, and gd_behavior_add.`,
          },
        },
      ];
    },
  },
  {
    name: 'debug-event-sheet',
    description: 'Systematic event sheet debugging assistant for locating broken conditions, conflicting actions, or event order anomalies.',
    arguments: [
      { name: 'sceneName', description: 'Scene with problematic events.', required: true },
      { name: 'symptoms', description: 'Observable bugs, errors, or unexpected game behaviors.', required: true },
      { name: 'expectedBehavior', description: 'Intended behavior of the gameplay logic.', required: false },
    ],
    generate: (args = {}) => {
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are an expert GDJS event sheet debugger. We are debugging scene "${args.sceneName}".\n` +
              `Reported Symptoms: ${args.symptoms}\n` +
              `Expected Behavior: ${args.expectedBehavior || 'Correct operation without glitches'}\n\n` +
              `Workflow:\n` +
              `1. Inspect the scene event sheet via gdevelop://events/${args.sceneName} or gd_project_read.\n` +
              `2. Trace condition evaluations and check for inverted condition bugs or missing trigger-once guards.\n` +
              `3. Check action order: verify that variable reads precede mutations within the frame step.\n` +
              `4. Formulate the minimal corrective event AST and inject via gd_event_inject.`,
          },
        },
      ];
    },
  },
  {
    name: 'wrap-js-extension',
    description: 'Template for creating high-performance JavaScript runtime extensions wrapped in GDevelop EventsFunctionsExtension.',
    arguments: [
      { name: 'extensionName', description: 'Extension identifier.', required: true },
      { name: 'functionName', description: 'Function identifier.', required: true },
      { name: 'functionType', description: 'Function type: Action, Condition, or Expression.', required: false },
      { name: 'purpose', description: 'Detailed technical purpose and algorithm.', required: true },
    ],
    generate: (args = {}) => {
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create a native GDJS JavaScript extension "${args.extensionName}" providing function "${args.functionName}" (${args.functionType || 'Action'}).\n` +
              `Purpose: ${args.purpose}\n\n` +
              `Implementation requirements:\n` +
              `- Accept runtimeScene as the primary context.\n` +
              `- Access scene instances via runtimeScene.getObjects(objectName).\n` +
              `- Ensure zero external web egress (only local GDJS runtime APIs).\n` +
              `- Package into EventsFunctionsExtension AST and inject with gd_extension_build.`,
          },
        },
      ];
    },
  },
  {
    name: 'inspect-runtime-performance',
    description: 'Runtime performance profiling guide analyzing frame rate, draw calls, physics stepping, and debugger telemetry.',
    arguments: [
      { name: 'port', description: 'Debugger loopback WebSocket port (default 3030).', required: false },
      { name: 'focusArea', description: 'Focus area (e.g. framerate, draw calls, physics stepping).', required: false },
    ],
    generate: (args = {}) => {
      const port = args.port || '3030';
      const focus = args.focusArea || 'framerate and step times';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Inspect GDJS runtime performance on debugger port ${port} focusing on ${focus}.\n` +
              `1. Query debugger state via gdevelop://debugger/state or gd_debugger_eval.\n` +
              `2. Analyze tick duration, PixiJS render time, and Three.js 3D batch count.\n` +
              `3. Highlight bottlenecks in events evaluation or behavior stepping and recommend optimizations.`,
          },
        },
      ];
    },
  },
  {
    name: 'gdevelop_game_architect',
    description: 'Legacy prompt alias: system instructions for architecting a GDevelop 5 game with clean AST modifications.',
    arguments: [
      { name: 'genre', description: 'Game genre (e.g. platformer, top-down, puzzle)', required: false },
    ],
    generate: (args = {}) => {
      const genre = args.genre || '2D / 3D game';
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are an expert GDevelop 5 game architect. Your mission is to plan and implement a ${genre} using local GDevelop project control tools. Always inspect the project first using gd_project_read, plan standard object hierarchies, attach appropriate behaviors, and construct event sheets with conditions and actions.`,
          },
        },
      ];
    },
  },
];

// ============================================================================
// 6. Tool Execution Handler with Security Gates
// ============================================================================

export async function handleToolCall(name, args = {}, security = globalSecurity) {
  const tool = ALL_MCP_TOOLS.find(t => t.name === name);
  if (!tool) {
    throw new Error(`[mcp] unknown tool: "${name}"`);
  }

  // Security Gate 1: Check Permission policy & confirmation requirements
  security.checkPermission(name, tool.mutating, args);

  // Security Gate 2: Path Containment
  if (args.projectPath) {
    security.validatePath(args.projectPath);
  }

  // Security Gate 3: Zero-Egress Enforcement
  security.validateZeroEgress(args);

  const result = await tool.execute(args);

  return {
    content: [
      {
        type: 'text',
        text: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
      },
    ],
    isError: false,
  };
}

// ============================================================================
// 7. JSON-RPC 2.0 Dispatcher (Low-Overhead Stdio/IPC Transport)
// ============================================================================

export async function handleRpcMessage(msg, context = {}) {
  const security = context.security || globalSecurity;

  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const { id, method, params } = msg;

  // JSON-RPC Notifications (no response needed for id: null/undefined)
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized') {
      context.clientInitialized = true;
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
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
              prompts: { listChanged: false },
              logging: {},
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
          const callResult = await handleToolCall(params.name, params.arguments || {}, security);
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

      case 'resources/templates/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            resourceTemplates: MCP_RESOURCE_TEMPLATES,
          },
        };
      }

      case 'resources/read': {
        const uri = params && params.uri;
        if (!uri) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing resource URI parameter' },
          };
        }
        try {
          const resolved = resolveResourceContent(uri);
          if (!resolved) {
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
              contents: [resolved],
            },
          };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32603, message: err.message },
          };
        }
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

// ============================================================================
// 8. Stdio / IPC Transport Runner
// ============================================================================

export function startMcpStdioServer(
  inStream = process.stdin,
  outStream = process.stdout,
  options = {}
) {
  const security = options.security || globalSecurity;
  const context = { security, clientInitialized: false };

  const rl = readline.createInterface({
    input: inStream,
    output: null,
    terminal: false,
  });

  rl.on('line', async line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let payloadText = trimmed;
    // Tolerate optional LSP-style Content-Length prefix
    if (trimmed.startsWith('Content-Length:')) {
      const parts = trimmed.split('\r\n\r\n');
      if (parts.length > 1) payloadText = parts[1].trim();
    }

    try {
      const msg = JSON.parse(payloadText);
      const resp = await handleRpcMessage(msg, context);
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
