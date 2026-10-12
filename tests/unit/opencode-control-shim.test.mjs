// Unit tests: packages/unlock-shim/control-shim.mjs (T07, issue #16).
//
// Pure zero-dependency ESM control shim: project read/write, AST scene /
// object / behavior / event mutation, CLI command formatting, and a minimal
// RFC6455 debugger-bridge client. All I/O is real (TMPDIR scratch project
// trees, live 127.0.0.1 loopback servers); no mocks of the code under test,
// no network beyond loopback, bare node:test + builtins only.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  readGDevelopProject,
  writeGDevelopProject,
  createScene,
  createOrReplaceObject,
  addBehavior,
  addStandardEvent,
  buildGDevelopCliCommand,
  connectDebuggerBridge,
} from '../../packages/unlock-shim/control-shim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolve the repo root from this file's location so the suite passes both
// in-tree (tests/unit/) and from the ticket worktree checkout.
const CONTROL_SHIM_SRC = (() => {
  const candidates = [
    path.resolve(here, '../../packages/unlock-shim/control-shim.mjs'),
    path.resolve(
      here,
      '../../.worktrees/ticket-T07/packages/unlock-shim/control-shim.mjs'
    ),
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c);
      return c;
    } catch {}
  }
  return candidates[0];
})();

const minimalProject = (name = 'ScratchGame') => ({
  properties: { name, version: '1.0.0' },
  layouts: [],
  objects: [],
});

let scratchDirs = [];
const mkScratch = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'control-shim-'));
  scratchDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

describe('unit: control-shim project read/write (real I/O)', () => {
  it('round-trips a single-file game.json deterministically', () => {
    const dir = mkScratch();
    const file = path.join(dir, 'game.json');
    const project = minimalProject();
    writeGDevelopProject(file, project);
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.endsWith('\n'), 'canonical file ends with a final newline');
    assert.match(raw, /^  "properties"/m, 'canonical 2-space indent');
    const loaded = readGDevelopProject(file);
    assert.deepEqual(loaded, project);
    // Deterministic: a second write is byte-identical.
    writeGDevelopProject(file, loaded);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
  });

  it('resolves split-folder __REFERENCE_TO_SPLIT_OBJECT layout files', () => {
    const dir = mkScratch();
    const layout = { name: 'Level1', objects: [], events: [] };
    fs.mkdirSync(path.join(dir, 'layouts'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'layouts', 'level1.json'),
      JSON.stringify(layout, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(dir, 'game.json'),
      JSON.stringify({
        properties: { name: 'SplitGame' },
        layouts: [{ __REFERENCE_TO_SPLIT_OBJECT: 'layouts/level1' }],
      }) + '\n'
    );
    const loaded = readGDevelopProject(dir);
    assert.equal(loaded.properties.name, 'SplitGame');
    assert.deepEqual(loaded.layouts, [layout]);
  });

  it('fails closed on malformed game.json and missing paths', () => {
    const dir = mkScratch();
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    assert.throws(() => readGDevelopProject(bad), /game\.json|JSON|parse/i);
    assert.throws(
      () => readGDevelopProject(path.join(dir, 'nope.json')),
      /ENOENT|not found|missing/i
    );
    assert.throws(
      () => readGDevelopProject(path.join(dir, 'no-dir')),
      /ENOENT|not found|missing/i
    );
    const wrongShape = path.join(dir, 'wrong.json');
    fs.writeFileSync(wrongShape, JSON.stringify([1, 2, 3]));
    assert.throws(() => readGDevelopProject(wrongShape), /properties|project/i);
  });

  it('writeGDevelopProject rejects non-object payloads', () => {
    const dir = mkScratch();
    assert.throws(() => writeGDevelopProject(path.join(dir, 'x.json'), null));
    assert.throws(() => writeGDevelopProject(path.join(dir, 'x.json'), [1]));
    assert.throws(() => writeGDevelopProject(path.join(dir, 'x.json'), 'str'));
  });
});

