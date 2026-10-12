// Integration Test: opencode GDevelop plugin tools (T09, issue #17).
//
// Imports the real packages/opencode-gdevelop/ plugin (index.mjs +
// tools.mjs, which delegate every project mutation to
// packages/unlock-shim/control-shim.mjs — no reimplemented mutation logic)
// and drives it through an in-process ctx double whose tool editor is a real
// registry (Map-backed add/list/get) and whose tool executors perform REAL
// file mutations on scratch game.json projects under os.tmpdir().
// No mocks of the code under test; the only double is the host ctx object
// itself (the @opencode/plugin host is not running in this repo).
//
// Bare node:test + builtins only. No skipped tests.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pluginDefault, {
  definition as pluginDefinition,
} from '../../packages/opencode-gdevelop/index.mjs';
import {
  GDEVELOP_TOOLS,
  TOOL_NAMES,
} from '../../packages/opencode-gdevelop/tools.mjs';
import { readGDevelopProject } from '../../packages/unlock-shim/control-shim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// ---------------------------------------------------------------------------
// In-process host doubles (real registry behavior, real executor dispatch).
// ---------------------------------------------------------------------------

const createToolEditorDouble = () => {
  const tools = new Map();
  return {
    list: () => [...tools.values()],
    get: id => tools.get(id),
    namespace: () => {},
    add: tool => {
      assert.ok(tool && typeof tool.name === 'string', 'tool needs a name');
      assert.equal(typeof tool.execute, 'function', `${tool.name} needs execute`);
      tools.set(tool.name, { ...tool, id: tool.name });
    },
    update: (id, fn) => {
      const current = tools.get(id);
      if (current) fn(current);
    },
    remove: id => {
      tools.delete(id);
    },
  };
};

