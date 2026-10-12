// Control shim (T07, issue #16): pure zero-dependency ESM helpers for
// programmatic GDevelop project control.
//
// Reads/writes stock `game.json` project files (single-file or split-folder
// layouts with `__REFERENCE_TO_SPLIT_OBJECT` entries, mirroring
// `LocalProjectWriter.js`), mutates the plain project JSON (scenes, objects,
// behaviors, standard events), formats headless CLI invocations for
// `electron-app/app/main.js` + `LocalCliCommandRunner.js`
// (`--run-command NAME --cmd-args ARGS`), and speaks to the preview
// `DebuggerServer` (a `ws`-based WebSocket server on ports 3030-4000) with a
// minimal RFC6455 client built on `node:net` only.
//
// Zero-dependency: only `node:` builtins. No hosted calls anywhere — this
// module never touches the hosted generation API (see the zero-egress unit test).

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

const REFERENCE_KEY = '__REFERENCE_TO_SPLIT_OBJECT';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Load one JSON file, throwing a fail-closed error naming the path. */
function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `[control-shim] project file not found: ${filePath} (${err.message})`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[control-shim] malformed game.json at ${filePath}: ${err.message}`
    );
  }
}

/**
 * Recursively resolve `{__REFERENCE_TO_SPLIT_OBJECT: 'layouts/x'}` entries
 * against `baseDir` (the split-folder layout `LocalProjectWriter` emits:
 * `<reference>.json` next to `game.json`).
 */
function resolveSplitReferences(node, baseDir) {
  if (Array.isArray(node)) return node.map(item => resolveSplitReferences(item, baseDir));
  if (node && typeof node === 'object') {
    if (
      typeof node[REFERENCE_KEY] === 'string' &&
      Object.keys(node).length === 1
    ) {
      return resolveSplitReferences(
        readJsonFile(path.join(baseDir, `${node[REFERENCE_KEY]}.json`)),
        baseDir
      );
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = resolveSplitReferences(value, baseDir);
    }
    return out;
  }
  return node;
}

function assertProjectShape(projectData, where) {
  if (!projectData || typeof projectData !== 'object' || Array.isArray(projectData)) {
    throw new Error(
      `[control-shim] ${where}: project data must be a JSON object`
    );
  }
  if (
    !projectData.properties ||
    typeof projectData.properties !== 'object' ||
    Array.isArray(projectData.properties)
  ) {
    throw new Error(
      `[control-shim] ${where}: project data is missing the "properties" object (not a GDevelop project)`
    );
  }
  return projectData;
}

/**
 * Load and validate a GDevelop project. `projectPath` is either a single-file
 * `game.json` or a split-folder project directory containing `game.json`.
 */
export function readGDevelopProject(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error('[control-shim] readGDevelopProject: projectPath is required');
  }
  let stat;
  try {
    stat = fs.statSync(projectPath);
  } catch (err) {
    throw new Error(
      `[control-shim] project path not found: ${projectPath} (${err.message})`
    );
  }
  if (stat.isDirectory()) {
    const mainFile = path.join(projectPath, 'game.json');
    const parsed = readJsonFile(mainFile);
    return assertProjectShape(
      resolveSplitReferences(parsed, projectPath),
      `readGDevelopProject(${projectPath})`
    );
  }
  return assertProjectShape(readJsonFile(projectPath), `readGDevelopProject(${projectPath})`);
}

/** Canonical serialization: 2-space JSON plus a final newline. */
export function serializeGDevelopProject(projectData) {
  assertProjectShape(projectData, 'serializeGDevelopProject');
  return JSON.stringify(projectData, null, 2) + '\n';
}

/**
 * Persist `projectData` deterministically. A directory path writes its
 * `game.json`; a file path writes the file directly (parent dirs created).
 */
export function writeGDevelopProject(projectPath, projectData) {
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error('[control-shim] writeGDevelopProject: projectPath is required');
  }
  const content = serializeGDevelopProject(projectData);
  let target = projectPath;
  try {
    if (fs.statSync(projectPath).isDirectory()) {
      target = path.join(projectPath, 'game.json');
    }
  } catch {
    // Path does not exist yet: treat as a file path.
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function requireScene(projectData, sceneName, where) {
  assertProjectShape(projectData, where);
  if (typeof sceneName !== 'string' || sceneName.trim().length === 0) {
    throw new Error(`[control-shim] ${where}: sceneName must be a non-empty string`);
  }
  if (!Array.isArray(projectData.layouts)) projectData.layouts = [];
  const scene = projectData.layouts.find(layout => layout && layout.name === sceneName);
  if (!scene) {
    throw new Error(`[control-shim] ${where}: scene not found: "${sceneName}"`);
  }
  return scene;
}

/**
 * Inject a new scene (layout) into `projectData.layouts`. Mutates in place
 * and returns the created layout. Throws on duplicate or blank names.
 */
export function createScene(projectData, sceneName) {
  assertProjectShape(projectData, 'createScene');
  if (typeof sceneName !== 'string' || sceneName.trim().length === 0) {
    throw new Error('[control-shim] createScene: sceneName must be a non-empty string');
  }
  if (!Array.isArray(projectData.layouts)) projectData.layouts = [];
  if (projectData.layouts.some(layout => layout && layout.name === sceneName)) {
    throw new Error(`[control-shim] createScene: scene already exists: "${sceneName}"`);
  }
  const scene = {
    associatedEditorLayouts: [],
    events: [],
    instances: [],
    layers: [{ name: 'Base layer', visibility: true, effects: [], cameras: [] }],
    name: sceneName,
    objects: [],
    title: sceneName,
    variables: [],
  };
  projectData.layouts.push(scene);
  return scene;
}

/**
 * Add a new object to a scene (or to the global `projectData.objects` when
 * `sceneName` is omitted), or replace the same-named object in place.
 * Returns `{ object, created }`.
 */
export function createOrReplaceObject(
  projectData,
  { sceneName, objectName, objectType, description } = {}
) {
  const where = 'createOrReplaceObject';
  assertProjectShape(projectData, where);
  if (typeof objectName !== 'string' || objectName.trim().length === 0) {
    throw new Error(`[control-shim] ${where}: objectName must be a non-empty string`);
  }
  if (typeof objectType !== 'string' || objectType.trim().length === 0) {
    throw new Error(`[control-shim] ${where}: objectType must be a non-empty string`);
  }
  let container;
  if (sceneName !== undefined && sceneName !== null && String(sceneName).length > 0) {
    const scene = requireScene(projectData, sceneName, where);
    if (!Array.isArray(scene.objects)) scene.objects = [];
    container = scene.objects;
  } else {
    if (!Array.isArray(projectData.objects)) projectData.objects = [];
    container = projectData.objects;
  }
  const object = {
    name: objectName,
    type: objectType,
    variables: [],
    effects: [],
    behaviors: [],
  };
  if (description !== undefined) object.description = description;
  const index = container.findIndex(entry => entry && entry.name === objectName);
  if (index === -1) {
    container.push(object);
    return { object, created: true };
  }
  // Replace: keep array position stable, preserve existing behaviors unless
  // the caller re-adds them via addBehavior.
  const previous = container[index];
  if (Array.isArray(previous.behaviors)) object.behaviors = previous.behaviors;
  if (Array.isArray(previous.variables)) object.variables = previous.variables;
  if (Array.isArray(previous.effects)) object.effects = previous.effects;
  container[index] = object;
  return { object, created: false };
}

/** Default behavior-instance content per family (keyed by type fragment). */
const BEHAVIOR_FAMILY_DEFAULTS = [
  {
    match: 'PlatformerObjectBehavior',
    content: {
      canGrabPlatforms: true,
      canGrabLadders: false,
      maxSpeed: 250,
      acceleration: 1500,
      deceleration: 1500,
      maxFallingSpeed: 700,
      jumpSpeed: 600,
      jumpSustainTime: 0.15,
      gravity: 1500,
      useDefaultControls: true,
    },
  },
  {
    match: 'Physics2Behavior',
    content: {
      bodyType: 'Dynamic',
      bullet: false,
      fixedRotation: false,
      shape: 'Box',
      density: 1,
      friction: 0.3,
      restitution: 0,
      layers: 1,
      masks: 1,
      linearDamping: 0.1,
      angularDamping: 0.1,
      gravityScale: 1,
    },
  },
  {
    match: 'TopDownMovementBehavior',
    content: {
      allowDiagonals: true,
      maxSpeed: 200,
      acceleration: 800,
      deceleration: 800,
      rotateObject: false,
      useDefaultControls: true,
      angularMaxSpeed: 180,
    },
  },
];

function defaultBehaviorContent(behaviorType) {
  for (const family of BEHAVIOR_FAMILY_DEFAULTS) {
    if (behaviorType.includes(family.match)) return { ...family.content };
  }
  return {};
}

/**
 * Inject (or replace) a behavior block on an object. `behaviorType` is the
 * fully qualified type (e.g. `PlatformBehavior::PlatformerObjectBehavior`);
 * Platformer/Physics2/TopDown families get sane default content, unknown
 * families get a bare block. Returns the behavior object.
 */
export function addBehavior(
  projectData,
  { sceneName, objectName, behaviorName, behaviorType } = {}
) {
  const where = 'addBehavior';
  assertProjectShape(projectData, where);
  if (typeof behaviorName !== 'string' || behaviorName.trim().length === 0) {
    throw new Error(`[control-shim] ${where}: behaviorName must be a non-empty string`);
  }
  if (typeof behaviorType !== 'string' || behaviorType.trim().length === 0) {
    throw new Error(`[control-shim] ${where}: behaviorType must be a non-empty string`);
  }
  let container;
  if (sceneName !== undefined && sceneName !== null && String(sceneName).length > 0) {
    const scene = requireScene(projectData, sceneName, where);
    container = scene.objects || [];
  } else {
    container = projectData.objects || [];
  }
  const object = container.find(entry => entry && entry.name === objectName);
  if (!object) {
    throw new Error(`[control-shim] ${where}: object not found: "${objectName}"`);
  }
  if (!Array.isArray(object.behaviors)) object.behaviors = [];
  const behavior = {
    name: behaviorName,
    type: behaviorType,
    ...defaultBehaviorContent(behaviorType),
  };
  const index = object.behaviors.findIndex(entry => entry && entry.name === behaviorName);
  if (index === -1) object.behaviors.push(behavior);
  else object.behaviors[index] = behavior;
  return behavior;
}

/**
 * Append a `BuiltinCommonInstructions::Standard` event to a scene's event
 * sheet. `conditions`/`actions` default to `[]`. Returns the event object.
 */
export function addStandardEvent(projectData, { sceneName, conditions, actions } = {}) {
  const where = 'addStandardEvent';
  const scene = requireScene(projectData, sceneName, where);
  const resolvedConditions = conditions === undefined ? [] : conditions;
  const resolvedActions = actions === undefined ? [] : actions;
  if (!Array.isArray(resolvedConditions)) {
    throw new Error(`[control-shim] ${where}: conditions must be an array`);
  }
  if (!Array.isArray(resolvedActions)) {
    throw new Error(`[control-shim] ${where}: actions must be an array`);
  }
  if (!Array.isArray(scene.events)) scene.events = [];
  const event = {
    disabled: false,
    folded: false,
    type: 'BuiltinCommonInstructions::Standard',
    conditions: resolvedConditions,
    actions: resolvedActions,
  };
  scene.events.push(event);
  return event;
}

const CLI_COMMAND_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Format a headless CLI invocation for `electron-app/app/main.js`
 * (`parseGDevelopArgs`: positional project path, `--run-command NAME`,
 * repeatable `--cmd-args` values consumed by `LocalCliCommandRunner`'s
 * `normalizeCommandArgs`). `headless: true` adds `--disable-update-check`
 * (the README's CI usage). Returns `{ command, args }` for `spawn`.
 */
export function buildGDevelopCliCommand({
  gdevelopPath,
  projectPath,
  commandName,
  cmdArgs,
  headless,
} = {}) {
  const where = 'buildGDevelopCliCommand';
  if (typeof gdevelopPath !== 'string' || gdevelopPath.length === 0) {
    throw new Error(`[control-shim] ${where}: gdevelopPath is required`);
  }
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    throw new Error(`[control-shim] ${where}: projectPath is required`);
  }
  if (typeof commandName !== 'string' || !CLI_COMMAND_RE.test(commandName)) {
    throw new Error(
      `[control-shim] ${where}: commandName must be UPPER_SNAKE_CASE (got ${JSON.stringify(commandName)})`
    );
  }
  const args = [];
  if (headless) args.push('--disable-update-check');
  args.push('--run-command', commandName);
  for (const value of cmdArgs === undefined ? [] : [].concat(cmdArgs)) {
    args.push('--cmd-args', String(value));
  }
  args.push(projectPath);
  return { command: gdevelopPath, args, commandName, projectPath };
}

function assertBridgePort(port) {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`[control-shim] connectDebuggerBridge: invalid port (${String(port)})`);
  }
}

function computeAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(text) {
  const payload = Buffer.from(String(text), 'utf8');
  const header = [0x81];
  if (payload.length < 126) {
    header.push(payload.length | 0x80);
  } else if (payload.length < 65536) {
    header.push(126 | 0x80);
    header.push((payload.length >>> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(127 | 0x80);
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(payload.length));
    return Buffer.concat([Buffer.from(header), len, maskPayload(payload)]);
  }
  return Buffer.concat([Buffer.from(header), maskPayload(payload)]);
}

function maskPayload(payload) {
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([mask, masked]);
}

/**
 * Minimal RFC6455 WebSocket client for the preview `DebuggerServer`
 * (hot-reload inspection). Built on `node:net` only — no `ws` dependency.
 *
 * Resolves to `{ send, close }`; rejects fail-closed on handshake mismatch,
 * connection refusal, or timeout. Incoming text messages are delivered to
 * `onMessage` (parsed as JSON when possible, raw string otherwise).
 */
export function connectDebuggerBridge(port, onMessage, { host, timeoutMs } = {}) {
  const targetHost = host || '127.0.0.1';
  const timeout = timeoutMs === undefined ? 5000 : timeoutMs;
  return new Promise((resolve, reject) => {
    // Fail-closed inside the executor so invalid input rejects the returned
    // promise instead of throwing synchronously past the caller.
    try {
      assertBridgePort(port);
      if (typeof onMessage !== 'function') {
        throw new TypeError('[control-shim] connectDebuggerBridge: onMessage must be a function');
      }
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {}
      reject(err);
    };

    const socket = net.createConnection({ host: targetHost, port });
    const timer = setTimeout(() => {
      fail(new Error(`[control-shim] debugger bridge to ${targetHost}:${port} timed out after ${timeout}ms`));
    }, timeout);
    // A refused connection must reject, never hang past the timer.
    if (typeof timer.unref === 'function') timer.unref();

    socket.once('error', err => {
      fail(new Error(`[control-shim] debugger bridge to ${targetHost}:${port} failed: ${err.message}`));
    });

    const key = crypto.randomBytes(16).toString('base64');
    let handshake = Buffer.alloc(0);
    let handshook = false;
    let frameBuffer = Buffer.alloc(0);
    let fragments = [];

    const deliver = message => {
      try {
        onMessage(JSON.parse(message));
      } catch {
        onMessage(message);
      }
    };

    const pumpFrames = () => {
      for (;;) {
        if (frameBuffer.length < 2) return;
        const fin = (frameBuffer[0] & 0x80) !== 0;
        const opcode = frameBuffer[0] & 0x0f;
        const masked = (frameBuffer[1] & 0x80) !== 0;
        let length = frameBuffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (frameBuffer.length < 4) return;
          length = frameBuffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (frameBuffer.length < 10) return;
          const high = frameBuffer.readUInt32BE(2);
          const low = frameBuffer.readUInt32BE(6);
          if (high !== 0 || low > 0x7fffffff) {
            fail(new Error('[control-shim] debugger bridge: oversized frame'));
            return;
          }
          length = low;
          offset = 10;
        }
        if (masked) offset += 4;
        if (frameBuffer.length < offset + length) return;
        let payload = frameBuffer.slice(offset, offset + length);
        if (masked) {
          const mask = frameBuffer.slice(offset - 4, offset);
          const unmasked = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ mask[i % 4];
          payload = unmasked;
        }
        frameBuffer = frameBuffer.slice(offset + length);
        if (opcode === 0x0) {
          fragments.push(payload);
        } else if (opcode === 0x1) {
          fragments = [payload];
        } else if (opcode === 0x2) {
          fragments = [payload];
        } else if (opcode === 0x8) {
          fail(new Error('[control-shim] debugger bridge: server closed the connection'));
          return;
        } else if (opcode === 0x9) {
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        } else if (opcode === 0xa) {
          continue;
        } else {
          continue;
        }
        if (!fin) continue;
        deliver(Buffer.concat(fragments).toString('utf8'));
        fragments = [];
      }
    };

    socket.on('data', chunk => {
      if (!handshook) {
        handshake = Buffer.concat([handshake, chunk]);
        const end = handshake.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = handshake.slice(0, end).toString('latin1');
        frameBuffer = handshake.slice(end + 4);
        handshake = Buffer.alloc(0);
        const status = head.split('\r\n')[0] || '';
        const accept = /Sec-WebSocket-Accept:\s*(.*)/i.exec(head)?.[1].trim();
        if (!/^HTTP\/1\.1 101/i.test(status) || accept !== computeAccept(key)) {
          fail(
            new Error(
              `[control-shim] debugger bridge: WebSocket handshake rejected (${status.trim() || 'no status'})`
            )
          );
          return;
        }
        handshook = true;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          send(message) {
            const text = typeof message === 'string' ? message : JSON.stringify(message);
            socket.write(encodeFrame(text));
          },
          close() {
            try {
              socket.write(Buffer.from([0x88, 0x00]));
            } catch {}
            socket.end();
          },
        });
        if (frameBuffer.length > 0) pumpFrames();
        return;
      }
      frameBuffer = Buffer.concat([frameBuffer, chunk]);
      pumpFrames();
    });

    socket.on('connect', () => {
      socket.write(
        'GET / HTTP/1.1\r\n' +
          `Host: ${targetHost}:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
  });
}
