# packages/ai-studio — Tier-2 runtime (self-contained)

~8.9k-line BYOK AI + multi-agent Studio. Historically extracted from the
(now-retired) Heretek fork; this package is now the canonical source —
there is no donor checkout anywhere in build, test, or CI paths.
`MANIFEST.json` pins every file (bytes + sha256);
`tests/tier2/extract.test.mjs` fails if any byte drifts.

## Contents

| Path | Historical origin | Notes |
|---|---|---|
| `AI/CustomAIClient.js` | `newIDE/app/src/AI/CustomAIClient.js` (5870 lines) | OpenAI-compatible client, 39-tool `GDEVELOP_OPENAI_TOOLS`, SSE streaming, `gd-custom-ai-*` localStorage keys. **Zero `api.gdevelop.io` references** (pinned by test) |
| `AI/CustomAIClient.spec.js` | co-located spec | Run inside `newIDE/app` (`react-app-rewired test`), not here |
| `AiGeneration/Studio/*.js` (12 prod) | `AiGeneration/Studio/` (2371 LOC) | Roles, PlanStore, LoopGuard, SpawnSubAgents, FinalizeSubAgents, UseStudioRuntime, UseStudioNudge, NudgePolicy, RequestWriteGate, RoleToolPolicy, SafeTruncation, EditApprovalLabel |
| `dev-harness/mock-ai-provider.js` | `scripts/dev/mock-ai-provider.js` | Committed OpenAI-compatible mock for offline E2E (+ `mock-script*.json` fixtures) |

## Wiring

The glue patches `07`–`14` are the only rewiring (`patches/REBASE.md`
records how the forward-ports were built). Patch 07 inlines the routing
predicates; `packages/unlock-shim/generation-shim.mjs` is their tested
reference implementation, not a shipped import (see its README,
"Duplication contract").

## Desktop E2E (requires a built app — procedure, not automation)

1. Apply all patches to a checkout (`node scripts/apply-patches.mjs --target …`).
2. Start the offline harness: `node packages/ai-studio/dev-harness/mock-ai-provider.js`
   (or real Ollama at `http://localhost:11434/v1`; set `ORIGINS` for CORS).
3. In Preferences → AI, set Base URL to the harness, complete a generation.
4. Assert: subagent spawn/finalize loop runs (Roles/PlanStore/LoopGuard
   paths); **zero requests to `api.gdevelop.io/generation`** in BYOK mode
   (the hook logs spoofed usage calls in `window.__HERETEK__.spoofedRequests`;
   generation traffic is observable in the harness log).