const createCtxDouble = () => {
  const editor = createToolEditorDouble();
  const agents = new Map();
  return {
    editor,
    tool: {
      transform: async fn => {
        fn(editor);
        return { dispose: async () => {} };
      },
      reload: async () => {},
      list: async () => editor.list(),
    },
    agent: {
      transform: async fn => {
        fn({
          list: () => [...agents.values()],
          get: id => agents.get(id),
          default: () => {},
          update: (id, fn2) => {
            const current = agents.get(id) || { id };
            agents.set(id, current);
            fn2(current);
            current.id = id;
          },
          remove: id => {
            agents.delete(id);
          },
        });
        return { dispose: async () => {} };
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Scratch projects (real I/O under os.tmpdir(), never /tmp hardcoded).
// ---------------------------------------------------------------------------

let scratchDirs = [];
const mkScratch = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdevelop-plugin-'));
  scratchDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

const minimalProjectFile = (dir, name = 'PluginGame') => {
  const file = path.join(dir, 'game.json');
  fs.writeFileSync(
    file,
    JSON.stringify(
      { properties: { name, version: '1.0.0' }, layouts: [], objects: [] },
      null,
      2
    ) + '\n',
    'utf8'
  );
  return file;
};

const runTool = async (editor, name, input) => {
  const tool = editor.get(name);
  assert.ok(tool, `tool registered: ${name}`);
  return tool.execute(input, {
    sessionID: 'sess-test',
    agent: 'build',
    messageID: 'msg-1',
    id: 'call-1',
    signal: AbortSignal.timeout(10000),
    progress: async () => {},
  });
};

describe('integration: gdevelop plugin registration (real setup)', () => {
  it('exports Plugin.define({id:"gdevelop",setup}) via the host API shape', async () => {
    const plugin = pluginDefault || pluginDefinition;
    assert.equal(plugin.id, 'gdevelop');
    assert.equal(typeof plugin.setup, 'function');
    assert.deepEqual(pluginDefinition.id, 'gdevelop');
  });

  it('setup registers all six gdevelop_* tools via ctx.tool.transform', async () => {
    const ctx = createCtxDouble();
    let transformCalls = 0;
    const counting = {
      ...ctx,
      tool: {
        ...ctx.tool,
        transform: async fn => {
          transformCalls += 1;
          return ctx.tool.transform(fn);
        },
      },
    };
    await pluginDefinition.setup(counting);
    assert.equal(transformCalls, 1, 'exactly one ctx.tool.transform call');
    const names = ctx.editor.list().map(t => t.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
    assert.deepEqual(GDEVELOP_TOOLS.map(t => t.name).sort(), [...TOOL_NAMES].sort());
    for (const tool of ctx.editor.list()) {
      assert.ok(tool.description.length > 0, `${tool.name} has a description`);
      assert.ok(tool.input && typeof tool.input === 'object', `${tool.name} has an input schema`);
    }
  });

  it('tool input schemas are plain JSON-schema objects (zero-dep host compatible)', () => {
    for (const tool of GDEVELOP_TOOLS) {
      assert.equal(tool.input.type, 'object', `${tool.name} input is an object schema`);
      assert.ok(tool.input.properties && typeof tool.input.properties === 'object');
    }
  });
});

describe('integration: gdevelop plugin tools mutate real projects', () => {
  let ctx;
  beforeEach(async () => {
    ctx = createCtxDouble();
    await pluginDefinition.setup(ctx);
  });

  it('create_scene → create_object → add_behavior → add_events round-trip on disk', async () => {
    const dir = mkScratch();
    const projectPath = minimalProjectFile(dir);

    const sceneRes = await runTool(ctx.editor, 'gdevelop_project_create_scene', {
      projectPath,
      sceneName: 'Level1',
    });
    assert.ok(sceneRes.output.created);
    assert.equal(sceneRes.output.sceneName, 'Level1');

    const objRes = await runTool(ctx.editor, 'gdevelop_project_create_object', {
      projectPath,
      sceneName: 'Level1',
      objectName: 'Hero',
      objectType: 'Sprite',
    });
    assert.ok(objRes.output.created);

    const behRes = await runTool(ctx.editor, 'gdevelop_project_add_behavior', {
      projectPath,
      sceneName: 'Level1',
      objectName: 'Hero',
      behaviorName: 'Platformer',
      behaviorType: 'PlatformBehavior::PlatformerObjectBehavior',
    });
    assert.equal(behRes.output.behaviorName, 'Platformer');

    const evtRes = await runTool(ctx.editor, 'gdevelop_project_add_events', {
      projectPath,
      sceneName: 'Level1',
      conditions: [],
      actions: [],
    });
    assert.equal(evtRes.output.eventType, 'BuiltinCommonInstructions::Standard');

    // Ground truth re-read from disk (not via tool output).
    const onDisk = readGDevelopProject(projectPath);
    const scene = onDisk.layouts.find(l => l.name === 'Level1');
    assert.ok(scene, 'scene persisted');
    const hero = scene.objects.find(o => o.name === 'Hero');
    assert.equal(hero.type, 'Sprite');
    assert.ok(hero.behaviors.some(b => b.name === 'Platformer'));
    assert.equal(scene.events.length, 1);
  });

  it('project_read inspects scenes/objects/behaviors/variables from disk', async () => {
    const dir = mkScratch();
    const projectPath = minimalProjectFile(dir);
    await runTool(ctx.editor, 'gdevelop_project_create_scene', {
      projectPath,
      sceneName: 'Menu',
    });
    await runTool(ctx.editor, 'gdevelop_project_create_object', {
      projectPath,
      sceneName: 'Menu',
      objectName: 'Title',
      objectType: 'TextObject::Text',
    });
    const res = await runTool(ctx.editor, 'gdevelop_project_read', { projectPath });
    assert.equal(res.output.projectName, 'PluginGame');
    const menu = res.output.scenes.find(s => s.name === 'Menu');
    assert.ok(menu, 'Menu scene reported');
    assert.deepEqual(menu.objects, ['Title']);
    assert.ok(typeof res.content === 'string' && res.content.includes('Menu'));
  });

  it('create_object supports Text/PanelSprite + 3D types', async () => {
    const dir = mkScratch();
    const projectPath = minimalProjectFile(dir);
    await runTool(ctx.editor, 'gdevelop_project_create_scene', {
      projectPath,
      sceneName: 'Stage',
    });
    for (const [objectName, objectType] of [
      ['Label', 'TextObject::Text'],
      ['Panel', 'PanelSpriteObject::PanelSprite'],
      ['Cube', 'Scene3D::Box3DObject'],
    ]) {
      const res = await runTool(ctx.editor, 'gdevelop_project_create_object', {
        projectPath,
        sceneName: 'Stage',
        objectName,
        objectType,
      });
      assert.ok(res.output.created, `${objectType} created`);
    }
    const onDisk = readGDevelopProject(projectPath);
    const stage = onDisk.layouts.find(l => l.name === 'Stage');
    assert.deepEqual(
      stage.objects.map(o => o.type).sort(),
      ['PanelSpriteObject::PanelSprite', 'Scene3D::Box3DObject', 'TextObject::Text'].sort()
    );
  });

  it('cli_run formats a headless dispatch via buildGDevelopCliCommand', async () => {
    const res = await runTool(ctx.editor, 'gdevelop_cli_run', {
      gdevelopPath: '/opt/gdevelop/gdevelop',
      projectPath: '/games/demo/game.json',
      commandName: 'EXPORT_ANDROID',
      cmdArgs: ['--debug'],
      headless: true,
    });
    assert.equal(res.output.command, '/opt/gdevelop/gdevelop');
    assert.ok(res.output.args.includes('--run-command'));
    assert.ok(res.output.args.includes('EXPORT_ANDROID'));
    assert.ok(res.output.args.includes('--disable-update-check'));
    assert.ok(res.output.args.includes('/games/demo/game.json'));
  });
});

describe('integration: gdevelop plugin tools fail closed (adversarial)', () => {
  let ctx;
  beforeEach(async () => {
    ctx = createCtxDouble();
    await pluginDefinition.setup(ctx);
  });

  it('missing project files reject with the path named', async () => {
    const dir = mkScratch();
    const missing = path.join(dir, 'nope.json');
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_read', { projectPath: missing }),
      /not found|ENOENT/i
    );
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_create_scene', {
        projectPath: missing,
        sceneName: 'X',
      }),
      /not found|ENOENT/i
    );
  });

  it('blank scene/object names reject', async () => {
    const dir = mkScratch();
    const projectPath = minimalProjectFile(dir);
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_create_scene', {
        projectPath,
        sceneName: '  ',
      }),
      /sceneName|non-empty/i
    );
    await runTool(ctx.editor, 'gdevelop_project_create_scene', {
      projectPath,
      sceneName: 'S1',
    });
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_create_object', {
        projectPath,
        sceneName: 'S1',
        objectName: '',
        objectType: 'Sprite',
      }),
      /objectName|non-empty/i
    );
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_create_scene', {
        projectPath,
        sceneName: 'S1',
      }),
      /already exists/i
    );
  });

  it('unknown scene for object/behavior/event writes rejects', async () => {
    const dir = mkScratch();
    const projectPath = minimalProjectFile(dir);
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_create_object', {
        projectPath,
        sceneName: 'Ghost',
        objectName: 'O',
        objectType: 'Sprite',
      }),
      /scene not found/i
    );
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_add_behavior', {
        projectPath,
        sceneName: 'Ghost',
        objectName: 'O',
        behaviorName: 'B',
        behaviorType: 'PlatformBehavior::PlatformerObjectBehavior',
      }),
      /scene not found|object not found/i
    );
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_add_events', {
        projectPath,
        sceneName: 'Ghost',
      }),
      /scene not found/i
    );
  });

  it('malformed events (non-array conditions/actions) reject', async () => {
    const dir = mkScratch();
    const projectPath = minimalProjectFile(dir);
    await runTool(ctx.editor, 'gdevelop_project_create_scene', {
      projectPath,
      sceneName: 'S1',
    });
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_add_events', {
        projectPath,
        sceneName: 'S1',
        conditions: 'always',
      }),
      /conditions must be an array/i
    );
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_project_add_events', {
        projectPath,
        sceneName: 'S1',
        actions: { do: 'x' },
      }),
      /actions must be an array/i
    );
  });

  it('CLI dispatch with bad command names/paths rejects', async () => {
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_cli_run', {
        gdevelopPath: '/opt/gdevelop/gdevelop',
        projectPath: '/games/demo/game.json',
        commandName: 'export-android',
      }),
      /UPPER_SNAKE_CASE/i
    );
    await assert.rejects(
      runTool(ctx.editor, 'gdevelop_cli_run', {
        gdevelopPath: '',
        projectPath: '/games/demo/game.json',
        commandName: 'EXPORT_ANDROID',
      }),
      /gdevelopPath is required/i
    );
  });
});

