# CLAUDE CODE RESEARCH PROMPT: GDEVELOP PLUGIN AUDIT & HERETEK SURGICAL CONVERSION

> **How to Use**: Copy and paste the entire prompt below directly into **Claude Code** (or run `claude` inside the repo root and pass this file).

***

# TASK: Comprehensive Technical Audit & Surgical Conversion Feasibility Study (GDevelop vs. GDevelop-Heretek)

## Context & Repository Locations
You are tasked with conducting an exhaustive technical audit of two local repositories:
1. **Upstream GDevelop**: `review/GDevelop`
   - Upstream GitHub: https://github.com/4ian/GDevelop
   - The official open-source 2D/3D no-code game engine (Core C++, Emscripten/Wasm `GDevelop.js`, Pixi/Three runtime `GDJS`, and React/Electron `newIDE`).
2. **GDevelop-Heretek (BYOK Edition)**: `review/GDevelop-Heretek`
   - Fork GitHub: https://github.com/Heretek-AI/GDevelop-Heretek
   - A fork maintaining daily syncs with upstream that unlocks premium subscription features and adds a Bring-Your-Own-Key (BYOK) local AI client and multi-agent game studio.
   - Reference documentation in fork: `AGENTS.md`, `fork-divergence.json`, `MAINTENANCE.md`, and README feature comparison.

---

## Core Mission
Analyze whether maintaining an upstream-diverging 205-file fork can be replaced by a **surgical conversion** (e.g., an external plugin, Electron runtime injector, AST/codemod patcher, or local proxy), enabling users to run vanilla upstream GDevelop while unlocking all features listed in the Heretek Feature Comparison table without maintaining a massive fork.

---

## Phase 1: Upstream Architecture & Plugin Capability Audit

Investigate `review/GDevelop`:
1. **Disambiguate Engine Extensions vs. IDE Plugins:**
   - Examine `review/GDevelop/Extensions/` and `review/GDevelop/GDJS/Runtime/`.
   - Confirm whether "Extensions" in GDevelop strictly apply to the **game engine runtime** (`gdjs.RuntimeBehavior`, `gdjs.RuntimeObject`, actions, conditions, and Pixi/Three renderers) or if any extension points exist for the editor itself.
2. **Audit `newIDE/app` (The React/Flow Editor):**
   - Search for any dynamic module loading, plugin registries, extension hooks, or lifecycle events in `newIDE/app/src/`.
   - Inspect `newIDE/app/src/index.js`, `LocalApp.js`, `BrowserApp.js`, and `MainFrame/index.js`.
   - Does `newIDE` have any native plugin or add-on architecture for third-party UI components, custom tabs, or service overrides?
3. **Audit `newIDE/electron-app` (The Desktop Shell):**
   - Inspect `newIDE/electron-app/app/main.js` and `Utils/UrlLoader.js`.
   - Analyze Electron security and configuration settings:
     - Notice `webPreferences.nodeIntegration`, `contextIsolation`, and `webSecurity`.
     - How is the renderer page loaded (`file://`, `gdide://`, or dev server)?
     - Are preload scripts utilized or can arbitrary preload scripts be attached?
     - What IPC channels exist between renderer and main?

---

## Phase 2: Feature-by-Feature Entitlement Dissection

Compare `review/GDevelop` with `review/GDevelop-Heretek`.
Audit the exact implementation of every feature listed in the Heretek Feature Comparison table:

### 1. Watermark, Startup Logo, & Splash Duration Clamps
- Inspect `newIDE/app/src/ProjectManager/LoadingScreenEditor.js`.
- Contrast how upstream gates:
  - `loadingScreen.isGDevelopLogoShownDuringLoadingScreen()`
  - `watermark.isGDevelopWatermarkShown()`
  - `loadingScreen.setMinDuration()` / `forcedLogo.minDuration`
- Identify the exact boolean checks that guard these options.

### 2. Live Preview (Hot Reloading) & Wi-Fi / LAN Preview
- Inspect `newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js`.
- Analyze:
  - The paywall popup triggered every 16 hot reloads (`this.state.hotReloadsCount % 16 === 0`).
  - Network preview gating (`_checkSubscriptionForNetworkPreview`).
