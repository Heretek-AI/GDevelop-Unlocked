# REBASE: per-upstream-release runbook + record of the forward-ports

## Runbook (issue #13) — run for every upstream release you want to ship

Rebasing is a deliberate, human-gated task. Steps 1–2 are safe to run at
any time and tell you whether a rebase is needed at all.

1. **Drift check, no changes anywhere** (fixture untouched):

   ```bash
   S="$(mktemp -d)"   # honors TMPDIR
   git clone --depth 1 --filter=blob:none --sparse \
     https://github.com/4ian/GDevelop "$S/up"          # or: --branch <tag>
   git -C "$S/up" sparse-checkout set newIDE/app/src newIDE/electron-app
   UPSTREAM_DIR="$S/up" npm test                       # seams + every patch gate
   mkdir "$S/apply"
   git -C "$S/up" archive HEAD newIDE/app/src newIDE/electron-app | tar -x -C "$S/apply"
   UPSTREAM_DIR="$S/up" node scripts/apply-patches.mjs --target "$S/apply"
   ```

   All green means the stack still applies to that ref: only step 5–6
   remain. (`pins.test` skips its fixture check under `UPSTREAM_DIR`.)
2. **If anything is red**, the failing test names the patch and usually
   the file:line. Tier-1 (01–06): fix the anchor in
   `scripts/generate-tier1-patches.mjs` and regenerate — never hand-edit.
3. **Curated forward-ports (07/08/11/13/14)**: three-way merge per
   touched file, with **our own patched file as the third side** — the
   donor fork is retired and patch 07 now carries changes it never had:

   ```bash
   # base  = upstream file at the OLD pin
   # cur   = upstream file at the NEW ref
   # other = OLD-pin file with the current patch applied
   git merge-file -p --diff3 cur base other > merged
   diff -U3 --label=a/<path> --label=b/<path> cur merged > patches/NN-….patch
   ```

   (A plain `diff -U3` with those labels reproduces the committed patches
   byte-for-byte — checked for 07.) Resolve keep-both, and extend the
   `noDelete` lists in `tests/tier2/tier2-patches.test.mjs` for any
   upstream-new symbol the merge had to preserve.
4. **Patch 07 only**: every hosted call site in `Generation.js` must be
   classified in `tests/integration/shim-wiring-contract.test.mjs`
   (`CALL_SITES`). A new upstream endpoint turns it red on purpose —
   decide its BYOK behavior, do not just add it to the table.
5. **Move the pin, all three places at once** (`pins.test` fails on a
   partial bump): `UPSTREAM_BASELINE.json`, the checkout line in
   `seam-tests.yml`, the `upstream_ref` default in `release.yml`. Then
   refresh `review/GDevelop` to that commit.
6. **Validation build**: dispatch `release.yml` with `publish=false`.
   It fails if upstream has not published the exact `libGD.js` for the
   ref (`REQUIRES_EXACT_LIBGD_JS_VERSION`), if `app-update.yml` survives
   in the build output, or if the per-OS smoke is not `ok:true`. Only
   then `publish=true`.

Last drift check: 2026-10-11, upstream HEAD `ce7be6913f` (one commit past
the pin, nothing under `newIDE/`) — suite and full apply green, no
rebase needed, pin left at `8301cdcaa4`.

# Record: Tier-2 forward-ports 07/08/11 (2026-10-11)

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

## Post-fork additions (not in the donor — keep them through every rebase)

- **Patch 07, attachment guards (2026-10-11):** `createAiAttachmentUploads`
  throws when the custom endpoint is enabled or the user is `local-*`;
  `createAiAttachmentDownloads` returns not-found entries for a `local-*`
  user. Upstream added the attachment API after the fork diverged, so the
  fork never had a BYOK branch for it (audit A2). Pinned by
  `tests/integration/shim-wiring-contract.test.mjs` and a driver marker.

## Rebase again when

Upstream touches any of the seven forward-ported files (07/08: five files;
13/14: `AiRequestContext.js`, `AiGeneration/Utils.js`) — the weekly
`seam-tests` run and the runbook's drift check both surface it. The donor
fork is retired and no longer advances. Repeat the merge-file procedure
above; conflicts will be small if done regularly.