describe('unit: control-shim AST mutations (scratch copies)', () => {
  let project;
  beforeEach(() => {
    project = minimalProject();
  });

  it('createScene injects a layout into projectData.layouts', () => {
    const scene = createScene(project, 'Level1');
    assert.equal(scene.name, 'Level1');
    assert.equal(project.layouts.length, 1);
    assert.equal(project.layouts[0].name, 'Level1');
    assert.ok(Array.isArray(project.layouts[0].objects));
    assert.ok(Array.isArray(project.layouts[0].events));
  });

  it('createScene fails closed on duplicates and blank names', () => {
    createScene(project, 'Level1');
    assert.throws(() => createScene(project, 'Level1'), /already exists|duplicate/i);
    assert.throws(() => createScene(project, ''), /scene/i);
    assert.throws(() => createScene(project, '  '), /scene/i);
    assert.throws(() => createScene(null, 'X'), /project/i);
  });

  it('createOrReplaceObject adds then replaces scene objects', () => {
    createScene(project, 'Level1');
    const first = createOrReplaceObject(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      objectType: 'Sprite',
      description: 'player avatar',
    });
    assert.equal(first.created, true);
    assert.equal(project.layouts[0].objects.length, 1);
    const second = createOrReplaceObject(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      objectType: 'Sprite',
    });
    assert.equal(second.created, false);
    assert.equal(project.layouts[0].objects.length, 1);
  });

  it('createOrReplaceObject supports global objects and fails on missing scenes', () => {
    const res = createOrReplaceObject(project, {
      objectName: 'GlobalScore',
      objectType: 'TextObject::Text',
    });
    assert.equal(res.created, true);
    assert.equal(project.objects.length, 1);
    assert.throws(
      () =>
        createOrReplaceObject(project, {
          sceneName: 'Missing',
          objectName: 'X',
          objectType: 'Sprite',
        }),
      /scene|not found/i
    );
    assert.throws(
      () => createOrReplaceObject(project, { objectName: '', objectType: 'Sprite' }),
      /object/i
    );
    assert.throws(
      () => createOrReplaceObject(project, { objectName: 'X', objectType: '' }),
      /object|type/i
    );
  });

  it('addBehavior injects family defaults (Platformer/Physics2/TopDown)', () => {
    createScene(project, 'Level1');
    createOrReplaceObject(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      objectType: 'Sprite',
    });
    const plat = addBehavior(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      behaviorName: 'Platformer',
      behaviorType: 'PlatformBehavior::PlatformerObjectBehavior',
    });
    assert.equal(plat.type, 'PlatformBehavior::PlatformerObjectBehavior');
    assert.ok(
      Object.keys(plat).length > 2,
      'platformer default content must ride along'
    );
    const phys = addBehavior(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      behaviorName: 'Physics',
      behaviorType: 'Physics2::Physics2Behavior',
    });
    assert.ok(Object.keys(phys).length > 2, 'physics default content missing');
    const td = addBehavior(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      behaviorName: 'Move',
      behaviorType: 'TopDownMovementBehavior::TopDownMovementBehavior',
    });
    assert.ok(Object.keys(td).length > 2, 'topdown default content missing');
    const hero = project.layouts[0].objects[0];
    assert.equal(hero.behaviors.length, 3);
    // Re-adding the same behavior name replaces in place.
    addBehavior(project, {
      sceneName: 'Level1',
      objectName: 'Hero',
      behaviorName: 'Platformer',
      behaviorType: 'PlatformBehavior::PlatformerObjectBehavior',
    });
    assert.equal(hero.behaviors.length, 3);
  });

  it('addBehavior fails closed on missing scenes/objects', () => {
    assert.throws(
      () =>
        addBehavior(project, {
          sceneName: 'Nope',
          objectName: 'X',
          behaviorName: 'B',
          behaviorType: 'Physics2::Physics2Behavior',
        }),
      /scene|not found/i
    );
    createScene(project, 'Level1');
    assert.throws(
      () =>
        addBehavior(project, {
          sceneName: 'Level1',
          objectName: 'Ghost',
          behaviorName: 'B',
          behaviorType: 'Physics2::Physics2Behavior',
        }),
      /object|not found/i
    );
  });

  it('addStandardEvent appends a Standard event to the scene', () => {
    createScene(project, 'Level1');
    const evt = addStandardEvent(project, {
      sceneName: 'Level1',
      conditions: [
        { type: { value: 'BuiltinCommonInstructions::Always' }, parameters: [] },
      ],
      actions: [{ type: { value: 'Hero::setX' }, parameters: ['Hero', '100'] }],
    });
    assert.equal(evt.type, 'BuiltinCommonInstructions::Standard');
    assert.equal(project.layouts[0].events.length, 1);
    assert.equal(project.layouts[0].events[0].conditions.length, 1);
    assert.equal(project.layouts[0].events[0].actions.length, 1);
  });

  it('addStandardEvent defaults empty conditions/actions and rejects missing scenes', () => {
    createScene(project, 'Level1');
    const evt = addStandardEvent(project, { sceneName: 'Level1' });
    assert.deepEqual(evt.conditions, []);
    assert.deepEqual(evt.actions, []);
    assert.throws(
      () => addStandardEvent(project, { sceneName: 'Ghost' }),
      /scene|not found/i
    );
    assert.throws(
      () =>
        addStandardEvent(project, { sceneName: 'Level1', conditions: 'x' }),
      /conditions/i
    );
  });

  it('full AST pipeline persists through write + re-read (real I/O)', () => {
    const dir = mkScratch();
    const file = path.join(dir, 'game.json');
    writeGDevelopProject(file, project);
    const loaded = readGDevelopProject(file);
    createScene(loaded, 'Level1');
    createOrReplaceObject(loaded, {
      sceneName: 'Level1',
      objectName: 'Hero',
      objectType: 'Sprite',
      description: 'player',
    });
    addBehavior(loaded, {
      sceneName: 'Level1',
      objectName: 'Hero',
      behaviorName: 'Platformer',
      behaviorType: 'PlatformBehavior::PlatformerObjectBehavior',
    });
    addStandardEvent(loaded, { sceneName: 'Level1', conditions: [], actions: [] });
    writeGDevelopProject(file, loaded);
    const reloaded = readGDevelopProject(file);
    assert.equal(reloaded.layouts[0].objects[0].behaviors[0].name, 'Platformer');
    assert.equal(reloaded.layouts[0].events[0].type, 'BuiltinCommonInstructions::Standard');
  });
});

