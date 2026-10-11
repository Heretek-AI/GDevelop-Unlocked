# CLAUDE CODE ADVERSARIAL PROMPT: ZERO-TRUST AUDIT & E2E VERIFICATION ENGINE

> **How to Run**: Copy and paste the prompt below into **Claude Code** (or run `claude` inside `/home/john/Projects/GDevelop-Unlocked` with this file as the instruction context).

***

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
