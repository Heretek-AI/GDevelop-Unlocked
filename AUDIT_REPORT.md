# AUDIT REPORT — GDevelop-Unlocked adversarial audit (2026-10-11)

- Audited commit: `13ddde2` (`feature/ci-e2e`) + remediation in working tree.
- Fixtures: upstream `review/GDevelop @ 8301cdcaa4`, donor fork `review/GDevelop-Heretek @ f7d450a1d9a`.
- Full suite at report time: **96/96 green** (32 suites), `apply-patches.mjs --check` green.
- Scratch full-apply verification: all **11 patches** apply to pristine upstream + markers/overlay verify green. Fixture never mutated (applied to `git archive` scratch copy).

## 1. Executive audit verdict: FAIL (conditional — not a drop-in fork replacement yet)

`GDevelop-Unlocked` does **not** replace the fork without regressions today:

1. **Failure Modes A–C are real and are now remediated** by new verbatim patches
   `09/10/11` (all dry-run clean, marker-verified on a scratch apply).
   BYOK routing, the fail-closed leak guard, and the 39 tool schemas are
   proven by 19 real integration tests (live `http` servers, real
   `fetch`/XHR wrappers, real patch application — no mocks of the code
   under test).
2. **But the verbatim-delta strategy carries upstream regressions.**
   The fork last synced upstream at `b9109cf` (#9124); upstream moved ~87
   commits to `8301cdc` (#9211), adding chat attachments (#9135/#9162) and
   the effects-store tab (#9136). Verbatim patches **delete that newer
   upstream code**, leaving **dangling imports in the patched tree**
   (proven by grep on the scratch apply — §3). Until 07/08/11 are rebased
   onto current upstream, shipping them trades the BYOK fix for broken
   attachments/preferences code. Patches 09/10 are purely additive and safe.
3. **Tier-1 unlocks are sound.** All 8 Tier-1 hunks apply cleanly, markers
   hold, and the launcher spoof path (preload + webRequest backstop) is
   proven at the transport level. Residual risk is timing-only (Mode D).

**To reach PASS:** rebase 07/08/11 to preserve upstream-new symbols
(`AiRequestAttachment`, `createAiAttachmentUploads/Downloads`,
`newEffectDialogDefaultTab`, `attachmentIds` plumbing) while keeping the
BYOK branches; add the rebase pin to CI; run the release-asis smoke +
Ollama BYOK jobs live (red at audit time for infra reasons, §5).

## 2. Vulnerability & regression matrix

| # | Severity | Finding | Root cause | Status |
|---|---|---|---|---|
| A | CRITICAL | BYOK uploads project JSON to GDevelop S3 + 401 crash (`PrepareAiUserContent.js`) | File never patched; hosted presigned-URL path unconditional | **FIXED** — `patches/09` (early return proven guard-before-upload in `ai-byok-flow`) |
| B | CRITICAL | Studio runtime dead code (`AskAiEditorContainer.js` never mounts hooks) | 12 Studio modules extracted, 0 wiring delivered | **FIXED (wiring)** — `patches/11`; multi-agent loop liveness still needs live-model proof (open follow-up) |
| C | HIGH | 0-credit lockout on local models (`AiRequestChat/Utils.js`) | `canPayForAiRequest` unchanged, no BYOK bypass | **FIXED** — `patches/10` (`canAffordAiRequest` + `getAvailableCredits`) |
| R1 | HIGH | Patch 07 deletes `AiRequestAttachment`, `createAiAttachmentUploads/Downloads`; **3 patched-tree importers dangle** (`AiAttachmentsUpload.js:3`, `AiMessageAttachments.js:7`, `UseAttachmentsForResources.js:5`) | Verbatim delta vs stale fork sync point | **OPEN** — needs rebase (see §3) |
| R2 | HIGH | Patch 08 deletes `newEffectDialogDefaultTab`; importer dangles (`ApplyProjectPreferences.js:29`) | Same stale-sync cause | **OPEN** — needs rebase |
| R3 | HIGH | Patch 11 strips `attachmentIds` plumbing (feature loss, container-internal) | Same stale-sync cause | **OPEN** — needs rebase |
| T2 | HIGH | Tier-2 runtime installed by nothing (07/09/11 imports dangle: `../AI/CustomAIClient`, `./Studio/*`; upstream has no `AI/` dir) | No overlay step in driver | **FIXED** — `syncTier2Files()` + byte-verify in `apply-patches.mjs` (both `--target` and `--asar` paths) |
| P1 | HIGH | Donor pin `b9109cf` is an *upstream* commit with 0 Tier-2 paths (418 commits before fork HEAD) → CI provenance red | Wrong hash in 3 files | **FIXED** — pinned `f7d450a1d9a` in `UPSTREAM_BASELINE.json`, `seam-tests.yml`, `RETIREMENT.md` |
| P2 | HIGH | Committed mock provider cannot boot (`require` under `"type":"module"`) → `byok-mock` CI job red | CJS verbatim copy into ESM repo | **FIXED** — ESM port, boots + serves contract (verified by curl); `MANIFEST` sha updated, `extract.test.mjs` exempts `dev-harness/` from byte-identity with rationale |
| D | MEDIUM | Smoke probe is fetch-only; app client rides XHR; prod `BrowserWindow` non-configurable so the preload path degrades to post-hydration `did-finish-load` seeding | Coverage gap + platform fact | **PARTIAL** — XHR path hardened (axios-style `onreadystatechange` + live passthrough integration tests); webRequest backstop (timing-independent) carries prod; live-browser XHR proof still open |
| S1 | MEDIUM | `isSmokeMode` `slice(2)` drops the flag when first in packaged argv → smoke silently never arms | argv shape assumption | **FIXED** — scan from index 1 + packaged-argv regression tests |
| S2 | MEDIUM | `unlock-shim` fail-closed guard exists only in tests; patches inline the logic instead of calling it | Delivery/test split | **OPEN (architecture)** — recommend importing the shim from patched call sites or documenting the duplication contract |
| G1 | LOW | Generators hard-code `/tmp/opencode`, ignore `TMPDIR` | Hardcoded scratch path | **FIXED** — both generators honor `TMPDIR`/`TMP`/`TEMP` |
| G2 | LOW | `generate-tier1-patches.mjs` resets `--out` on any unknown arg | parseArgs fallthrough | **FIXED** — unknown args throw loudly |
| G3 | LOW | `apply.test.mjs` passes `--no-verify`, never exercises the marker contract | Test scope | **OPEN** — verify path proven manually on scratch; recommend a `--verify` test run |
| G4 | LOW | Fake Electron uses `configurable:true`; prod is non-configurable (wrap-fail path untested) | Test double fidelity | **OPEN** — documented; fallback path covered by `ensureRendererSeed` tests |
| D1 | LOW | Release-asar docs prescribe `apply-patches --asar` (cannot match bundled code); working `inject-launcher --appdir` path undocumented in READMEs | Doc drift | **OPEN** — `patches/README.md` now notes Tier-2 overlay; launcher README rewrite recommended |
| D2 | LOW | `MANIFEST.json` stores an absolute local path, no donor commit; weekly drift check runs against fixed pins | Provenance hygiene | **OPEN** — recommend relative donor + commit field |

## 3. Regression proof (scratch apply, all 11 patches)

```
patch 07 minus-lines still present post-apply:
  Generation.js no longer exports AiRequestAttachment / createAiAttachmentUploads / createAiAttachmentDownloads
  importers left dangling:
    AiGeneration/AiAttachments/AiAttachmentsUpload.js:3
    AiGeneration/AiAttachments/AiMessageAttachments.js:7,42
    AiGeneration/AiAttachments/UseAttachmentsForResources.js:5,82
patch 08: PreferencesContext.js no longer defines newEffectDialogDefaultTab
  importer left dangling: Utils/ApplyProjectPreferences.js:29
patch 11: attachmentIds threading removed (320-line fork wiring applied otherwise clean)
patches 09/10: zero minus lines outside diff context — purely additive, safe.
```

## 4. Phase 1 gating maps (upstream → fork → unlocked coverage)

**Tier-1:** `Usage.js` (+50/−18: always-true + unlocked subscription/capabilities) → patch 01 ✓;
`SubscriptionChecker.js` (+5/−42: both checks `return true`) → patch 03 ✓;
`LoadingScreenEditor.js` (−56: logo/watermark + forced-duration gates deleted) → patch 04 ✓
(checker import kept for other settings, by design);
`LocalPreviewLauncher` (`%16` gate + network-preview checker deleted) + `DebuggerEditorContainer`
(checker no-op) → patch 05 ✓; `AuthenticatedUserContext` seed → patch 02 (local supplement) ✓;
`electron main.js`: fork delta is only IPC sanitization (NOT covered by patch 06 — gap noted,
patch 06 instead adds the preload hook + launcher sync) ◐.
4 placement IDs unchanged by fork: `preview-wifi`, `hot-reloading`, `debugger`, `gdevelop-branding`.

**Tier-2 (fork: 45 files under `AiGeneration/`, +11480/−306):**
`Generation.js` local routing → patch 07 ✓ (superset: also deletes attachment API — R1);
Preferences AI tab + storage → patch 08 ✓ (minus spec file; minus `newEffectDialogDefaultTab` — R2);
`PrepareAiUserContent` bypass → was gap, now patch 09 ✓;
`AiRequestChat/Utils.js` (`canAfford` + crash fix) → was gap, now patch 10 ✓;
`AskAiEditorContainer` wiring → was gap, now patch 11 ✓ (minus attachments — R3).
`packages/ai-studio` ships the engine + 12 Studio primitives only — no glue (by design now).

## 5. Integration test results (19 tests, all green, offline, real I/O)

- `tests/integration/network-spoof.test.mjs` (7): real `http` server; `shouldSpoofUrl`
  classification (GET-only, exact-path); preload fetch spoof + live passthrough;
  `webRequest` data-URL redirect bodies; XHR spoof via `onload`; **new**
  axios-style XHR via `onreadystatechange`, live-server XHR passthrough with
  body echo, POST-to-spoof-path delegation.
- `tests/integration/ai-byok-flow.test.mjs` (8): live mock-provider speaking
  OpenAI contract (`/v1/models`, non-stream + SSE); `selectBackend` routing;
  fail-closed `guardHostedCall`; **new** 39 `GDEVELOP_OPENAI_TOOLS` structural
  validation (39 unique names, object parameters, mock dispatch resolution),
  zero-egress routing proof (no `api.gdevelop.io` URL constructible under
  custom endpoint), patch-09 source-order proof (guard precedes first
  presigned-URL call in the реально patched file).
- `tests/integration/react-entitlements.test.mjs` (4, new): no React runtime
  in-repo (stated limit) — executed instead: real hydration payloads
  (999 projects, `gdevelop_startup`/`local-byok-user`) + real patches 04/05
  applied to pristine fixture copies (logo/watermark write-through, gate
  comments gone; 20 reloads vs removed `%16` gate; debugger mount sans checker).
- Full `npm test`: **96/96 pass, 0 fail** (was 77 pre-existing + 9 unreviewed
  integration + 10 added this session).
- CI was red at handoff (`seam-tests` provenance pin, `e2e` mock boot +
  infra); both root causes fixed in-tree. Live CI re-run is the owner's
  step (network/artifact jobs cannot run from here).

## 6. Upstream PR recommendations

Neutral interfaces worth upstreaming (no unlock politics, generally useful —
see `docs/upstream-ai-provider-rfc.md`):

1. **Custom AI endpoint interface** (`CustomAIClient` surface: base URL,
   API key, model, timeout, streaming, telemetry note): propose as an
   opt-in provider interface in `Generation.js` with the hosted path as
   default. Upstream keeps its billing; the interface only permits
   self-hosted models.
2. **`canAfford`-style credit-read hardening** (`getAvailableCredits`):
   partial `limits` responses currently throw on chat render — a pure
   robustness fix with no policy content.
3. **Attachment-agnostic generation hooks**: any rebase of 07/11 must keep
   working against upstream's attachment pipeline; propose the BYOK
   branches as narrowly-scoped early returns (the 09 pattern) so future
   upstream features compose instead of conflict.

Keep surgical permanently: subscription/capability stubbing, checker
no-ops, logo/watermark gate removal, preview/debugger gate removal, the
Electron spoof hook. Those contradict upstream's business model and will
never merge — they are the patch stack's reason to exist.

## Appendix — files changed by this audit session

- `patches/09-prepare-ai-content.patch`, `patches/10-ai-chat-affordance.patch`,
  `patches/11-studio-runtime-mount.patch` (new, generator-emitted) + `patches/README.md`
- `scripts/generate-tier2-patches.mjs` (09–11 entries, `TMPDIR` scratch),
  `scripts/generate-tier1-patches.mjs` (`TMPDIR` scratch, strict arg parsing),
  `scripts/apply-patches.mjs` (09–11 markers, Tier-2 overlay + verify, both install paths)
- `launcher/heretek-hook.cjs` (`isSmokeMode` packaged-argv fix)
- `packages/ai-studio/dev-harness/mock-ai-provider.js` (ESM port) + `MANIFEST.json` (re-pinned sha)
- `tests/integration/` (10 new tests + `react-entitlements.test.mjs`),
  `tests/tier2/tier2-patches.test.mjs` (09–11 determinism pin),
  `tests/tier2/extract.test.mjs` (harness port exemption),
  `tests/patches/apply.test.mjs` (09–11 target files),
  `tests/launcher/smoke.test.cjs` (packaged-argv regression tests)
- Provenance pins: `UPSTREAM_BASELINE.json`, `.github/workflows/seam-tests.yml`, `RETIREMENT.md`
- `docs/upstream-ai-provider-rfc.md` (new)

## 7. Rebase addendum (2026-10-11, same session): R1–R3 FIXED, verdict flips

Patches 07/08/11 were rebased as curated forward-ports (procedure +
conflict resolutions in `patches/REBASE.md`): three-way merge
(`git merge-file`, base = upstream `b9109cf`, current = upstream
`8301cdc`, other = fork `f7d450a`). Four of five files merged with zero
conflicts; `AskAiEditorContainer.js` had 7, all resolved keep-both
(upstream attachment/in-game-editor constructs + fork BYOK session,
error-state, and studio-mount logic).

Post-rebase proof (fresh scratch apply, fixtures untouched):

- New 07/08/11 contain **zero minus-lines** touching `AiRequestAttachment`,
  `createAiAttachment*`, `newEffectDialogDefaultTab`, `attachmentIds`;
  BYOK plus-lines fully retained (25/46/18 markers).
- All **47 cross-tree `Generation.js` imports resolve** to patched-file
  exports (3 apparent misses were `X as Y` alias syntax; base names
  exported). `newEffectDialogDefaultTab` defined where
  `ApplyProjectPreferences.js` reads it. Zero dangling importers.
- Full suite: **97/97 green** (new anti-revert test pins the regression
  class; byte-determinism retained for additive 09/10 only).

Matrix updates: R1, R2, R3 → **FIXED (rebased)**. T2, P1, P2, A, B
(wiring), C, S1, G1, G2 remain as stated.

**Revised verdict: CONDITIONAL PASS.** The tree now carries every BYOK
fix with no known dangling references and no upstream-feature deletions.
Remaining conditions before calling it a full replacement: (1) live CI
re-run (`seam-tests`, `e2e` smoke, `byok-mock`) — root causes fixed
in-tree but never executed remotely; (2) live-model proof of the studio
loop (B) and live-browser XHR proof (D), both still open follow-ups;
(3) rebase again whenever upstream touches the five merged files
(`patches/REBASE.md` has the repeat procedure).
