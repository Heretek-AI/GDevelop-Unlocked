# REBASE record: Tier-2 forward-ports 07/08/11 (2026-10-11)

## Why these three are curated, not generated

`scripts/generate-tier2-patches.mjs` emits *verbatim* fork deltas
(`diff upstream@8301cdc fork@f7d450a`). The fork last synced upstream at
`b9109cf` (#9124, ~87 commits before `8301cdc`), so verbatim deltas
**delete newer upstream code**: chat attachments (#9135/#9162) and the
effects-store default tab (#9136). Applied verbatim, three patched-tree
files import symbols that no longer exist (proven 2026-10-10, see
AUDIT_REPORT.md §3 pre-rebase).

Patches 07/08/11 are therefore **forward-ports**: upstream@8301cdc text +
the fork's BYOK intent, with upstream-new code preserved. They are NOT
byte-equal to generator output, and the determinism test pins only 09/10
(purely additive verbatim deltas). Do NOT re-add 07/08/11 to the
generator's verbatim list — that would reintroduce the deletions.

## Method (reproducible)

Three-way merge per file with `git merge-file`:

- `base`  = upstream file at `b9109cf` (fork sync point)
- `cur`   = upstream file at `8301cdc` (current baseline)
- `other` = fork file at `f7d450a` (donor HEAD)
- `git merge-file -p --diff3 cur base other`

Result 2026-10-11:

- `Generation.js`, `PreferencesDialog.js`, `PreferencesContext.js`,
  `PreferencesProvider.js`: **zero conflicts** — merged automatically.
- `AskAiEditorContainer.js`: **7 conflicts**, all the same shape
  (upstream added attachment/in-game-editor constructs the fork predates;
  fork added BYOK session/error-state logic). Resolved keep-both:
  1. create-request call keeps upstream `attachmentIds` + fork
     `userId: activeUserId`.
  2. send gate keeps fork `canSendAiRequestForSession`/`activeUserId` +
     upstream attachment-aware `hasUserMessage`.
  3. empty-send guard keeps upstream `hasUserMessage` + fork `return false`.
  4. send path keeps upstream in-game-editor error block + fork outer
     `let aiRequest` error-state assignment.
  5. telemetry keeps fork `isFailedAiRequestStart` guard +
     upstream `hasUserMessage` condition.
  6. upstream's moved reset-input block kept, extended with fork's
     `!sendFailed` guard.
  7. dep array keeps upstream `onSaveProjectAsWithStorageProvider` +
     fork's three hook deps; both `useStudioRuntime`/`useStudioNudge`
     mounts kept.

## Verification performed at rebase time

- New patches contain zero minus-lines touching `AiRequestAttachment`,
  `createAiAttachment*`, `newEffectDialogDefaultTab`, `attachmentIds`.
- Full 11-patch scratch apply green; all 47 cross-tree `Generation.js`
  imports resolve to exports; `newEffectDialogDefaultTab` defined where
  `ApplyProjectPreferences.js` reads it.
- `PreferencesStorage.js` (fork-only new file) unchanged — still carried
  as a new-file hunk inside patch 08.

## Follow-up gaps found by the first release build (patches 12–14)

Webpack's compile caught what markers cannot: the rebased container
imports session/studio helpers that live in three more fork-diverged
files. Each was forward-ported the same way (merge-file, keep-both on
conflict):

- **12 `AiRequestUtils.js`**: no upstream drift (`base == cur`), so the
  fork delta applied verbatim — 10 helpers (`canStartAiRequestCreate`,
  `canSendAiRequestForSession`, `isFailedAiRequestStart`,
  `getUnselectedActiveRequests`, `shouldFetchAiRequestOnTabOpen`, …).
- **13 `AiRequestContext.js`**: upstream drift present, one conflict
  (upstream extracted `dismissEditApprovals()`; fork dropped the profile
  gate) → resolved to gateless `dismissEditApprovals()` call. Note:
  upstream independently grew its own `activeSubAgents`/`activateSubAgent`
  context fields after the fork diverged (convergent evolution) — patch
  13 only adds the BYOK remainder (`customUpdateAiRequest`,
  `LOCAL_BYOK_USER_ID` fallbacks, `parentHasOutputForCall`).
- **14 `AiGeneration/Utils.js`**: upstream drift present, two conflicts
  (upstream added `onSaveProjectAsWithStorageProvider`; fork added
  `activateSubAgent`/`updateAiRequest`/`isSendingAiRequest` to
  `useProcessFunctionCalls` args + type, and `enqueueRequestWrite` to its
  return) → all four props kept on both sites.
- Permanent gate: `tests/integration/patched-import-closure.test.mjs`
  resolves every relative import across the patched surface
  (negative-controlled: removing patch 12 reproduces the exact webpack
  failure).

## Rebase again when

Upstream touches any of the five merged files (weekly seam check), or the
donor advances. Repeat the merge-file procedure above; conflicts will be
small if done regularly.
