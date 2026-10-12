# `@heretek-ai/opencode-gdevelop`

OpenCode plugin for **local, offline** GDevelop 5 project control. Six
`gdevelop_*` tools plus a `gdevelop-architect` subagent persona, all running
in-process with zero network egress (never contacts `api.gdevelop.io`).

## Install

This package is a plain ESM module with **zero dependencies**.
`@opencode/plugin` is a host-provided peer API, not a bundled dep: the
OpenCode runtime resolves the import at load time. Outside the runtime
(tests, CI) the entry falls back to an identity `Plugin.define`
passthrough so the `{ id, setup }` definition stays importable.

Point your OpenCode config at this directory as a local plugin; the entry
is `packages/opencode-gdevelop/index.mjs` (plugin id: `gdevelop`).

## Tools

| Tool | What it does |
| --- | --- |
| `gdevelop_project_read` | Inspect scenes/objects/behaviors/variables from a project on disk (optional `sceneName` narrows to one scene). |
| `gdevelop_project_create_scene` | Create a scene (layout); fails closed on duplicates/blank names. |
| `gdevelop_project_create_object` | Create/replace an object: `Sprite`, `TextObject::Text`, `PanelSpriteObject::PanelSprite`, `Scene3D::*`, or any engine type; scene-scoped or global. |
| `gdevelop_project_add_behavior` | Attach a behavior (e.g. `PlatformBehavior::PlatformerObjectBehavior`) with family defaults. |
| `gdevelop_project_add_events` | Append a `BuiltinCommonInstructions::Standard` event (`conditions[]`/`actions[]`) to a scene sheet. |
| `gdevelop_cli_run` | Format a headless CLI dispatch (`--run-command UPPER_SNAKE_CASE`, repeatable `--cmd-args`, `--disable-update-check`); the host spawns it. |

Every mutation delegates to
`packages/unlock-shim/control-shim.mjs` (`readGDevelopProject`,
`createScene`, `createOrReplaceObject`, `addBehavior`, `addStandardEvent`,
`buildGDevelopCliCommand`, `writeGDevelopProject`) — no reimplemented
project logic. Inputs are plain JSON-Schema objects; each `execute` returns
a host-shaped `{ output, content }` result and rejects fail-closed with the
path/id named.

## Agent: `gdevelop-architect`

Registered via `ctx.agent.transform(editor => editor.update(...))` (host
upsert semantics). Subagent-mode persona whose system prompt covers GDevelop
5 architecture, the GDJS lifecycle (game loop, scene stack), event
conditions/actions/sub-events, and asset management. Permissions: every
`gdevelop_*` tool (derived from `TOOL_NAMES`, so they cannot drift) plus
host file `read`/`write`.

## Offline scope

- No `dependencies`/`devDependencies`; only `node:` builtins + the control shim.
- No `api.gdevelop.io` references anywhere in the package.
- Tests (`tests/integration/opencode-plugin-tools.test.mjs`,
  `tests/integration/opencode-plugin-agent.test.mjs`) use in-process ctx
  doubles with real registries and real scratch-project I/O under
  `os.tmpdir()` — no mocks of the code under test.
