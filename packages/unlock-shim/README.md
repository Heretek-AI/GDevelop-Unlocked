# packages/unlock-shim — injected seams (Tier-1 + Tier-2 support)

Thin, tested modules that sit between stock upstream code and the
unlocked runtime. Everything here is framework-free and covered by
`tests/` — no React, no Electron, no GDevelop core imports.

| Module | Role | Tests |
|---|---|---|
| `generation-shim.mjs` | Tier-2 routing: `local-ai-*` → custom client, hosted → hosted API, fail-closed leak guard (`assertNoLocalIdsLeak`, `guardHostedCall`) | `tests/tier2/shim.test.mjs` |

## Wiring contract (what the glue patches connect)

- Patch 07 calls `selectBackend({aiRequestId(s), customConfig})` at each
  Generation.js branch point; every hosted call site is wrapped with
  `guardHostedCall(fn, endpoint, pickIds)` so a `local-ai-*` id can
  never leak to `api.gdevelop.io/generation`, even if a branch is missed.
- `isCustomEndpointEnabled(config)` is pure: the caller supplies the
  endpoint config (read via `CustomAIClient.getCustomEndpointConfig`,
  backed by `gd-custom-ai-config`). No localStorage access in this module
  keeps it runnable in Node tests.
