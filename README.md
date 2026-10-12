# GDevelop-Unlocked

Surgical, patch-stack conversion of the premium unlocks +
Bring-Your-Own-Key local AI studio pioneered in the (now-retired)
[GDevelop-Heretek](https://github.com/Heretek-AI/GDevelop-Heretek) fork —
into a maintainable delivery shape with **zero dependency on that fork**.
No 205-file merge treadmill, no donor checkout in any build/test/CI path.

Three delivery mechanisms, all applied onto stock upstream GDevelop:

| Mechanism | Lives in | What it does |
|---|---|---|
| **Tier-1 patches** (`01`–`06`) | `patches/` | Curated minimal hunks: subscription/capability unlocks, checker no-ops, logo/watermark + preview/debugger gate removal, Electron loader line |
| **Tier-2 glue** (`07`–`14`) | `patches/` + `packages/ai-studio/` | Fork's BYOK AI routing ported as patches; runtime (`CustomAIClient`, 12 Studio modules) extracted verbatim into `packages/ai-studio/` and overlaid by the driver |
| **Launcher hook** | `launcher/` | Main-process preload injection + `fetch`/XHR spoof + `webRequest` backstop, so a stock build unlocks at runtime |

Patches `07/08/11/13/14` are **curated forward-ports** (see
`patches/REBASE.md`); `09/10/12` are verbatim deltas (`09/10` purely
additive). Full audit trail: `AUDIT_REPORT.md`.

## Quickstart

```bash
npm test                                   # full suite (unit + integration), offline
npm run test:e2e                            # BYOK loop end-to-end (live provider + scratch project)
npm run test:opencode                       # opencode-focused subset (unit + opencode-* + e2e)
node scripts/apply-patches.mjs --check     # seam gate only, no filesystem changes
node scripts/verify-upstream-rebase.mjs    # rebase drift gate: full stack vs pristine upstream HEAD

# Apply everything to a pristine upstream checkout (then build it):
node scripts/apply-patches.mjs --target <upstream-checkout>
node scripts/apply-patches.mjs --verify-only --target <patched-checkout>  # read-only re-check

# Stock release artifact (bundled code — source hunks can't apply;
# Tier-1 only, see launcher/README.md):
node scripts/inject-launcher.mjs --appdir <extracted-asar-dir>
```

Requirements: Node ≥ 22, `patch`, git. The upstream test fixture
(`review/GDevelop`, multi-GB) is gitignored; CI clones the pinned upstream
commit. Nothing else external is needed — this repo is fork-independent.

## Layout

- `patches/` — 14 patches + `README.md` (per-patch targets) + `REBASE.md`
- `scripts/` — `apply-patches.mjs` (driver), `generate-tier1/2-patches.mjs`
  (generators), `verify-upstream-rebase.mjs` (rebase drift gate),
  `inject-launcher.mjs`, `strip-updater-feed.mjs` (release)
- `launcher/` — `heretek-hook.cjs`, `preload-unlock.cjs`, `unlock-payloads.cjs`
  (+ `debug-logger.cjs`: `--heretek-debug-log <path>` / `HERETEK_DEBUG_LOG`;
  inspect with `node scripts/dump-debug-log.mjs <path>`)
- `packages/ai-studio/` — extracted Tier-2 runtime + `dev-harness/` mock provider
- `packages/unlock-shim/` — routing/leak-guard invariants (reference impl)
- `packages/opencode-provider/` — local OpenAI-compatible daemon
  (`node packages/opencode-provider/cli.mjs [--port 0]`) and MCP STDIO server
  (`node packages/opencode-provider/mcp-server.mjs`); target from Preferences → AI Settings or MCP clients
- `packages/opencode-gdevelop/` — OpenCode plugin (`index.mjs`, id
  `gdevelop`): six `gdevelop_*` tools with cross-harness format export (OpenAI, Anthropic, MCP, OpenCode) + `gdevelop-architect` persona, zero
  deps, zero egress (see its README)
- `Formula/` — `gdevelop-unlocked.rb` standalone Homebrew formula for Linuxbrew
- `tests/` — `seams/`, `patches/`, `launcher/`, `tier2/`, `web/`, `integration/`, `e2e/`
- `docs/` — `upstream-ai-provider-rfc.md`, `release-signing.md`, and friends
- `web-userscript/` — web-editor demo userscript (not a delivery path)

## CI

- `seam-tests` — full `npm test` + patcher gate + rebase gate
  (`verify-upstream-rebase.mjs`: full stack vs pristine baseline) against
  the pinned upstream commit
- `e2e` — release-artifact smoke under `xvfb` (`tier1-smoke`), OpenAI-contract
  check against the committed mock (`byok-mock`), real Ollama on schedule (`byok-ollama`)
- `release` — manual dispatch: patched source → full build → smoke gate →
  artifact (and a GitHub release only when `publish=true`)

## Status & provenance

- Upstream baseline: `UPSTREAM_BASELINE.json` (the only pin — there is no
  donor pin; `tests/patches/pins.test.mjs` keeps the workflows on it)
- Retirement plan for the donor fork: `RETIREMENT.md`
- Latest audit verdict: **conditional PASS** (`AUDIT_REPORT.md` §10) —
  235/235 + 5/5 e2e green, rebase gate clean at the pin; remaining work
  is live CI/model/browser proof, not code changes.
