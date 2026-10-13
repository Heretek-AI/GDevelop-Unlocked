# OpenCode v2 Coordinator Swarm Handoff
**GDevelop-Unlocked: Multi-Tier Execution, Programming & QA Delegation**

---

```markdown
# MISSION BRIEFING: OPENCODE v2 SWARM COORDINATOR
**Target Repository**: `/home/john/Projects/GDevelop-Unlocked`
**Configuration Profile**: `~/.config/opencode/opencode.jsonc` (`coordinator` mode, `subagent_depth: 10`)
**Architecture Specification**: `docs/PERFECT_AI_IMPLEMENTATION_PLAN.md`
**Prior Tier Findings**: `.opencode/research_findings.json`
**Current Status**: 258/258 passing tests across 73 test suites (`node --test`, zero npm dependencies)

---

## 1. SWARM TOPOLOGY & SUBAGENT ROLES

As the global OpenCode v2 Swarm Coordinator, you must initialize and delegate responsibilities across the following specialized nested subagents. Supervise their execution, enforce quality gates, and prevent context saturation:

```
                      [OPENCODE v2 COORDINATOR]
             (Oversees Global Plan, State, & Commits)
                                |
      +-------------------------+-------------------------+
      |                         |                         |
[PROGRAMMING LEAD]         [TIER OVERSEERS]           [QA LEAD]
  (Code modifications,       (Tiers 1-4 domain         (Verification,
   AST edits, Manifest)       specialists)              Zero-Mock tests)
                                |
      +------------+------------+------------+------------+
      |            |            |            |
   [Tier 1:     [Tier 2:     [Tier 3:     [Tier 4:
   Upstream     Harness &    Skills &     Native MCP
   Auditor]     Runtime]     Hydration]   Architect]
```

### Subagent Definitions & Delegations

1. **`subagent:tier1-upstream-overseer`**
   - **Domain**: Upstream AST alignment, seam gates, and patch stack integrity.
   - **Anchor Files**: `patches/` (01-14), `review/GDevelop` (HEAD: `8301cdcaa48b496f48a28a6e3a56fa833eaeddff`), `UPSTREAM_BASELINE.json`.
   - **Directives**:
     - Monitor divergence hotspots: `11-studio-runtime-mount.patch` (Critical), `14-ai-utils.patch` (High), `08-preferences-ai.patch` (High).
     - Ensure `review/GDevelop` is NEVER mutated. Scratch copies only (`git -C review/GDevelop archive HEAD ... | tar -x -C <scratch>`).
     - Validate all AST entrypoints using `codebase-memory-mcp` before and after patch operations.

2. **`subagent:tier2-harness-overseer`**
   - **Domain**: Real-world streaming BYOK provider harness, process lifecycle, and IPC bus.
   - **Anchor Files**: `packages/ai-studio/`, `packages/opencode-provider/`, `packages/unlock-shim/`.
   - **Directives**:
     - Oversee complete elimination of `packages/ai-studio/dev-harness/mock-ai-provider.js` and all static `mock-script*.json` fixtures.
     - Supervise streaming adapters for Ollama, OpenAI, Anthropic, and Gemini protocols in `packages/opencode-provider/adapter.mjs`.
     - Enforce LoopGuard / Storm Guard ladder constraints and per-chunk idle watchdog.
     - Validate bidirectional IPC over `heretek:debug-log` and `heretek:llm-control`.

3. **`subagent:tier3-skills-overseer`**
   - **Domain**: Progressive disclosure skills system and static analysis enforcement.
   - **Anchor Files**: `.opencode/skills/`, `~/.config/opencode/skills/`, `.opencode/semgrep/gdevelop-rules.yaml`, `packages/opencode-gdevelop/gdevelop-skills.d.ts`.
   - **Directives**:
     - Maintain the 4 domain skills: `gdevelop-eventsheet-codegen`, `gdevelop-extension-wrapper`, `gdevelop-scenegraph-manipulation`, `gdevelop-asset-injection`.
     - Run `semgrep scan` pre-commit checks on all JavaScript/TypeScript files in `packages/`.
     - Hydrate context dynamically via `codebase-memory-mcp` (upstream: `home-john-Projects-GDevelop`, downstream: `home-john-Projects-GDevelop-Unlocked`).

4. **`subagent:tier4-mcp-overseer`**
   - **Domain**: Native Model Context Protocol (MCP) server architecture.
   - **Anchor Files**: `packages/opencode-provider/mcp-server.mjs`, `tests/integration/mcp-server.test.mjs`.
   - **Directives**:
     - Oversee the 16 native GDevelop MCP tools and dynamic resources (`gdevelop://project/current`, `gdevelop://scene/{name}`, `gdevelop://debugger/state`).
     - Enforce the 4 security gates (`opencode.jsonc` compliant): mutating ask policy, path containment, zero null bytes, and fail-closed zero-egress guard (`api.gdevelop.io` blocking).
     - Maintain Stdio JSON-RPC 2.0 protocol compliance (`2024-11-05`).

