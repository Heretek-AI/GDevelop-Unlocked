# HANDOFF + ADVERSARIAL AUDIT PROMPT — GDevelop-Unlocked

Run `claude` inside `/home/john/Projects/GDevelop-Unlocked` with this file as the instruction context.
Part A is the state left by the previous review session (2026-10-10). Part B is the adversarial audit mission. Read Part A first: it corrects or sharpens several assumptions in Part B.

---

# PART A — Handoff from the previous session

## A1. What the previous session was

A findings-only, 5-phase review (test authenticity, integration handling, plugin functionality, cross-cutting consistency) with one subagent per phase. It did **not** finish and produced **no synthesized report**. Nothing was fixed; the repo, `review/` and git state were not modified by it.

## A2. Repo state at handoff

- Reviewed commit: `13ddde2` on `feature/ci-e2e` (one commit ahead of `develop`/`main` @ `30da3f8`). `inject-launcher.mjs`, smoke mode, `e2e.yml` exist only on this branch.
- Working tree is **dirty from a different session** (21:27–21:29): `M package.json` (adds `tests/integration/*.test.mjs` to `npm test` + a `test:integration` script), untracked `tests/integration/ai-byok-flow.test.mjs`, `tests/integration/network-spoof.test.mjs`, `CLAUDE_CODE_ADVERSARIAL_PROMPT.md`. **None of these were read or reviewed.** Read them before building on them — Part B Phase 2 asks for files with these exact names.
- Fixtures: `review/GDevelop` @ `8301cdcaa48b496f48a28a6e3a56fa833eaeddff` (`v5.6.283-48`), `review/GDevelop-Heretek` @ `f7d450a1d9aa068e33c0a0c9a3f9caaee3701f2f`. Both gitignored, ~2 GB each.
- `npm test` at `13ddde2`: 77/77 green locally on Node 26 and on Node 20.20.2.
- CI is **red**: `seam-tests` fails on the `main` push and on the PR; `e2e` fails on the PR (`gh run list --repo Heretek-AI/GDevelop-Unlocked`).
- Tools available on this machine: `patch`, `Xvfb`/`xvfb-run`, `ollama`, authenticated `gh`, network. A copy of the v5.6.283 Linux release zip and a flat asar extraction are in `/tmp/opencode` (another session's directory — treat as read-only, copy out).

## A3. Findings confirmed by the lead (re-checked against code/CI, not just reported)

1. **Donor pin is the wrong commit.** `b9109cfbaaaf19c31b5af4d315317fb67d8903c3` (in `.github/workflows/seam-tests.yml:27`, `UPSTREAM_BASELINE.json:3`, `RETIREMENT.md:28`) contains 0 Tier-2 paths; the real donor is fork HEAD `f7d450a` (31 paths, 418 commits later). This is why `tests/tier2/extract.test.mjs` and `tests/tier2/tier2-patches.test.mjs` fail in CI while passing locally.
2. **Committed mock provider cannot start from this repo.** `package.json` has `"type": "module"`; `packages/ai-studio/dev-harness/mock-ai-provider.js:29` uses `require` → `ReferenceError: require is not defined in ES module scope`. This is why the `byok-mock` job fails. It matters for Part B Phase 2 item 2: the mock must be run from outside the package scope (or via an inline server) unless this is fixed.
3. **`packages/unlock-shim/generation-shim.mjs` is not wired into anything shipped.** Zero references to `selectBackend` / `guardHostedCall` / `assertNoLocalIdsLeak` / `unlock-shim` in all eight patches; at `13ddde2` its only importer is `tests/tier2/shim.test.mjs`. `packages/unlock-shim/README.md:13-16` claims patch 07 calls it. So the "fail-closed leak guard" exists only in a test, not in the delivery path.
4. **Smoke check probes `fetch` only** (`launcher/heretek-hook.cjs:331-350`), while `launcher/README.md:18` says the app's client rides on XHR.
5. **Fake Electron is more permissive than production.** `tests/launcher/hook.test.cjs:44-48` defines `BrowserWindow` with `configurable: true`; the production export is non-configurable.
6. **`isSmokeMode` drops the first user argument** (`launcher/heretek-hook.cjs:324-326`, `slice(2)`); `e2e.yml` only works because the flag is passed last.
7. **Generators hard-code `/tmp/opencode`** (`scripts/generate-tier1-patches.mjs:450-472`, `scripts/generate-tier2-patches.mjs:78-80`), ignoring `TMPDIR`. `tests/tier2/tier2-patches.test.mjs` invokes the tier-2 generator, so plain `npm test` writes there; the tier-2 generator never creates the directory (cold-runner behaviour unchecked).
8. **`generate-tier1-patches.mjs:44-55`**: any unrecognised argument resets `--out` to `<repo>/patches`.
9. **`apply.test.mjs:50,109` pass `--no-verify`**, so the driver's `MARKERS`/`verifyTarget` contract is never exercised by a test.
10. **Correction to an earlier assumption:** `apply-patches.mjs:166-171` passes `shell: true`, so `--check` works on Node 20 (ran 29 seam tests, exit 0). CI's `node-version: 20` vs `engines >=22` is a policy mismatch only — nothing needs ≥22.

## A4. Reported by the consistency reviewer, NOT independently re-checked

Treat as strong leads; verify before relying on them.

- **Patches 07/08 are not pure fork deltas.** They are a diff of baseline `8301cdc` against a fork synced only to `b9109cf` (71 upstream commits behind), so they also revert upstream changes in those files — reportedly deleting exports still imported elsewhere at baseline (`createAiAttachmentUploads`/`createAiAttachmentDownloads`, the `newEffectDialogDefaultTab` API). Rests on a static import scan, not a build.
- **Tier-2 is not installed by anything.** After a green `apply-patches.mjs --target`, imports of `'../../AI/CustomAIClient'` from `Generation.js`, `PreferencesDialog.js`, `PreferencesProvider.js` are unresolved — no script places `packages/ai-studio` into the tree. Even when overlaid, 11 of 12 Studio modules have no importer; the fork's wiring (≈17 files, +2650/−307) is not delivered. **This is the same ground as Part B Failure Modes A–C**, which name three of those missing files specifically.
- **Release-asar docs point at a command that cannot work.** `patches/README.md:3-5`, `launcher/README.md:36-38,47-49` and `UPDATER_PIN_MESSAGE` (`launcher/heretek-hook.cjs:42-47`, pinned by `tests/launcher/hook.test.cjs:254`) say `apply-patches.mjs --asar`; a real asar is flat and bundled, and `inject-launcher.mjs` (the path that works) is in no README.
- **XHR path reportedly fails on the code path production uses** — reproduced on a Node test double only, not in real Chromium. Relevant to Part B Failure Mode D; needs a real-browser check.
- **Weekly "drift check" runs against fixed pins**, so it cannot detect new upstream drift.
- **`RETIREMENT.md:10-12,52-54`** precondition and counts are stale/contradictory (now 74 pass / 1 fail / 2 cancelled with an empty `FORK_DIR`; both tier-2 provenance tests need the donor).
- **Seam suite does not cover** the two usage endpoints, the validators, or the targets of patches 02/07/08.
- Determinism: committed patches 01–08 and the extraction equal fresh generator output; only tier-2 is pinned by a test. `MANIFEST.json:2` stores an absolute local path and no donor commit.
- Cosmetic list (stale wording, dead code, redundant tests, userscript README vs behaviour) — re-derive if needed.

## A5. Integration reviewer — partial results only

- Full `--target` apply on a pristine scratch upstream: all 8 applied, launcher files synced, markers verified, exit 0.
- Re-apply refused at patch 01's dry-run, exit 1 (tree-unchanged not confirmed by hash).
- Missing fixture fails loudly ("Missing upstream file … Set UPSTREAM_DIR or refresh review/GDevelop").
- Production Electron is 32.3.3 (`review/GDevelop/newIDE/electron-app/package.json`).

## A6. Not done

- **Test-authenticity phase:** work completed (all 16 test files read, mutation spot-checks run in scratch) but the report never reached the lead. Raw logs may still exist under `/tmp/claude-1000/-home-john-Projects-GDevelop-Unlocked/07a31264-f21d-4519-9dbf-fe97194ba181/scratchpad/phase1/logs/` (`mut-results.jsonl`, one record per mutation). That path is session-scoped and may be gone; the lead never read it.
- **Integration phase remainder:** drifted-hunk / half-applied-tree behaviour, fake-vs-production Electron comparison beyond A3.5, `inject-launcher.mjs` edge cases, smoke exit-code logic vs how `e2e.yml` consumes it, what `byok-mock`/`byok-ollama` actually prove (reported: they exercise no client code from this repo).
- **Functionality phase:** stopped before reporting. No Tier-1 residual diff against the donor, no payload-vs-validator check, no live release → inject → repack → Xvfb smoke run, no negative control on the smoke verdict.

## A7. Process notes for the next session

- **Several write-ups were cut off by a safety classifier** in the previous session (three subagent reports and two lead responses), mostly while writing detailed tables. When that happens, do not retry or reword the blocked content — record the gap plainly and move on to the next item. Expect this again and plan deliverables so a single cut-off does not lose everything: write findings to disk incrementally as short entries.
- **Have subagents write their findings to a file as they go**, not only in a final message — the previous session lost two complete reports that existed only in final messages.
- **Do not patch `review/GDevelop` in place.** Part B §4 Phase 3 says `apply-patches.mjs --target review/GDevelop`; that mutates the pinned fixture every seam/patch test depends on, and patches are non-idempotent by design. Apply to a scratch copy instead, e.g. `git -C review/GDevelop archive HEAD newIDE/app/src newIDE/electron-app | tar -x -C <scratch>`.
- **Part B changes the mode from findings-only to remediation** (new tests under `tests/integration/`, new patches 09–11, edits to `scripts/apply-patches.mjs`). The previous brief's non-goals ("no fixes, do not touch `tests/`") no longer apply if Part B is followed — that is the owner's decision; it is flagged here so it is deliberate.
- New patches must come from the generators, not hand edits (`tests/tier2/tier2-patches.test.mjs` asserts committed patches equal fresh generator output). Fix the donor pin (A3.1) first or CI stays red regardless.
- Part B §2 rule 1 says `tests/patches/apply.test.mjs` "only tests dry-run patch string replacements". The previous session observed that it spawns the real driver with `--target` on a temp copy (with `--no-verify`); check the file rather than assuming either description.
- Part B Failure Modes A–C were **not individually verified** in the previous session; A4's "wiring not delivered" finding is consistent with them but is not proof of each.

---

# PART B — Adversarial audit mission

# MISSION: Adversarial Audit, Gap Analysis, & End-to-End Verification of GDevelop-Unlocked

## 1. Context & Repository Architecture
You are operating in `/home/john/Projects/GDevelop-Unlocked`.
You have three codebases available on disk:
1. **Pristine Upstream GDevelop**: `/home/john/Projects/GDevelop-Unlocked/review/GDevelop`
   - Upstream GitHub: https://github.com/4ian/GDevelop
   - The unmodified official game engine (C++ core, Wasm `GDevelop.js`, Pixi/Three runtime `GDJS`, and React/Electron `newIDE`).
2. **Donor Fork (GDevelop-Heretek)**: `/home/john/Projects/GDevelop-Unlocked/review/GDevelop-Heretek`
   - Fork GitHub: https://github.com/Heretek-AI/GDevelop-Heretek
   - A 205-file diverging fork that unlocked premium features and introduced a Bring-Your-Own-Key (BYOK) local AI studio.
3. **Surgical Conversion Project (GDevelop-Unlocked)**: `/home/john/Projects/GDevelop-Unlocked`
   - Goal: Replace the 205-file fork with a surgical plugin architecture: 8 Tier-1 patches in `patches/`, runtime Electron hooks in `launcher/`, and an extracted `packages/ai-studio` package.

---

## 2. Operating Mindset: Zero-Trust Adversarial Auditor
You must assume a **strict adversarial posture**:
> **Core Hypothesis**: The unlocking mechanisms and AI features imported from `review/GDevelop-Heretek` into `GDevelop-Unlocked` are **fundamentally broken, leaky, incomplete, or phantom-passing**.

### Strict Operational Rules
1. **Distrust Existing Green Tests**: The 77 tests in `npm test` are largely unit-level assertions against mocks (e.g. `tests/launcher/smoke.test.cjs` uses a fake Electron object `makeFakeElectron`; `tests/patches/apply.test.mjs` only tests dry-run patch string replacements in a temp directory). A passing test does **not** prove functional unlocking in the real editor.
2. **Demand Execution Proof**: You must prove every claim through real network requests, real component lifecycle execution, real HTTP mock backends, and typecheck/compilation checks against upstream.
3. **Hunt for Dropped Fork Glue**: The fork touched 205 files. `GDevelop-Unlocked` attempted to condense this into 8 patches. Any file modified in the fork that was omitted from `patches/` or `launcher/` is a prime suspect for broken functionality or security/data leaks.

---

## 3. Confirmed Vulnerabilities & Failure Points to Investigate

You must specifically investigate and verify the following known failure modes:

### Failure Mode A: The `PrepareAiUserContent.js` Cloud Leak & 401 Crash
- **Location**: `review/GDevelop/newIDE/app/src/AiGeneration/PrepareAiUserContent.js` (~line 112)
- **The Bug**: In pristine upstream, before any AI request is created, `prepareAiUserContent` calls `createAiUserContentPresignedUrls` to upload the project JSON to S3 via `api.gdevelop.io`.
- **The Fork Fix**: Heretek intercepted this with `if (isCustomEndpointEnabled() || userId.startsWith('local-')) return { gameProjectJson: simplifiedProjectJson, ... };`.
- **The Defect in Unlocked**: `GDevelop-Unlocked` **never patched `PrepareAiUserContent.js`**. As a result, running BYOK against pristine upstream attempts to upload local project data to GDevelop's cloud, leaking private game data, and immediately crashes with HTTP 401/403 for `local-byok-user`.

### Failure Mode B: Dead Studio Runtime in `AskAiEditorContainer.js`
- **Location**: `review/GDevelop/newIDE/app/src/AiGeneration/AskAiEditorContainer.js`
- **The Bug**: `packages/ai-studio` extracted 12 files from `AiGeneration/Studio/` (`UseStudioRuntime.js`, `UseStudioNudge.js`, `Roles.js`, etc.). However, `AskAiEditorContainer.js` was **never patched** in `GDevelop-Unlocked` to mount `useStudioRuntime()` or `useStudioNudge()`.
- **The Defect in Unlocked**: Multi-agent studio loops, subagent spawning, and tool orchestration are completely disconnected dead code.

### Failure Mode C: 0-Credit Lockout in `AiRequestChat/Utils.js`
- **Location**: `review/GDevelop/newIDE/app/src/AiGeneration/AiRequestChat/Utils.js`
- **The Bug**: Upstream `canPayForAiRequest` disables the send button if the user does not have enough cloud credits.
- **The Fork Fix**: Heretek replaced this with `canAffordAiRequest`, returning `true` whenever `isCustomEndpointEnabled` is active.
- **The Defect in Unlocked**: `GDevelop-Unlocked` omitted this patch. Users with 0 cloud credits cannot submit prompts to their own local models.

### Failure Mode D: Production Asar & Webpack Hydration Race
- **Location**: `launcher/heretek-hook.cjs` and `launcher/preload-unlock.cjs`
- **The Bug**: In production Electron, `BrowserWindow` is non-configurable, so constructor wrapping can fail. The fallback relies on `did-finish-load` `executeJavaScript`. If React hydrates or Axios initializes before `did-finish-load`, the spoofing wrappers attach too late, exposing upstream paywalls.

---

## 4. Phase-by-Phase Adversarial Tasks

### Phase 1: Upstream Gating & Entitlement Mapping
Audit `review/GDevelop` and catalog all gating points against `review/GDevelop-Heretek`:
1. **Tier-1 Gating Map**:
   - `Usage.js`: `hasValidSubscriptionPlan`, capabilities, quotas, credits.
   - `SubscriptionChecker.js`: All 4 placement IDs (`'Disable GDevelop splash at startup'`, `'Debugger'`, `'Hot reloading'`, `'Preview over wifi'`).
   - `LoadingScreenEditor.js`: Logo checkbox, watermark checkbox, min duration slider.
   - `LocalPreviewLauncher/index.js`: Hot reload modulo (`% 16`) check, network preview check.
   - `DebuggerEditorContainer.js`: Debugger & profiler access.
2. **Tier-2 AI Gating Map**:
   - `Generation.js`: Request creation, message streaming, tool calling.
   - `PrepareAiUserContent.js`: Presigned URL creation & project upload.
   - `AskAiEditorContainer.js` & `AiRequestChat/`: Credit checks, subagent hooks, stop/retry controls.
   - `PreferencesDialog.js` & `PreferencesContext.js`: AI tab and persistent storage.

### Phase 2: Build Real Integration & E2E Test Suites
Do not rely on mock objects. Build real, executable integration tests under `tests/integration/`:

1. **`tests/integration/network-spoof.test.mjs`**:
   - Spin up a real local HTTP server using Node's `http` module.
   - Exercise real HTTP requests through the preload and hook wrappers (`fetch` and `XMLHttpRequest`).
   - Assert:
     - `GET /limits` and `GET /subscription-v2` return the unlocked payloads.
     - All other URLs, mutation methods (POST, PUT, DELETE), and external domains pass through untouched.
     - Axios instances correctly receive spoofed responses without crashing.

2. **`tests/integration/ai-byok-flow.test.mjs`**:
   - Spin up the committed mock AI server: `packages/ai-studio/dev-harness/mock-ai-provider.js` (or inline HTTP server).
   - Test the complete generation flow from `PrepareAiUserContent` through `Generation.js` to `CustomAIClient`.
   - Assert:
     - Zero network requests are sent to `api.gdevelop.io` when custom endpoint is active.
     - `local-ai-*` request IDs route exclusively to the local provider.
     - Fail-closed leak guard (`assertNoLocalIdsLeak`) throws immediately if a local ID is sent to a hosted URL.
     - The 39 `GDEVELOP_OPENAI_TOOLS` schemas parse cleanly and can be dispatched without undefined function errors.

3. **`tests/integration/react-entitlements.test.mjs`**:
   - Mount the React components (`LoadingScreenEditor`, `LocalPreviewLauncher`, `DebuggerEditorContainer`) in a JSDOM environment.
   - Assert:
     - Watermark and startup logo can be toggled without mounting `SubscriptionChecker` dialogs.
     - 20 consecutive hot reloads do not mount paywall dialogs.
     - Debugger container mounts without opening the subscription prompt.

### Phase 3: Author Missing Glue Patches (Remediation)
Generate and apply the missing surgical patches to resolve the confirmed bugs:
1. `patches/09-prepare-ai-content.patch`: Fix `PrepareAiUserContent.js` to prevent cloud upload leaks and 401 crashes in BYOK mode.
2. `patches/10-ai-chat-affordance.patch`: Fix `AiRequestChat/Utils.js` to allow 0-credit prompt submissions when custom endpoint is enabled.
3. `patches/11-studio-runtime-mount.patch`: Patch `AskAiEditorContainer.js` to wire in `useStudioRuntime` and `useStudioNudge`.

Update `scripts/apply-patches.mjs` markers and verify that `node scripts/apply-patches.mjs --target review/GDevelop --no-verify` applies cleanly.

---

## 5. Required Deliverables
When your execution completes, generate a comprehensive markdown report in `AUDIT_REPORT.md` containing:
1. **Executive Audit Verdict**: Detailed PASS/FAIL assessment of whether `GDevelop-Unlocked` replaces the fork without regressions.
2. **Vulnerability & Regression Matrix**: Table of every discovered bug classified by severity (CRITICAL, HIGH, MEDIUM, LOW), root cause, and remediation status.
3. **Integration Test Suite Results**: Full test run logs demonstrating that all real network and BYOK flows pass.
4. **Upstream PR Recommendations**: Guidance on upstreaming neutral AI interfaces (e.g. `docs/upstream-ai-provider-rfc.md`) vs maintaining surgical patches.
