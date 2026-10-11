# patches/ — Tier-1 entitlement unlocks (Phase 2, issue #2)

Stock upstream **source** + these hunks = fork parity for Tier-1, with no
205-file merge treadmill. Applied by `scripts/apply-patches.mjs --target
<checkout>` before building; every hunk is gated by the Phase 1 seam
suite. They cannot apply to a release `app.asar` (bundled renderer) —
that path is launcher-only, see `launcher/README.md`.

## Files

| Patch | Upstream target(s) | Unlock |
|---|---|---|
| `01-usage-predicate.patch` | `Utils/GDevelopServices/Usage.js` | `hasValidSubscriptionPlan` -> `return true`; seeds `UNLOCKED_HERETEK_SUBSCRIPTION` / `UNLOCKED_HERETEK_CAPABILITIES` (`planId: 'gdevelop_startup'`) |
| `02-auth-context-seed.patch` | `Profile/AuthenticatedUserContext.js` | Import + logged-in/logged-out default seeds |
| `03-subscription-checker.patch` | `Profile/Subscription/SubscriptionChecker.js` | Both closures stubbed to `return true` |
| `04-loading-screen.patch` | `ProjectManager/LoadingScreenEditor.js` | Logo guard + watermark guard/clamp deleted |
| `05-preview-debugger.patch` | `.../LocalPreviewLauncher/index.js`, `.../DebuggerEditorContainer.js` | `% 16` block deleted; network-preview + debugger stubs |
| `06-electron-hook.patch` | `electron-app/app/main.js` (loader line only) + `launcher/*.cjs` sync by the driver | Main-process hook install before the `BrowserWindow` destructure |
| `07-generation-glue.patch` | `Utils/GDevelopServices/Generation.js` (**curated forward-port**, see `REBASE.md`) | Tier-2 branch points: `local-ai-*` / `isCustomEndpointEnabled()` routing into the extracted client; upstream-new attachment API (`AiRequestAttachment`, `createAiAttachmentUploads/Downloads`) preserved, with a BYOK guard added here (uploads refused, never sent to hosted storage) |
| `08-preferences-ai.patch` | `Preferences{Dialog,Context,Provider}.js` (**curated forward-port**, see `REBASE.md`) + fork-only `PreferencesStorage.js` (new file) | `ai` preferences tab + persistable-preferences leaf (API key never persisted); upstream-new `newEffectDialogDefaultTab` preserved |
| `09-prepare-ai-content.patch` | `AiGeneration/PrepareAiUserContent.js` (verbatim fork delta, audit remediation) | BYOK early return: custom-endpoint or `local-` sessions inline project JSON, never touch S3 presigned upload (fixes cloud leak + 401 crash). Purely additive — no upstream revert |
| `10-ai-chat-affordance.patch` | `AiGeneration/AiRequestChat/Utils.js` (verbatim fork delta, audit remediation) | Adds `getAvailableCredits` (partial-limits crash fix) + `canAffordAiRequest` (0-credit BYOK sends). Purely additive — no upstream revert |
| `11-studio-runtime-mount.patch` | `AiGeneration/AskAiEditorContainer.js` (**curated forward-port**, see `REBASE.md`, audit remediation) | Mounts `useStudioRuntime` + `useStudioNudge`; BYOK session fallback; `canAffordAiRequest` gates; upstream-new `attachmentIds` plumbing and in-game-editor error block preserved |
| `12-ai-request-utils.patch` | `AiGeneration/AiRequestUtils.js` (verbatim — no upstream drift; release-build remediation) | Ports the 10 session/studio helpers the container needs (`canStartAiRequestCreate`, `canSendAiRequestForSession`, `isFailedAiRequestStart`, `getUnselectedActiveRequests`, `shouldFetchAiRequestOnTabOpen`, …) |
| `13-ai-request-context.patch` | `AiGeneration/AiRequestContext.js` (**curated forward-port**, see `REBASE.md`; release-build remediation) | Studio context fields (`activeSubAgents`, `activateSubAgent`, …); one conflict resolved keep-both (upstream `dismissEditApprovals` helper + fork gateless dismiss) |
| `14-ai-utils.patch` | `AiGeneration/Utils.js` (**curated forward-port**, see `REBASE.md`; release-build remediation) | `useProcessFunctionCalls` gains studio args/return (`enqueueRequestWrite`, …); two conflicts resolved keep-both (upstream attachment-save prop + fork studio callbacks) |

> Tier-2 runtime overlay: patches 07/09/11 import `../AI/CustomAIClient` and
> `./Studio/*`, which do not exist upstream. The driver copies
> `packages/ai-studio/{AI/CustomAIClient.js,AiGeneration/Studio/*.js}` into
> `newIDE/app/src/` on every `--target`/`--asar` run (verified byte-equal);
> `*.spec.js` files are never shipped into the target tree.

Out of scope: local HTML5/desktop exports (never gated upstream);
online-build quotas (server-enforced); the duration-slider gate
(`LoadingScreenEditor` ~:387, fork-kept).

## Regeneration

Patches are generated, not hand-edited — anchors assert a single match
and fail loudly on drift:

```bash
node scripts/generate-tier1-patches.mjs --upstream review/GDevelop
```

Each generated patch round-trips (`patch -p1 --dry-run` on a pristine
copy) before it is written. Patched output matches the fork byte-for-byte
on 3 of 6 files; the only residuals are intentional non-Tier-1 exclusions:

- `Usage.js` quota type fields (`nextCreditsBackAt`, …) — fork cleanup
- `AuthenticatedUserContext.js` `type` import tweak — fork cleanup
- `LocalPreviewLauncher` `previewContext`/`sourceGameId` — upstream-sync drift