- How does Heretek neutralize these checks?

### 3. In-Game Debugger & Profiler
- Inspect `newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js`.
- Analyze `_checkUserHasSubscription()` and how upstream restricts the debugger tab.

### 4. Entitlements & Subscription Architecture
- Inspect `newIDE/app/src/Utils/GDevelopServices/Usage.js`:
  - Analyze `hasValidSubscriptionPlan()`, `Subscription` type, and `Capabilities` object.
- Inspect `newIDE/app/src/Profile/AuthenticatedUserContext.js` and `AuthenticatedUserProvider.js`:
  - Analyze `UNLOCKED_HERETEK_SUBSCRIPTION` and `UNLOCKED_HERETEK_CAPABILITIES`.
  - Contrast how upstream populates user capabilities from backend APIs vs. how Heretek seeds default unlocked capabilities.

### 5. AI Assistant & Game Creator (BYOK & Local LLMs)
- Inspect `newIDE/app/src/AI/CustomAIClient.js` (~5,870 lines) in Heretek:
  - Analyze the OpenAI-compatible client, tool schemas (`GDEVELOP_OPENAI_TOOLS`), SSE streaming, and local storage keys (`gd-custom-ai-config`, `gd-custom-ai-requests`).
- Inspect `newIDE/app/src/Utils/GDevelopServices/Generation.js`:
  - How does Heretek hook into `Generation.js` (`isCustomEndpointEnabled()`, `customCreateAiRequest()`)?
- Inspect `newIDE/app/src/MainFrame/Preferences/PreferencesDialog.js`:
  - How is the `'ai'` configuration tab injected into the preferences modal?

### 6. Multi-Agent AI Studio (`AiGeneration/Studio/`)
- Inspect `newIDE/app/src/AiGeneration/Studio/` in Heretek (~15 files):
  - Review `Roles.js`, `PlanStore.js`, `LoopGuard.js`, `SpawnSubAgents.js`, `FinalizeSubAgents.js`, `UseStudioRuntime.js`.
  - Determine how deeply these files couple with the rest of the editor vs. operating as modular self-contained logic.

### 7. Local HTML5 & Desktop Exports
- Audit export limits in `Usage.js` and `ExportAndShare/` to determine if any local build operations are restricted in upstream.

---

## Phase 3: Architectural Feasibility of Surgical Conversion

Evaluate the feasibility, pros, cons, and implementation complexity of converting Heretek's features into an external solution across these 5 technical vectors:

### Vector A: Electron Preload / Runtime Hook Injection (The "BetterDiscord / Spicetify" Model)
- **Mechanics**:
  - Because upstream Electron sets `nodeIntegration: true` and `contextIsolation: false`, any code running in the renderer has unrestricted access to the Node runtime, DOM, and React component tree.
  - Can an external launcher inject a custom script via:
    1. An Electron preload argument / CLI flag (`--require <script.js>`).
    2. Modifying `newIDE/electron-app/app/main.js` (or `app.asar`) with a single-line hook loader.
    3. A standalone wrapper launcher executing Electron with a custom bootstrap script.
- **Feasibility Questions**:
  - Can React Context (`AuthenticatedUserContext`, `PreferencesContext`) be intercepted or patched at window load before components render?
  - Can `Usage.hasValidSubscriptionPlan` or Axios interceptors be monkey-patched at runtime?
  - How could the BYOK AI settings tab and custom AI client be injected into React DOM/Context from an external script?

### Vector B: Local Reverse Proxy / Network Mocking Layer
- **Mechanics**:
  - GDevelop's subscription checks and AI generation requests communicate with `api.gdevelop.io` and Firebase.
  - Can a lightweight local HTTP proxy (or Electron `session.webRequest` / protocol interceptor) intercept:
    1. Requests to `/usage` or `/user` and return simulated Gold/Enterprise subscription payloads.
    2. Requests to `/ai-request` and translate GDevelop AI format into OpenAI / Ollama format directly on the network level?