describe('unit: control-shim CLI command builder', () => {
  it('formats --run-command args for electron-app/app/main.js parsing', () => {
    const cmd = buildGDevelopCliCommand({
      gdevelopPath: '/opt/GDevelop/GDevelop',
      projectPath: '/games/mygame/game.json',
      commandName: 'EXPORT_HTML5_EXTERNAL',
      cmdArgs: ['/tmp/out'],
      headless: true,
    });
    assert.equal(cmd.command, '/opt/GDevelop/GDevelop');
    const args = cmd.args;
    assert.ok(args.includes('--run-command'), 'must carry --run-command');
    assert.ok(args.includes('EXPORT_HTML5_EXTERNAL'));
    assert.ok(args.includes('--cmd-args'), 'cmd args use the --cmd-args flag');
    assert.ok(args.includes('/games/mygame/game.json'), 'project path positional');
    // Positional project path is last (matches --run-command README usage).
    assert.equal(args[args.length - 1], '/games/mygame/game.json');
    assert.ok(
      args.includes('--disable-update-check'),
      'headless runs skip the update check'
    );
  });

  it('omits --cmd-args when none given and rejects bad input', () => {
    const cmd = buildGDevelopCliCommand({
      gdevelopPath: 'GDevelop',
      projectPath: 'game.json',
      commandName: 'RUN_ALL_TESTS',
    });
    assert.ok(!cmd.args.includes('--cmd-args'));
    assert.throws(
      () =>
        buildGDevelopCliCommand({
          gdevelopPath: 'GDevelop',
          projectPath: 'game.json',
          commandName: 'not-a-command',
        }),
      /command/i
    );
    assert.throws(
      () =>
        buildGDevelopCliCommand({ gdevelopPath: '', projectPath: 'g.json', commandName: 'X' }),
      /gdevelop|path/i
    );
    assert.throws(
      () =>
        buildGDevelopCliCommand({ gdevelopPath: 'G', projectPath: '', commandName: 'X' }),
      /project/i
    );
  });
});

