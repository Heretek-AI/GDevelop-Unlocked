# RFC draft: provider-agnostic AI interface for upstream GDevelop (Vector E)

Status: **draft for diplomacy, not on any critical path** (issue #7).
If rejected, close as wontfix-with-notes — M1/M2 delivery is unaffected
either way. This proposes an interface only. It pointedly does NOT
propose paywall-disable hooks, entitlement overrides, or any change to
subscription/credit monetization.

## Problem

The IDE's AI surface (`Utils/GDevelopServices/Generation.js`,
`AiGeneration/`) is hard-wired to the hosted generation API. There is
no seam where an alternative completion provider (self-hosted gateway,
enterprise proxy, local OpenAI-compatible server) can participate —
so BYOK-style integrations can only exist as forks.

## Proposal: `AiProvider` interface

A minimal provider contract, implemented once for hosted and open for
alternatives:

```ts
// Sketch — names illustrative, semantics load-bearing.
interface AiRequestSummary { id: string; status: string; }
interface AiProvider {
  readonly id: string;            // 'hosted' | 'custom-endpoint' | ...
  createRequest(options): Promise<{ id: string }>;
  getRequest(id: string): Promise<AiRequestSummary>;
  addMessage(id: string, message): Promise<void>;
  supportsStreaming(): boolean;
}
```

- `Generation.js` routes by request-id namespace (`local-*` vs hosted),
  exactly as the reference implementation in `packages/unlock-shim/`
  demonstrates — the shim's `selectBackend` / `assertNoLocalIdsLeak`
  semantics are donated as the starting point.
- Provider registration is explicit and user-configured (endpoint URL +
  opt-in flag in Preferences); there is no auto-discovery and no
  silent fallback from hosted to custom or back.
- Guardrails that keep this mergeable:
  1. **Credits/quota accounting stays server-side.** Providers report
     usage; they never mint entitlements. A custom provider grants no
     premium features — it only completes prompts.
  2. **No entitlement surface.** The interface carries no plan,
     subscription, or capability objects; paywall logic is untouched.
  3. **Local calls are labeled.** Requests served by a non-hosted
     provider carry a distinct id namespace and are excluded from
     hosted feedback/training pipelines by construction.
  4. **Enterprise framing:** BYOK as an enterprise/self-hosting feature
     (data-residency, key control), not a consumer-unlock story.

## Reference implementation offered

- `packages/ai-studio/AI/CustomAIClient.js`: OpenAI-compatible client
  (config, tool schema, SSE streaming, retries + fallback routing).
- `packages/unlock-shim/generation-shim.mjs`: routing + fail-closed
  leak guard, dependency-free, tested.
- `packages/ai-studio/dev-harness/mock-ai-provider.js`: deterministic
  offline provider for CI.

## Out of scope (will not be proposed)

Client-side entitlement unlocks, splash/watermark/debugger/preview
gating changes, build-quota changes, or any auto-updater/feed changes.