- **Feasibility Questions**:
  - Does spoofing network responses completely satisfy the client-side UI checks (e.g. `LoadingScreenEditor`, `LocalPreviewLauncher`), or do those checks evaluate local React state regardless of network responses?
  - Can the entire multi-agent studio loop function via network proxy alone, or does it require deep editor DOM/state integration?

### Vector C: AST / Codemod / Patcher Engine (The "patch-package" Model)
- **Mechanics**:
  - Instead of maintaining a full git repository with daily upstream merge commits, maintain a directory of atomic diff patches (or Babel / `jscodeshift` AST transforms).
  - A CLI tool (`gdevelop-unlocked patch`) unpacks upstream `app.asar` (or runs post-install in `newIDE/`), applies the surgical transforms, and repacks.
- **Feasibility Questions**:
  - How fragile are the AST patches against upstream code updates?
  - Contrast the maintenance burden of updating AST transforms vs. resolving git merge conflicts across 205 files in `fork-divergence.json`.

### Vector D: Browser Userscript / Extension (Web Editor Support)
- **Mechanics**:
  - For `editor.gdevelop.io`, analyze whether a Userscript (Tampermonkey/Violentmonkey) or Chrome extension can hook into the Webpack chunk registry (`window.webpackChunk...`), patch React state, intercept `fetch`/`XMLHttpRequest`, and inject BYOK AI.
- **Feasibility Questions**:
  - What are the limitations in the web version compared to Electron (e.g., local network preview, Ollama CORS)?

### Vector E: Upstream Plugin Architecture PR
- **Mechanics**:
  - Assess whether an RFC / PR proposing a clean IDE Plugin API to 4ian/GDevelop would be technically viable and whether upstream's commercial model makes it unlikely to be accepted.

---

## Phase 4: Separation of Concerns (Two-Tier Architecture)

Notice that Heretek's changes divide sharply into two categories:
1. **Tier 1: Entitlement Unlocks (<50 lines across ~5 files):**
   - Removing paywalls, logos, watermarks, splash delays, hot-reload restrictions.
2. **Tier 2: BYOK AI & Multi-Agent Studio (~8,000+ lines):**
   - Full LLM orchestration, local endpoint support, multi-agent task runner.

Evaluate:
- Should Tier 1 and Tier 2 be decoupled into separate modules (e.g., a lightweight 100-line "Entitlement Unlocker" and a modular "AI Studio Addon")?
- How does decoupling affect maintenance, legal risk, and user flexibility?

---

## Deliverables Required in Your Report

Provide a clear, detailed, and technically rigorous report containing:

1. **Executive Summary**: Core verdict on whether a plugin/injector can replace the fork.
2. **Upstream Architecture Audit**: Official findings on GDevelop's extension points (runtime vs. IDE).
3. **Entitlement Mechanism Map**: Complete table mapping each feature to:
   - Upstream file path and line numbers
   - Gating logic (how upstream locks it)
   - Heretek unlock logic (how Heretek bypassed it)
   - Surgical injection vector (how to bypass it without source modification)
4. **Injection Vector Comparison Matrix**:
   - Compare Vector A (Electron Preload Hook), Vector B (Network Proxy), Vector C (AST/Patcher), and Vector D (Userscript) on:
     - Feasibility (High/Med/Low)
     - Upstream update resilience (fragility)
     - Implementation complexity
     - Support for Desktop vs. Web
     - Support for Tier 1 (Unlocks) vs. Tier 2 (BYOK AI)
5. **Recommended Architecture & Design Blueprint**:
   - Detailed specification of the recommended approach.
   - Proposed file structure for a standalone `gdevelop-unlocked` / `gdevelop-plugin` project.
   - Exact code snippets demonstrating:
     - How to hook Electron window creation or preload.
     - How to patch `hasValidSubscriptionPlan` and `AuthenticatedUserContext`.
     - How to mount the BYOK AI settings UI and redirect generation calls.
6. **Actionable Implementation Roadmap**: Step-by-step phases to build, test, and transition away from the fork.
