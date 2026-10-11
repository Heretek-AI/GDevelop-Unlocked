# DRAFT — not sent. Upstream proposal 1: credit-read hardening (issue #7)

**Status: draft only.** Nothing has been opened on `4ian/GDevelop`.
Sending this (issue or PR) needs explicit owner approval.

This is the smallest of the three proposals in
`docs/upstream-ai-provider-rfc.md`: a pure robustness change with no
BYOK, entitlement or pricing content. It is deliberately standalone —
it does not mention this project and does not depend on anything else
being accepted.

## The change

`credit-read-hardening.diff` (next to this file), against upstream
`8301cdcaa4`. `git apply --check` passes on a pristine copy of that
commit. Four files, +31/−6:

- `AiGeneration/AiRequestChat/Utils.js` — new `getAvailableCredits(limits)`
  returning the balance, or `0` when limits are absent or partial.
- `AskAiEditorContainer.js`, `AskAiStandAloneForm.js`,
  `AiRequestChat/ChatMessages.js` — the three AI call sites use it
  instead of `limits ? limits.credits.userBalance.amount : 0`.

Not verified here: upstream's own test suite and Flow check were not run
against the diff (no `node_modules` in this repo). Do that in an
upstream checkout before sending — `npm run flow` and `npm test` in
`newIDE/app`.

## Suggested PR text

> **Title:** Read AI credits defensively when user limits are partial
>
> `getUserLimits` validates only that the response has a top-level
> `capabilities` key (`ensureObjectHasProperty` in
> `Utils/GDevelopServices/Usage.js`). The three AI entry points then
> read `limits.credits.userBalance.amount` behind a `limits ?` check
> alone, so a limits object without `credits` (or without
> `userBalance`) throws during render and takes the Ask AI panel down
> with it.
>
> This adds a small `getAvailableCredits(limits)` helper next to
> `canPayForAiRequest` and uses it at those three call sites. A missing
> or partial balance reads as `0`, which is what the existing
> `limits ? … : 0` fallback already means for "not loaded yet". Send
> gating is unchanged: `canPayForAiRequest` still decides.
>
> No behavior change when the limits response is complete.

## Honest framing for the conversation

- We have **not** observed the hosted Usage API returning a partial
  `limits` payload. This is defensive: the type says the field is
  required, the runtime validator does not check it, and the failure
  mode (a render crash) is out of proportion to the cause.
- The other call sites that read the same path (`WalletWidget`,
  `CreditsPackagesDialog`, the asset-store purchase pages) are left
  alone to keep the PR reviewable; mention them and offer a follow-up.
- If asked where this came from: it was found while running the editor
  against a self-hosted, OpenAI-compatible endpoint. Say so plainly.
  Do not lead with it, and do not attach the provider-interface RFC to
  this PR — that is a separate, much larger conversation.

## What must never ride along

Anything from patches 01–06, the `canAffordAiRequest` BYOK bypass that
ships in the same file here (patch 10), or any of the verbatim fork
deltas that delete upstream-new code (see the RFC's compatibility
note).
