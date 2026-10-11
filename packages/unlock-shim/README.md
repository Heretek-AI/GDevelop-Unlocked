# packages/unlock-shim — routing invariants (reference implementation)

Thin, tested modules that state the invariants the unlocked runtime
relies on. Everything here is framework-free and covered by `tests/` —
no React, no Electron, no GDevelop core imports.

| Module | Role | Tests |
|---|---|---|
| `generation-shim.mjs` | Tier-2 routing: `local-ai-*` → custom client, hosted → hosted API, fail-closed leak guard (`assertNoLocalIdsLeak`, `guardHostedCall`) | `tests/tier2/shim.test.mjs`, `tests/integration/ai-byok-flow.test.mjs` |

## Duplication contract (what actually ships)

**The shipped renderer does not import this package.** Patch 07 inlines
the same predicates into `Generation.js` instead of calling them, so the
patch stays a self-contained forward-port of the fork delta and the
webpack build needs no extra module. The two copies are kept in step by
`tests/integration/shim-wiring-contract.test.mjs`, which applies the real
patch 07 to a pristine fixture copy and checks every hosted call site:

| Shim function | Inlined in patch 07 as | Where |
|---|---|---|
| `isLocalAiRequestId(id)` | `aiRequestId.startsWith('local-ai-')` short-circuit before the hosted request | every function whose hosted URL carries the id (`getAiRequest`, `addMessageToAiRequest`, `retry`/`suspend`/`update`/`delete`/`fork`, feedback, suggestions, message update) |
| `partitionAiRequestIds(ids)` | `localIds` / `hostedIds` filters; only `hostedIds` are sent | `getAiRequestStatuses` |
| `selectBackend({customConfig})` | `isCustomEndpointEnabled() \|\| userId.startsWith('local-')` early return | `createAiRequest`, `createAiGeneratedEvent`, asset/resource search, presigned URLs, `fetchAiSettings` |
| `guardHostedCall` / `assertNoLocalIdsLeak` | **not inlined** — there is no fail-closed wrapper in the shipped code; the short-circuits above are the only barrier | — |

Consequences to keep in mind:

- The fail-closed guard is a property of this reference module, not of
  the product. In the product a missed branch leaks instead of throwing;
  the contract test is the compensating control (an unclassified hosted
  call site fails the suite).
- The contract test is source-order proof, not execution (its header
  states the limit). Live zero-egress proof is issue #12.
- Known gap, pinned by the test: `createAiAttachmentUploads` and
  `createAiAttachmentDownloads` (upstream-new, preserved by the 07
  forward-port) have no BYOK branch.
- `isCustomEndpointEnabled(config)` here is pure (caller supplies the
  config); the shipped one in `CustomAIClient` reads `gd-custom-ai-config`
  from localStorage itself.

When rebasing patch 07 (`patches/REBASE.md`): a new upstream hosted
function turns the contract test red until it is added to `CALL_SITES`
with a deliberate BYOK decision.