describe('unit: control-shim debugger bridge (live loopback WS)', () => {
  // Minimal RFC6455 server over node:net (test fixture, not the shim): accepts
  // one handshake, sends a greeting text frame, echoes client frames upper-cased.
  const serveOneWs = () =>
    new Promise(resolve => {
      const server = net.createServer(socket => {
        let buf = Buffer.alloc(0);
        let handshook = false;
        socket.on('data', chunk => {
          buf = Buffer.concat([buf, chunk]);
          if (!handshook) {
            const end = buf.indexOf('\r\n\r\n');
            if (end === -1) return;
            const head = buf.slice(0, end).toString('latin1');
            buf = buf.slice(end + 4);
            const key = /Sec-WebSocket-Key: (.*)\r\n/i.exec(head)?.[1].trim();
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
            const payload = Buffer.from('debugger:ready', 'utf8');
            socket.write(Buffer.from([0x81, payload.length]));
            socket.write(payload);
          } else if (buf.length >= 2) {
            const len = buf[1] & 0x7f;
            if (buf.length < 2 + 4 + len) return;
            const mask = buf.slice(2, 6);
            const payload = buf.slice(6, 6 + len);
            for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
            buf = buf.slice(6 + len);
            const upper = Buffer.from(payload.toString('utf8').toUpperCase(), 'utf8');
            socket.write(Buffer.from([0x81, upper.length]));
            socket.write(upper);
          }
        });
        server.close = server.close.bind(server);
      });
      server.listen(0, '127.0.0.1', () => resolve(server));
    });

  it('connects, receives server messages, and round-trips a send', async () => {
    const server = await serveOneWs();
    const port = server.address().port;
    const received = [];
    const bridge = await connectDebuggerBridge(port, msg => received.push(msg));
    // Greeting frame from the fake DebuggerServer.
    await new Promise(resolve => {
      const t = setInterval(() => {
        if (received.length > 0) {
          clearInterval(t);
          resolve();
        }
      }, 10);
    });
    assert.equal(received[0], 'debugger:ready');
    bridge.send({ command: 'getStatus' });
    await new Promise(resolve => {
      const t = setInterval(() => {
        if (received.length > 1) {
          clearInterval(t);
          resolve();
        }
      }, 10);
    });
    assert.match(
      typeof received[1] === 'string' ? received[1] : JSON.stringify(received[1]),
      /GETSTATUS/
    );
    bridge.close();
    await new Promise(resolve => server.close(resolve));
  });

  it('fails closed on invalid ports and refused connections', async () => {
    await assert.rejects(() => connectDebuggerBridge(0, () => {}), /port/i);
    await assert.rejects(() => connectDebuggerBridge(99999, () => {}), /port/i);
    await assert.rejects(() => connectDebuggerBridge(-1, () => {}), /port/i);
    await assert.rejects(() => connectDebuggerBridge('abc', () => {}), /port/i);
    // Loopback port that is (almost certainly) closed: must reject, never hang.
    await assert.rejects(
      () => connectDebuggerBridge(9, () => {}, { timeoutMs: 500 }),
      /refused|connect|timeout/i
    );
  });
});

describe('unit: control-shim zero-egress + zero-dependency', () => {
  it('never references the hosted API and imports only builtins', () => {
    const src = fs.readFileSync(CONTROL_SHIM_SRC, 'utf8');
    assert.ok(!src.includes('api.gdevelop.io'), 'BYOK path must not touch hosted API');
    const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]);
    for (const spec of imports) {
      assert.match(spec, /^node:/, `non-builtin import: ${spec}`);
    }
    assert.ok(!src.includes("from 'ws'"), 'no ws dependency allowed');
    assert.ok(!src.includes('axios'), 'no axios allowed');
  });
});
