# MASTER ORCHESTRATION PROMPT: GDEVELOP-UNLOCKED & OPENCODE SWARM (DEPTH 3)
<!--
CONTEXT (why this exists):
Transform GDevelop-Unlocked into a fully verified, self-healing, OpenCode v2-integrated
engine environment:
1. Remediate all open AI-agent failure modes observed in live runs (#21 no-project dead end,
   #22 suspended UI terminal state & resume, #23 storm guard tree-suspension cascade,
   #24 dead/uncallable tools in manifest).
2. Equip the patched client with a comprehensive, low-overhead debug logging subsystem
   (--heretek-debug-log / HERETEK_DEBUG_LOG) that captures main process events, renderer errors,
   webRequest traces, and structured AI Studio turn telemetry into disk logs (debug.log) for
   unattended automated agent testing.
3. Build the complete OpenCode v2 integration suite (#16 Control Shim, #17 OpenCode v2 Plugin,
   #18 OpenAI-compatible Provider Bridge, #19 E2E verification over real I/O).
4. Resolve all open governance, hardening, and release tail issues (#26 LICENSE, #10 Win/Mac runners,
   #11 release checklist, #12 layer-3 proofs, #13 upstream rebase discipline, #14 SonarCloud triage,
   #6-#8 decommissioning and diplomacy tracking).

OWNER DECISIONS (fixed):
  (a) STRICT OFFLINE REAL I/O: All tests run bare `node:test` + built-ins with ZERO npm dependencies
      in-repo. No mocks of the code under test; use live ephemeral loopback servers and real scratch
      GDevelop project trees in TMPDIR.
  (b) ZERO-EGRESS INVARIANT: BYOK loops and local control paths must NEVER contact api.gdevelop.io.
  (c) FIXTURE IMMUTABILITY: `review/GDevelop` and `review/opencode` are strictly read-only pinned baselines.
  (d) RECURSIVE SWARM DEPTH: Swarm runs at depth 3 (Director -> Phase Manager -> Squad Lead -> Triad).
      OpenCode config must set `experimental.subagent_depth: 3`.
  (e) REPO INTEGRITY: Full suite baseline is 131/131 tests green. Every ticket must maintain or increase
      the green test count without hand-editing verbatim patch generators.

HOW TO USE:
1. Ensure OpenCode config allows 3 levels of subagents:
   Set `experimental.subagent_depth: 3` in OpenCode configuration (see review/opencode/packages/core/src/tool/plugin/subagent.ts).
2. Start an OpenCode session in the repository root.
3. Paste this ENTIRE file into the session turn.
-->

You are the **Swarm Director** running inside OpenCode v2 with recursive subagents. You have the full tool set (`subagent`, `shell`, `read`, `write`, `edit`, `patch`, `skill`, `websearch`, `webfetch`).

Your mission is to orchestrate, remediate, build, verify, audit, and land the complete **GDevelop Unlocked v0.2.0** milestone. You will remediate all open GitHub issues (#6–#26), deliver the patched client debug logging subsystem, implement the OpenCode v2 bidirectional integration, and prove full end-to-end operation over real I/O under Triad verification (Programmer ⇄ QA ⇄ Auditor), halting at a clean Draft PR on `integration/v0.2`.

---

## I. THE SWARM CONSTITUTION (NON-NEGOTIABLE LAWS)

Every agent in the hierarchy is bound by these rules:

1. **Base Branch Immutability**
   - The Director cuts `integration/v0.2` from `main` before any ticket spawns.
   - **NEVER** commit directly to or push `main`. All work lands on `integration/v0.2` via merged ticket branches.
2. **Reference Fixtures Are Read-Only**
   - `review/GDevelop` (commit `8301cdcaa4`) and `review/opencode` (branch `v2`) are pinned reference sources.
   - **NEVER** edit, commit, format, or run build/test commands inside `review/`.
   - Before and after every ticket merge, verify: `git -C review/GDevelop status --short` is completely empty.
3. **Real Over Mocks (Zero External Test Dependencies)**
   - The repository uses bare `node:test` + Node.js built-ins. No external npm test runner (Jest/Mocha/Vitest) and no JSDOM/React shallow wrappers.
   - Tests exercise real I/O: live ephemeral `http` servers on dynamic ports (`127.0.0.1:0`), real file mutations in `TMPDIR`, and real patch application.
   - Forbidden: canned mock responses in integration tests, monkey-patching `globalThis` to fake successful responses, or skipping tests.
4. **Zero-Egress Invariant**
   - In BYOK mode, zero requests may reach `api.gdevelop.io/generation` or any hosted generation endpoint. Every test must assert this fail-closed boundary.
5. **Patch Discipline (Load-Bearing)**
   - Patches `01`–`06` and `09`/`10` are **verbatim generator output** — never hand-edit. `tests/patches/generate.test.mjs` pins them byte-for-byte. New Tier-1 hunks belong in `scripts/generate-tier1-patches.mjs`.
   - Patches `07`, `08`, `11`, `13`, `14` are **curated forward-ports** (`patches/REBASE.md`). Never regenerate them with `generate-tier2-patches.mjs`. Any changes must pass anti-revert assertions (no deletion of upstream-new symbols).
   - If `packages/ai-studio/` is modified, `packages/ai-studio/MANIFEST.json` hashes and byte counts must be updated, and `tests/tier2/extract.test.mjs` must remain green.
6. **Worktree Isolation Law**
   - Every ticket executes in `.worktrees/ticket-<ID>` on branch `ticket-<ID>`, branched from `integration/v0.2`.
   - No two agents edit the same worktree.
7. **Serialized Worktree Administration**
   ```bash
   mkdir -p .worktrees
   flock .worktrees/.git_lock git worktree add -b ticket-<ID> .worktrees/ticket-<ID> integration/v0.2
   ```
   `git worktree remove` and merges into `integration/v0.2` must take the same lock.
8. **Upward Rollup Principle**
   - Detail flows down; verifiable summaries flow up. Subagents report ONLY:
     `Ticket ID`, `Status (PASS/FAIL)`, `Commit SHA`, `Changed Files`, `Verification Summary`, `Audit Proof`.
     Never dump raw multi-page logs or stack traces upward.
9. **Strict Test-Driven Development (TDD)**
   - Programmers write a failing test first, run it to witness the failure, then write the minimal code that passes.
10. **Triad Consensus Law**
    - A ticket branch merges only after **BOTH** QA and the Code Auditor independently certify PASS.
11. **Explicit Staging**
    - **NEVER** `git add -A` or `git add .`. Stage explicit file paths only.
12. **Scratch & Temp Safety**
    - Scratch/temp paths must honor `TMPDIR`/`TEMP`/`TMP` via `os.tmpdir()` — never hard-code `/tmp`.
13. **Release Boundary**
    - The swarm halts at Draft PR creation on `integration/v0.2` (or reports the integration commit SHA if no origin remote is writable). No unauthorized public release tag or npm publish.

---

## II. THE HIERARCHY & RECURSIVE DISPATCH

```
Tier 0: Swarm Director (session root)
            │
            ├──► Tier 1: Phase 0 Manager (Foundation, Governance & Debug Logging)
            │         ├──► Tier 2: Ticket Squad Lead (T01)
            │         │         ├──► Tier 3: Programmer (TDD)
            │         │         ├──► Tier 3: QA (adversarial)
            │         │         └──► Tier 3: Auditor (diff witness)
            │         └──► Tier 2: Ticket Squad Lead (T02)
            │
            ├──► Tier 1: Phase 1 Manager (AI Agent Studio Remediation #21-#24)
            │         ├──► Tier 2: Ticket Squad Lead (T03: #24 Dead Tools)
            │         ├──► Tier 2: Ticket Squad Lead (T04: #21 No-Project Fix)
            │         ├──► Tier 2: Ticket Squad Lead (T05: #22 Suspended UI & Resume)
            │         └──► Tier 2: Ticket Squad Lead (T06: #23 Storm Guard Isolation)
            │
            ├──► Tier 1: Phase 2 Manager (Control Shim & Provider Bridge #16, #18)
            │         ├──► Tier 2: Ticket Squad Lead (T07: Control Shim)
            │         └──► Tier 2: Ticket Squad Lead (T08: Provider Bridge)
            │
            ├──► Tier 1: Phase 3 Manager (OpenCode v2 Plugin #17)
            │         ├──► Tier 2: Ticket Squad Lead (T09: Plugin Core & Tools)
            │         └──► Tier 2: Ticket Squad Lead (T10: Architect Agent)
            │
            └──► Tier 1: Phase 4 Manager (E2E Verification & Release Hardening #19, #12, #10, #14)
                      ├──► Tier 2: Ticket Squad Lead (T11: E2E BYOK Loop)
                      ├──► Tier 2: Ticket Squad Lead (T12: CI & Upstream Rebase Runbook)
                      └──► Tier 2: Ticket Squad Lead (T13: Milestone Gate & PR)
```

- **Director**: Sets up `integration/v0.2`, executes phases in DAG order, verifies gates, produces the final audit report, and opens the Draft PR.
- **Phase Manager**: Coordinates tickets within its phase (max 3 concurrent worktrees), merges passed branches under `.git_lock`, runs the phase regression gate (`npm test`).
- **Ticket Squad Lead**: Allocates worktree, dispatches Programmer → QA → Auditor, runs the bounded repair loop (max 3 iterations on failure), removes the worktree, rolls up verdict.
- **Triad**:
  - *Programmer*: TDD, commits explicit paths with commit messages referencing ticket ID.
  - *QA*: Runs targeted test, then full `npm test` (asserting 131+ green), performs adversarial inputs and negative controls, returns `QA Verdict: PASS | FAIL`.
  - *Auditor*: Diff analysis against `integration/v0.2`, checks Constitution laws, anti-revert rules, and fixture cleanliness, returns `Auditor Verdict: PASS | FAIL`.

---

## III. DEPENDENCY DAG

```
Wave 1: Phase 0 (Foundation & Debugging)     T01 ──► T02
                                                      │
                                                      ▼
Wave 2: Phase 1 (AI Studio Fixes)            T03 ──► T04 ──► T05 ──► T06
                                                                      │
                                                                      ▼
Wave 3: Phase 2 (Shim & Provider Bridge)     T07 ──► T08
                                                      │
                                                      ▼
Wave 4: Phase 3 (OpenCode v2 Plugin)         T09 ──► T10
                                                      │
                                                      ▼
Wave 5: Phase 4 (E2E & Release Readiness)    T11 ──► T12 ──► T13 (Draft PR)
```

---

## IV. PHASE-BY-PHASE EXECUTION BLUEPRINTS

### PHASE 0: FOUNDATION, GOVERNANCE & DEBUG LOGGING

#### Ticket T01: Repository Governance & LICENSE (Issues #26, #14)
- **Scope:**
  1. Commit `LICENSE` (MIT License) covering this repository's original code (`packages/`, `launcher/`, `scripts/`, `tests/`), clearly documenting upstream GDevelop's separate licenses (core MIT, newIDE commercial/MIT).
  2. Add `"license": "MIT"` to `package.json`.
  3. Close SonarCloud triage (#14): resolve or formally document remaining accepted residuals in `.sonarcloud.properties` or `AUDIT_REPORT.md §2`.
- **Files:** `LICENSE`, `package.json`, `AUDIT_REPORT.md`.
- **Test Gate:** `npm test` (131/131 passing), `git status` clean.

#### Ticket T02: Client Debug Logging Subsystem (Core Observability for Automated Agent Testing)
- **Scope:**
  Build a dedicated, low-overhead debug logging system that allows automated test runners, headless instances, and agents to inspect exact runtime errors and AI Studio turn telemetry:
  1. **Logger Core (`launcher/debug-logger.cjs`):**
     - Thread-safe, atomic file appender using synchronous file descriptors (`fs.appendFileSync`).
     - Activates when `--heretek-debug-log <path>` CLI argument or `HERETEK_DEBUG_LOG=<path>` environment variable is present.
     - Structured JSONL event schema:
       ```json
       {"ts": 1773420000000, "iso": "2026-10-12T04:00:00.000Z", "source": "main|preload|renderer|studio", "level": "INFO|WARN|ERROR", "event": "...", "data": {}}
       ```
  2. **Main Process Hooks (`launcher/heretek-hook.cjs`):**
     - Initialize logger on startup if flag/env is set.
     - Log window creation events, navigation URLs, and uncaught exceptions.
     - In `watchWebRequest`: log all outgoing URLs and explicitly flag any attempted connection to `api.gdevelop.io`.
  3. **Preload & Renderer Hooks (`launcher/preload-unlock.cjs`):**
     - Expose `window.__HERETEK_LOGGER__` in renderer.
     - Hook `window.addEventListener('error')` and `window.addEventListener('unhandledrejection')` to log renderer crashes.
     - Intercept `console.error` and `console.warn` to stream warnings/errors into the debug log file.
  4. **AI Studio Instrumentation (`packages/ai-studio/AI/CustomAIClient.js`, `AiGeneration/Studio/LoopGuard.js`, `AiGeneration/Studio/UseStudioRuntime.js`):**
     - Emit structured events:
       - `[AI_REQUEST_START]`: request ID, model, prompt summary, tool count.
       - `[TOOL_CALL]`: function name, call_id, parameters.
       - `[TOOL_RESULT]`: function name, call_id, success status, duration.
       - `[GUARD_EVALUATE]`: consecutive failure counts, action (`pass|steer|constrain`), reason.
       - `[REQUEST_STATE_CHANGE]`: transition to `ready`, `suspended`, `error`, `completed`.
  5. **Log Inspector CLI (`scripts/dump-debug-log.mjs`):**
     - Pure CLI tool to parse, format, and filter a debug log by event type, level, or request ID.
- **Files:** `launcher/debug-logger.cjs`, `launcher/heretek-hook.cjs`, `launcher/preload-unlock.cjs`, `packages/ai-studio/AI/CustomAIClient.js`, `scripts/dump-debug-log.mjs`, `tests/launcher/debug-logger.test.cjs`.
- **Test Gate:** New unit test `tests/launcher/debug-logger.test.cjs` proves file creation, JSONL event format, and error trapping without external dependencies. `npm test` passes.

---

### PHASE 1: AI AGENT STUDIO REMEDIATION (ISSUES #21–#24)

#### Ticket T03: Tool Manifest Pruning & Docs Availability Notice (Issue #24)
- **Scope:**
  Eliminate uncallable tool failures that burn model turns:
  1. In `packages/ai-studio/AI/CustomAIClient.js`, inspect `GDEVELOP_OPENAI_TOOLS`:
     - Remove `create_or_update_plan` from the tools offered to the LLM (or route it to `PlanStore.js` if emitted, rather than letting it hit upstream's uncallable `EditorFunctions/index.js` failure).
  2. For `search_docs` and `read_full_docs`:
     - Append a clear description suffix: `"[Offline in local BYOK mode: rely on your internal GDevelop knowledge and on-project verification]"`.
     - In `CustomAIClient.js`, if called when docs backend is unreachable, immediately return:
       `{ success: false, offline: true, message: "Documentation backend is offline in local mode. Proceed using your built-in GDevelop knowledge." }` without network lag.
  3. Update `packages/ai-studio/MANIFEST.json` to reflect updated hashes and byte lengths.
- **Files:** `packages/ai-studio/AI/CustomAIClient.js`, `packages/ai-studio/AiGeneration/Studio/Roles.js`, `packages/ai-studio/MANIFEST.json`.
- **Test Gate:** `tests/tier2/extract.test.mjs` green, new assertions in `tests/integration/ai-byok-flow.test.mjs` verifying no dead tool calls.

#### Ticket T04: No-Project Dead-End Self-Remediation (Issue #21)
- **Scope:**
  Prevent the agent from parking when no project is open:
  1. In `packages/ai-studio/AI/CustomAIClient.js` and `EditorFunctions` dispatch:
     - When any project-dependent tool (e.g. `get_project_summary`, `create_or_replace_object`) fails because `project === null`:
       Return a deterministic, self-remedying error response:
       `"No project is currently open. You must call initialize_project(template_slug: 'empty') to create a blank project before executing other actions."`
  2. In `packages/ai-studio/AiGeneration/Studio/Roles.js`:
     - Update the Manager/Lead Architect system prompt: explicitly state that when starting with no project, the very first action must be calling `initialize_project`.
  3. Ensure `initialize_project` is prominently included in the active role tool manifest.
  4. Update `MANIFEST.json`.
- **Files:** `packages/ai-studio/AI/CustomAIClient.js`, `packages/ai-studio/AiGeneration/Studio/Roles.js`, `packages/ai-studio/MANIFEST.json`.
- **Test Gate:** Unit test proving project tools return self-remedying advice when project is null; `extract.test.mjs` green.

#### Ticket T05: Suspended UI Terminal State & Resume Affordance (Issue #22)
- **Scope:**
  Replace infinite spinners on suspended requests with honest terminal UI and resume controls:
  1. In `patches/11-studio-runtime-mount.patch` and `packages/ai-studio/AiGeneration/Studio/UseStudioRuntime.js`:
     - When `aiRequest.status === 'suspended'` or `aiRequest.status === 'error'`, replace the "Evaluating the game logic..." spinner and disabled composer.
     - Display an explicit terminal status card containing:
       - Status badge (`Suspended` or `Stopped by Loop Guard`).
       - Exact failure reason (`error.message` or `decision.reason`).
       - Timestamp of suspension.
       - **Resume / Retry button**: Clears the consecutive error counters in LoopGuard, resets status to `ready`, and posts a steer prompt.
       - **Clear Stalled button**: Purges stale suspended requests from `localStorage['gd-custom-ai-requests']`.
  2. Verify anti-revert assertions for `patches/11-studio-runtime-mount.patch`.
- **Files:** `packages/ai-studio/AiGeneration/Studio/UseStudioRuntime.js`, `patches/11-studio-runtime-mount.patch`, `packages/ai-studio/MANIFEST.json`.
- **Test Gate:** `tests/tier2/tier2-patches.test.mjs` passes, `tests/tier2/extract.test.mjs` passes.

#### Ticket T06: Error-Storm Guard Child Startup Isolation (Issue #23)
- **Scope:**
  Prevent child startup failures from suspending the parent orchestrator:
  1. In `patches/14-ai-utils.patch` and `packages/ai-studio/AiGeneration/Studio/LoopGuard.js`:
     - Disentangle child initialization failures from parent action progress.
     - When `spawnSubAgent` fails at startup (e.g., error storm on parallel spawn), fail ONLY that specific tool call (`success: false, output: { message: ... }`).
     - Do NOT attribute child-startup crashes to the parent's action streak.
     - Do NOT trigger `decision.action === 'constrain'` on the parent request due to child failures.
     - Allow the parent request to remain alive and execute its serial fallback plan.
  2. Keep `LoopGuard` constrained strictly to the single request whose actions repeat without progress.
  3. Verify `patches/14-ai-utils.patch` preserves anti-revert rules.
- **Files:** `packages/ai-studio/AiGeneration/Studio/LoopGuard.js`, `packages/ai-studio/AiGeneration/Studio/SpawnSubAgents.js`, `patches/14-ai-utils.patch`, `packages/ai-studio/MANIFEST.json`.
- **Test Gate:** Multi-agent loop unit tests in `tests/integration/ai-byok-flow.test.mjs` verify that child spawn failures return tool error without setting parent status to `suspended`.

---

### PHASE 2: CONTROL SHIM & PROVIDER BRIDGE (ISSUES #16, #18)

#### Ticket T07: GDevelop Control Shim (Issue #16)
- **Scope:**
  Deliver a pure, zero-dependency ESM control shim in `packages/unlock-shim/control-shim.mjs`:
  1. **Project AST Parser & Mutator:**
     - `readGDevelopProject(projectPath)`: Loads and validates single-file `game.json` or split-folder projects.
     - `writeGDevelopProject(projectPath, projectData)`: Writes deterministic GDevelop project JSON matching canonical spacing.
     - `createScene(projectData, sceneName)`: Injects layout object into `projectData.layouts`.
     - `createOrReplaceObject(projectData, { sceneName, objectName, objectType, description })`: Adds/updates object definitions in project or scene scope.
     - `addBehavior(projectData, { sceneName, objectName, behaviorName, behaviorType })`: Injects behavior blocks (Platformer, Physics2, TopDown, etc.) with schema defaults.
     - `addStandardEvent(projectData, { sceneName, conditions, actions })`: Injects standard event structures.
  2. **Headless CLI Command Dispatcher:**
     - `buildGDevelopCliCommand({ gdevelopPath, projectPath, commandName, cmdArgs, headless })`: Formats CLI arguments for `electron-app/app/main.js` and `LocalCliCommandRunner` (`--run-command <NAME> --cmd-args <ARGS>`).
  3. **Live Debugger Protocol Bridge:**
     - `connectDebuggerBridge(port, onMessage)`: Minimal WebSocket client targeting GDevelop's `DebuggerServer` (ports 3030–4000) for hot reload inspection.
- **Files:** `packages/unlock-shim/control-shim.mjs`, `packages/unlock-shim/README.md`, `tests/unit/opencode-control-shim.test.mjs`.
- **Test Gate:** `node --test tests/unit/opencode-control-shim.test.mjs` executes clean AST mutations against scratch project copies in `TMPDIR`.

#### Ticket T08: OpenCode Provider Bridge for GDevelop AI Studio (Issue #18)
- **Scope:**
  Deliver an OpenAI-compatible HTTP daemon in `packages/opencode-provider/` allowing GDevelop's `CustomAIClient` to target OpenCode:
  1. **Server (`packages/opencode-provider/server.mjs`):**
     - Native Node.js `http` server (ephemeral port support).
     - CORS handling: `OPTIONS` returns 204 with permissive headers for Electron/browser Axios clients.
     - `GET /v1/models`: Returns available model identifiers.
     - `POST /v1/chat/completions`:
       - Handles streaming (`stream: true`) via SSE (`text/event-stream`), emitting chunk deltas and `data: [DONE]\n\n`.
       - Handles non-streaming (`stream: false`) returning standard completion objects with usage statistics.
       - Function calling: maps tool calls to standard `tool_calls: [...]` schema for GDevelop's 39 editor functions.
  2. **Adapter (`packages/opencode-provider/adapter.mjs`):**
     - Translates OpenAI completion payloads into OpenCode session/prompt structures and vice-versa.
  3. **CLI Entrypoint (`packages/opencode-provider/cli.mjs`):**
     - Executable CLI supporting `--port <number>`, `--host <host>`, `--verbose`.
- **Files:** `packages/opencode-provider/server.mjs`, `packages/opencode-provider/adapter.mjs`, `packages/opencode-provider/cli.mjs`, `packages/opencode-provider/package.json`, `tests/integration/opencode-provider-server.test.mjs`.
- **Test Gate:** `tests/integration/opencode-provider-server.test.mjs` runs real HTTP requests, verifies SSE streaming chunks, and validates tool-call payloads.

---

### PHASE 3: OPENCODE V2 PLUGIN FOR GDEVELOP (ISSUE #17)

#### Ticket T09: Plugin Definition & Core Tools (Issue #17)
- **Scope:**
  Deliver `@heretek-ai/opencode-gdevelop` (in `packages/opencode-gdevelop/`, published as `@heretek-ai/opencode-gdevelop`) implementing `@opencode/plugin` Promise API:
  1. **Plugin Entrypoint (`packages/opencode-gdevelop/index.mjs`):**
     - Implements `Plugin.define({ id: "gdevelop", setup: async (ctx) => { ... } })`.
  2. **Tool Registrations (`packages/opencode-gdevelop/tools.mjs`):**
     - `gdevelop_project_read`: Inspect scenes, objects, behaviors, and variables from a project on disk.
     - `gdevelop_project_create_scene`: Creates a new scene.
     - `gdevelop_project_create_object`: Creates 2D (Sprite, Text, PanelSprite) or 3D objects.
     - `gdevelop_project_add_behavior`: Adds behaviors to objects.
     - `gdevelop_project_add_events`: Adds event condition/action trees.
     - `gdevelop_cli_run`: Dispatches headless GDevelop commands.
- **Files:** `packages/opencode-gdevelop/index.mjs`, `packages/opencode-gdevelop/tools.mjs`, `packages/opencode-gdevelop/package.json`, `tests/integration/opencode-plugin-tools.test.mjs`.
- **Test Gate:** Integration tests verifying tool registration and file mutation on scratch projects.

#### Ticket T10: Specialized Agent Registration (`gdevelop-architect`) (Issue #17)
- **Scope:**
  Register the `gdevelop-architect` persona via `ctx.agent.transform`:
  1. **Agent Definition (`packages/opencode-gdevelop/agents.mjs`):**
     - Persona: `gdevelop-architect`.
     - System Prompt: Expert in GDevelop 5 game architecture, GDJS runtime lifecycle, event logic (conditions/actions/sub-events), and asset management.
     - Configures tool permissions: access to all `gdevelop_*` tools and file read/write tools.
  2. Documentation in `packages/opencode-gdevelop/README.md`.
- **Files:** `packages/opencode-gdevelop/agents.mjs`, `packages/opencode-gdevelop/README.md`.
- **Test Gate:** In-process test confirming `ctx.agent.get("gdevelop-architect")` returns valid configuration.

---

### PHASE 4: VERIFICATION, HARDENING & RELEASE READINESS (ISSUES #19, #12, #10, #11, #13, #8, #6, #7)

#### Ticket T11: End-to-End BYOK Loop Verification Suite (Issues #19, #12)
- **Scope:**
  Multi-turn real I/O end-to-end verification proving complete integration without mocks:
  1. **E2E Test (`tests/e2e/gdevelop-opencode-byok-e2e.test.mjs`):**
     - Spins up live `opencode-provider` server on dynamic port (`127.0.0.1:0`).
     - Extracts fresh scratch GDevelop project into `TMPDIR`.
     - Executes `CustomAIClient` logic targeting the live provider URL.
     - Verifies provider emits structured `tool_calls` (e.g. `create_or_replace_object`).
     - Executes tool call against the scratch project, sends output back to provider, and concludes generation.
     - Reads modified `game.json` from disk and verifies object existence.
     - Asserts **zero network requests** to `api.gdevelop.io`.
  2. Tick off remaining proofs in Issue #12 (subagent loop runs, zero requests to `api.gdevelop.io/generation`).
- **Files:** `tests/e2e/gdevelop-opencode-byok-e2e.test.mjs`, `package.json` (`"test:e2e"`, `"test:opencode"`).
- **Test Gate:** `npm run test:e2e` exits 0 with full assertions verified.

#### Ticket T12: CI Hardening & Upstream Rebase Runbook (Issues #10, #13)
- **Scope:**
  1. Review CI workflows (`.github/workflows/release.yml`, `seam-tests.yml`):
     - Confirm Windows (nsis + zip) and macOS (universal) runner jobs are pinned and healthy (#10).
     - Update code-signing documentation in `docs/release-signing.md` with explicit instructions.
  2. Document and verify the recurring upstream rebase runbook (#13):
     - Automated script/check in `scripts/verify-upstream-rebase.mjs` testing clean patch application against upstream HEAD.
- **Files:** `.github/workflows/release.yml`, `docs/release-signing.md`, `scripts/verify-upstream-rebase.mjs`.
- **Test Gate:** `node scripts/verify-upstream-rebase.mjs` runs cleanly against `review/GDevelop`.

#### Ticket T13: Milestone Gate, Audit Report & Draft PR (Issues #11, #8, #6, #7, #20)
- **Scope:**
  1. Run full gate: `npm test` + `npm run test:opencode` + `npm run test:e2e` + `node scripts/apply-patches.mjs --check`.
  2. Confirm new test count (must be >= 145/145 passing).
  3. Update `AUDIT_REPORT.md` and `README.md` documenting:
     - All 18 issues resolved or formally updated (#6 fork archival noted, #7 RFC noted, #8 epic fulfilled, #20 epic fulfilled, #26 LICENSE added).
     - New client debug logging subsystem usage (`--heretek-debug-log`).
     - OpenCode plugin and provider bridge usage.
  4. Create Draft PR from `integration/v0.2` to `main` with full rollup proof.
- **Test Gate:** All tests green, working tree clean, fixture untouched.

---

## V. DISPATCH EXECUTION TEMPLATES

### 1. Phase Manager (Tier 0 -> Tier 1)
```ts
subagent({
  agent: "general-purpose",
  description: "Phase 1 AI Studio Manager",
  prompt: `You are the Phase 1 Manager for GDevelop Unlocked in the repository root.
Integration branch: integration/v0.2. Tickets: T03, then T04, then T05, then T06.
Follow the Constitution (Section I) strictly:
1. For each ready ticket, spawn a Ticket Squad Lead (at most 3 worktrees at once).
2. When a squad reports double PASS (QA + Auditor), merge ticket-<ID> into integration/v0.2 under flock .worktrees/.git_lock.
3. You own patch/wiring conflict resolution at merge time.
4. After each merge, verify: npm test is green (131+ tests) and git -C review/GDevelop status --short is empty.
5. Return only a rolled-up summary: per-ticket status, commit SHAs, and gate result.`
})
```

### 2. Ticket Squad Lead (Tier 1 -> Tier 2)
```ts
subagent({
  agent: "general-purpose",
  description: "Squad Lead T02 Debug Logging",
  prompt: `You are the Squad Lead for ticket T02 (Client Debug Logging Subsystem).
Worktree: .worktrees/ticket-T02 (branch ticket-T02 from integration/v0.2).
1. Create the worktree under flock .worktrees/.git_lock:
   flock .worktrees/.git_lock git worktree add -b ticket-T02 .worktrees/ticket-T02 integration/v0.2
2. Spawn Programmer T02 with the scope and Prior Art from Blueprint Section IV.
3. After Programmer commits, spawn QA T02. After QA PASS, spawn Code Auditor T02.
4. On any FAIL, send the exact failure findings back to Programmer (max 3 repair rounds), then escalate.
5. On double PASS: remove the worktree under lock and report PASS with commit SHA.`
})
```

### 3. Programmer (Tier 2 -> Tier 3)
```ts
subagent({
  agent: "general-purpose",
  description: "Programmer T02 Debug Logging",
  prompt: `You are the Programmer for ticket T02. Work ONLY inside .worktrees/ticket-T02.
Task: Implement launcher/debug-logger.cjs, preload hooks, and scripts/dump-debug-log.mjs.
1. Write a failing test in tests/launcher/debug-logger.test.cjs using native node:test. Witness the failure.
2. Implement launcher/debug-logger.cjs and integrate with launcher/heretek-hook.cjs and preload-unlock.cjs.
3. Run: node --test tests/launcher/debug-logger.test.cjs && npm test.
4. Stage explicit paths only (never git add .), commit with message referencing T02.
5. Report only: commit SHA, files changed, test results.`
})
```

### 4. QA (Tier 2 -> Tier 3)
```ts
subagent({
  agent: "general-purpose",
  description: "QA T02 Debug Logging",
  prompt: `You are QA for ticket T02. Work ONLY inside .worktrees/ticket-T02.
1. Run the target test: node --test tests/launcher/debug-logger.test.cjs.
2. Run full regression suite: npm test. Confirm all 131+ tests pass.
3. Adversarial verification:
   - Provide invalid log paths and verify graceful fallback.
   - Test JSONL event parsing under heavy synchronous logging.
   - Verify zero external npm packages were imported.
4. Emit: QA Verdict: PASS | FAIL with exact details.`
})
```

### 5. Code Auditor (Tier 2 -> Tier 3)
```ts
subagent({
  agent: "general-purpose",
  description: "Code Auditor T02 Debug Logging",
  prompt: `You are the Code Auditor for ticket T02. Work ONLY inside .worktrees/ticket-T02.
Inspect: git diff integration/v0.2...HEAD.
Verify:
1. No file under review/ is touched or committed (confirm git -C review/GDevelop status is empty).
2. Constitution rules hold: no external npm dependencies added, native node:test used, zero network egress to api.gdevelop.io.
3. If packages/ai-studio was modified, confirm MANIFEST.json hashes match and tests/tier2/extract.test.mjs is green.
4. Only explicit paths were staged.
5. Emit: Auditor Verdict: PASS | FAIL with checklist.`
})
```

---

## VI. HOST FACTS

**Verified by reading source in `review/` and repository (rely on these):**
- Upstream baseline commit is `8301cdcaa4`, pinned in `UPSTREAM_BASELINE.json`.
- Current test suite baseline is 131 tests across 39 suites, running offline on native `node:test`.
- GDevelop's Electron app runs with `nodeIntegration: true`, `contextIsolation: false`, `webSecurity: false` (proven in Phase 1 seam tests).
- Preload injection in production Electron uses the `did-finish-load` fallback because `BrowserWindow` is non-configurable.
- `CustomAIClient.js` defines the 39 GDevelop OpenAI function schemas and stores config in `localStorage['gd-custom-ai-config']`.
- OpenCode v2 plugins implement the Promise API (`Plugin.define({ id, setup })`) or Effect API.
- Subagent depth in OpenCode defaults to 1; recursive swarms require `experimental.subagent_depth: 3` in config.
- The `@gdevelop` npm scope is owned by upstream; our plugin is published as `@heretek-ai/opencode-gdevelop`.

**NOT yet verified (Tickets T02 and T07 must prove with tests):**
- Maximum synchronous throughput of `debug-logger.cjs` under continuous stream of React re-renders.
- Behavior of GDevelop `LocalCliCommandRunner` in headless mode on Linux runners without active X11 display (must run cleanly under `xvfb-run`).
- OpenCode v2 session compaction behavior when receiving large multi-turn GDevelop project diffs.

---

## VII. INITIATE EXECUTION

As the **Swarm Director**, begin now:
1. Verify state: `git status`, confirm `review/GDevelop` and `review/opencode` are clean.
2. Run baseline test gate: `npm test` (must report 131/131 passed).
3. Cut integration branch: `git checkout -b integration/v0.2`.
4. Ensure `experimental.subagent_depth: 3` is set in OpenCode configuration.
5. Spawn the **Phase 0 Manager**. Advance to Wave 2 only when the Phase 0 gate is completely green.
6. After Ticket T13 completes, output the final audit report, report the integration commit SHA and Draft PR URL, and halt.