describe('integration: gdevelop plugin packaging (zero-dep, zero-egress)', () => {
  it('package name uses the @heretek-ai scope and declares zero deps', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'packages/opencode-gdevelop/package.json'), 'utf8')
    );
    assert.equal(pkg.name, '@heretek-ai/opencode-gdevelop');
    assert.ok(!pkg.dependencies, 'no runtime dependencies allowed');
    assert.ok(!pkg.devDependencies, 'no devDependencies allowed');
    assert.ok(!pkg.name.startsWith('@gdevelop'), 'never the upstream-owned scope');
  });

  it('plugin sources never touch the hosted API and import the control shim', () => {
    for (const file of ['index.mjs', 'tools.mjs']) {
      const src = fs.readFileSync(
        path.join(root, 'packages/opencode-gdevelop', file),
        'utf8'
      );
      assert.ok(!src.includes('api.gdevelop.io'), `${file}: zero egress`);
    }
    const toolsSrc = fs.readFileSync(
      path.join(root, 'packages/opencode-gdevelop/tools.mjs'),
      'utf8'
    );
    assert.match(toolsSrc, /control-shim\.mjs/, 'tools delegate to the control shim');
    assert.ok(!toolsSrc.includes('writeFileSync'), 'no reimplemented project mutation');
  });
});
