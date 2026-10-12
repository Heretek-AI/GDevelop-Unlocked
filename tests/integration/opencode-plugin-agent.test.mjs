// Integration Test: gdevelop-architect agent persona (T10, issue #17).
//
// Drives the real packages/opencode-gdevelop/ plugin setup through an
// in-process ctx double whose agent editor mirrors the host upsert
// semantics (review/opencode/packages/core/src/agent.ts: update() creates
// Info.default(id) when the id is absent), then confirms
// ctx.agent.get("gdevelop-architect") returns a valid config with real
// permission lists. Tool executors are NOT re-exercised here (covered by
// opencode-plugin-tools.test.mjs); this file asserts registration,
// persona content, permissions, packaging docs, and idempotency.
//
// Bare node:test + builtins only. No skipped tests.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { definition as pluginDefinition } from '../../packages/opencode-gdevelop/index.mjs';
import {
  ARCHITECT_ID,
  GDEVELOP_ARCHITECT,
  registerGDevelopAgents,
} from '../../packages/opencode-gdevelop/agents.mjs';
import { TOOL_NAMES } from '../../packages/opencode-gdevelop/tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// Host-faithful agent editor double: update() upserts like core agent.ts.
const createAgentEditorDouble = (seed = []) => {
  const agents = new Map(seed.map(a => [a.id, { ...a }]));
  return {
    agents,
    list: () => [...agents.values()],
    get: id => agents.get(id),
    default: () => {},
    update: (id, fn) => {
      const current = agents.get(id) || { id };
      if (!agents.has(id)) agents.set(id, current);
      fn(current);
      current.id = id;
    },
    remove: id => {
      agents.delete(id);
    },
  };
};

const createCtxDouble = (seedAgents = []) => {
  const agentEditor = createAgentEditorDouble(seedAgents);
  const tools = new Map();
  return {
    agentEditor,
    agent: {
      transform: async fn => {
        fn(agentEditor);
        return { dispose: async () => {} };
      },
      reload: async () => {},
      get: async id => agentEditor.get(id),
      list: async () => agentEditor.list(),
    },
    tool: {
      transform: async fn => {
        fn({
          list: () => [...tools.values()],
          get: id => tools.get(id),
          namespace: () => {},
          add: tool => {
            tools.set(tool.name, { ...tool, id: tool.name });
          },
          update: () => {},
          remove: id => {
            tools.delete(id);
          },
        });
        return { dispose: async () => {} };
      },
      reload: async () => {},
    },
  };
};

describe('integration: gdevelop-architect registration (real setup)', () => {
  let ctx;
  beforeEach(async () => {
    ctx = createCtxDouble();
    await pluginDefinition.setup(ctx);
  });

  it('registers the architect via ctx.agent.transform (upsert, id gdevelop-architect)', async () => {
    assert.equal(ARCHITECT_ID, 'gdevelop-architect');
    const agent = await ctx.agent.get('gdevelop-architect');
    assert.ok(agent, 'architect present after setup');
    assert.equal(agent.id, 'gdevelop-architect');
  });

  it('ctx.agent.get returns a valid config: subagent mode, named, described', async () => {
    const agent = await ctx.agent.get('gdevelop-architect');
    assert.equal(agent.mode, 'subagent');
    assert.ok(typeof agent.name === 'string' && agent.name.length > 0);
    assert.ok(typeof agent.description === 'string' && agent.description.length > 0);
    assert.deepEqual(
      { id: agent.id, mode: agent.mode },
      { id: GDEVELOP_ARCHITECT.id, mode: GDEVELOP_ARCHITECT.mode }
    );
  });

  it('system prompt covers GDevelop 5 architecture, GDJS lifecycle, events, assets', async () => {
    const agent = await ctx.agent.get('gdevelop-architect');
    assert.ok(typeof agent.system === 'string' && agent.system.length > 200);
    for (const topic of [
      /GDJS/i,
      /lifecycle|game loop|scene stack/i,
      /conditions/i,
      /actions/i,
      /sub-events/i,
      /behavior/i,
      /asset|resources/i,
    ]) {
      assert.match(agent.system, topic, `system prompt covers ${topic}`);
    }
  });

  it('permission list allows all gdevelop_* tools plus file read/write (real lists)', async () => {
    const agent = await ctx.agent.get('gdevelop-architect');
    assert.ok(Array.isArray(agent.permissions) && agent.permissions.length > 0);
    for (const rule of agent.permissions) {
      assert.ok(typeof rule.action === 'string');
      assert.ok(typeof rule.resource === 'string');
      assert.match(rule.effect, /^(allow|ask|deny)$/);
    }
    const allowed = new Set(
      agent.permissions.filter(r => r.effect === 'allow').map(r => r.action)
    );
    for (const tool of TOOL_NAMES) {
      assert.ok(allowed.has(tool), `architect may call ${tool}`);
    }
    assert.ok(allowed.has('read'), 'architect may read files');
    assert.ok(allowed.has('write'), 'architect may write files');
  });

  it('setup is idempotent and never clobbers sibling agents', async () => {
    ctx.agentEditor.set ?? null;
    const before = await ctx.agent.get('gdevelop-architect');
    await pluginDefinition.setup(ctx);
    const after = await ctx.agent.get('gdevelop-architect');
    assert.deepEqual(after, before, 'second setup converges to the same config');
    // Sibling agent registered outside the plugin survives a re-setup.
    ctx.agentEditor.update('build', a => {
      a.mode = 'primary';
      a.name = 'Build';
    });
    await pluginDefinition.setup(ctx);
    assert.equal((await ctx.agent.get('build')).name, 'Build');
    assert.equal((await ctx.agent.get('gdevelop-architect')).mode, 'subagent');
  });

  it('registerGDevelopAgents is exported standalone and matches setup output', async () => {
    const solo = createCtxDouble();
    await registerGDevelopAgents(solo);
    assert.deepEqual(
      await solo.agent.get('gdevelop-architect'),
      await ctx.agent.get('gdevelop-architect')
    );
  });
});

describe('integration: gdevelop plugin docs + packaging (T10)', () => {
  it('README documents tools, agent, and offline use', () => {
    const readme = fs.readFileSync(
      path.join(root, 'packages/opencode-gdevelop/README.md'),
      'utf8'
    );
    for (const tool of TOOL_NAMES) {
      assert.ok(readme.includes(tool), `README documents ${tool}`);
    }
    assert.ok(readme.includes('gdevelop-architect'), 'README documents the agent');
    assert.ok(/offline|zero-egress|zero egress/i.test(readme), 'README states offline scope');
  });

  it('agent sources stay zero-dep and zero-egress', () => {
    for (const file of ['agents.mjs', 'index.mjs']) {
      const src = fs.readFileSync(
        path.join(root, 'packages/opencode-gdevelop', file),
        'utf8'
      );
      assert.ok(!src.includes('api.gdevelop.io'), `${file}: zero egress`);
    }
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(root, 'packages/opencode-gdevelop/package.json'),
        'utf8'
      )
    );
    assert.equal(pkg.name, '@heretek-ai/opencode-gdevelop');
    assert.ok(!pkg.dependencies && !pkg.devDependencies, 'still zero deps');
  });

  it('uses os.tmpdir() scratch semantics (no hardcoded /tmp)', () => {
    const src = fs.readFileSync(
      path.join(root, 'tests/integration/opencode-plugin-agent.test.mjs'),
      'utf8'
    );
    assert.ok(!src.match(/['"]\/tmp\//), 'no hardcoded /tmp paths');
  });
});
