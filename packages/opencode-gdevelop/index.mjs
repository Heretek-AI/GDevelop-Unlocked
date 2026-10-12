// GDevelop OpenCode plugin entry (T09 tools + T10 architect, issue #17).
//
// Registers the six gdevelop_* project-control tools through the host
// `ctx.tool.transform(editor => editor.add(tool))` API and the
// gdevelop-architect persona through
// `ctx.agent.transform(editor => editor.update(id, fn))` (Promise plugin API:
// review/opencode/packages/plugin/src/README.md; ToolEditor.add in
// review/opencode/packages/plugin/src/promise/tool.ts; agent upsert in
// review/opencode/packages/core/src/agent.ts).
//
// `@opencode/plugin` is a host-provided peer API, NOT a bundled dependency
// (this package ships zero deps): the host resolves the import at load time,
// while offline runs (tests, CI) fall back to the identity passthrough below.

import { GDEVELOP_TOOLS } from './tools.mjs';
import { registerGDevelopAgents } from './agents.mjs';

/** Raw plugin definition; also exported for offline/test harnesses. */
export const definition = {
  id: 'gdevelop',
  setup: async ctx => {
    await ctx.tool.transform(editor => {
      for (const tool of GDEVELOP_TOOLS) editor.add(tool);
    });
    await registerGDevelopAgents(ctx);
  },
};

let Plugin = { define: def => def };
try {
  ({ Plugin } = await import('@opencode/plugin'));
} catch {
  // Host peer API absent outside the OpenCode runtime; identity holds the
  // { id, setup } shape so the definition stays importable offline.
}

export default Plugin.define(definition);