5. **`subagent:programming-lead`**
   - **Domain**: Hands-on code modifications, patch regeneration, and manifest pinning.
   - **Directives**:
     - Apply targeted code changes requested by Tier Overseers.
     - Recompute SHA-256 hashes and byte lengths in `packages/ai-studio/MANIFEST.json` on any edits under `packages/ai-studio/`.
     - Regenerate Tier-1 patches via `node scripts/generate-tier1-patches.mjs`; NEVER hand-edit Tier-1 patches.
     - Enforce zero external npm dependencies (Node.js builtins only).

6. **`subagent:qa-lead`**
   - **Domain**: Autonomous end-to-end verification and gate enforcement (Zero Mocks).
   - **Directives**:
     - Run `npm test` after every phase. Ensure test count never drops below 258/258 passing tests.
     - Run `node --test tests/integration/mcp-server.test.mjs` and `node --test tests/integration/opencode-skills.test.mjs`.
     - Execute Semgrep scans (`semgrep scan --config .opencode/semgrep/gdevelop-rules.yaml --json packages/`) and verify 0 blocking findings.
     - Verify pristine condition of fixture: `git -C review/GDevelop status --short` must be empty.

---

## 2. STRICT OPERATIONAL RULES & CONSTRAINTS

1. **Verify, Don't Assert**: Every claim must be supported by command output or executed test results.
2. **Never Mutate Fixture**: `review/GDevelop` is read-only.
3. **Zero Mocked Data**: Zero mock tokens, zero mock scripts, zero HTTP interception mocks. Live processes, loopback sockets (`127.0.0.1`), and authentic child processes only.
4. **Zero NPM Dependencies**: Node.js builtins only (`node:test`, `node:fs`, `node:path`, `node:net`, `node:http`, `node:child_process`).
5. **Fail-Closed Security**: `local-ai-*` IDs must NEVER touch `api.gdevelop.io`.
6. **Preserve Baseline Alignment**: All changes must conform to `UPSTREAM_BASELINE.json`.

---

## 3. IMMEDIATE EXECUTION ORDER

1. **Step 1 (Coordinator Initial Handshake)**:
   - Ingest `.opencode/research_findings.json` and `docs/PERFECT_AI_IMPLEMENTATION_PLAN.md`.
   - Run baseline test suite check: `npm test` (verify 258/258 tests pass).
   - Spawn `subagent:tier2-harness-overseer` to oversee the safe deprecation of `packages/ai-studio/dev-harness/mock-ai-provider.js` and update `MANIFEST.json`.

2. **Step 2 (Programming & Manifest Pinning)**:
   - Direct `subagent:programming-lead` to remove `mock-ai-provider.js` and all static mock JSON files.
   - Update `packages/ai-studio/MANIFEST.json` and adjust `tests/tier2/extract.test.mjs`.
   - Dispatch `subagent:qa-lead` to verify zero regression.

3. **Step 3 (MCP Server & Tool Wire-Up)**:
   - Direct `subagent:tier4-mcp-overseer` to verify live child-process Stdio communication against external MCP hosts.
   - Direct `subagent:tier3-skills-overseer` to validate skill prompts against real game AST generation.

4. **Step 4 (Final Synthesis & Report)**:
   - Run full regression: `npm test`, `semgrep scan`, and verify `git -C review/GDevelop status --short` is clean.
   - Produce a signed completion log in `.opencode/execution_log.json`.
```
