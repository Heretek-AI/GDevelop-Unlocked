// Injected Generation shim (Phase 4, issue #4): the ONLY rewiring
// between stock upstream Generation.js and packages/ai-studio/.
//
// The fork's Generation.js delta (patches/07) branches every request
// path on `local-ai-*` ids / `isCustomEndpointEnabled()`. This module
// owns the three invariants behind those branches as pure, tested
// functions so the routing can never silently degrade:
//
//   1. local-ai-* requests route to the custom (BYOK) client, always.
//   2. Hosted requests route to the hosted API, unchanged.
//   3. A local-ai-* id NEVER reaches the hosted generation API
//      (no local-id leakage) — guarded, not just branched.
//
// `isCustomEndpointEnabled` here is pure (takes the endpoint config);
// reading localStorage (`gd-custom-ai-config`) stays with the caller
// (CustomAIClient.getCustomEndpointConfig), which the patch wires in.
//
// Delivery note: the shipped renderer does NOT import this module —
// patch 07 inlines the same predicates (see README.md, "Duplication
// contract"). tests/integration/shim-wiring-contract.test.mjs pins the
// inlined copies to this reference, starting with the prefix below.
export const LOCAL_AI_REQUEST_ID_PREFIX = 'local-ai-';

/** True for BYOK-local request ids (`local-ai-*`). */
export function isLocalAiRequestId(aiRequestId) {
  return (
    typeof aiRequestId === 'string' &&
    aiRequestId.startsWith(LOCAL_AI_REQUEST_ID_PREFIX)
  );
}

/** Split a batch into local vs hosted ids (mirrors the fork's 07 split). */
export function partitionAiRequestIds(aiRequestIds) {
  const localIds = [];
  const hostedIds = [];
  for (const id of aiRequestIds || []) {
    if (isLocalAiRequestId(id)) localIds.push(id);
    else hostedIds.push(id);
  }
  return { localIds, hostedIds };
}

/**
 * Pure endpoint switch. `config` is the CustomAIConfig shape
 * ({enabled, baseUrl, ...}); absent/disabled config means hosted.
 */
export function isCustomEndpointEnabled(config) {
  return !!(
    config &&
    config.enabled &&
    typeof config.baseUrl === 'string' &&
    config.baseUrl.length > 0
  );
}

/**
 * Backend selection for one request path.
 *   - Any local-ai-* id            -> 'custom' (config-independent: local
 *     requests have no hosted representation at all).
 *   - Custom endpoint enabled      -> 'custom'.
 *   - Otherwise                    -> 'hosted'.
 */
export function selectBackend({ aiRequestId, aiRequestIds, customConfig }) {
  const ids =
    aiRequestIds || (aiRequestId !== undefined ? [aiRequestId] : []);
  if (ids.some(isLocalAiRequestId)) return 'custom';
  if (isCustomEndpointEnabled(customConfig)) return 'custom';
  return 'hosted';
}

/**
 * Fail-closed guard: throw before any hosted generation call that
 * would carry a local-ai-* id (leakage). Callers wrap every hosted
 * fetch with this; the fork's 07 branches rely on it at each site.
 */
export function assertNoLocalIdsLeak(aiRequestIds, hostedEndpoint) {
  const ids = aiRequestIds || [];
  const leaked = ids.filter(isLocalAiRequestId);
  if (leaked.length > 0) {
    throw new Error(
      `[unlock-shim] refusing hosted call to ${hostedEndpoint} with ` +
        `local-ai-* ids (${leaked.join(', ')}): route to the custom ` +
        `client instead.`
    );
  }
}

/**
 * Wrap a hosted generation function with the leak guard. `pickIds(args)`
 * extracts the request id(s) from the hosted function's arguments.
 */
export function guardHostedCall(hostedFn, hostedEndpoint, pickIds) {
  return function guardedHostedCall(...args) {
    assertNoLocalIdsLeak(pickIds(...args), hostedEndpoint);
    return hostedFn.apply(this, args);
  };
}
