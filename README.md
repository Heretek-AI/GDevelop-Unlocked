# GDevelop-Unlocked

Surgical, patch-stack conversion of the
[GDevelop-Heretek](https://github.com/Heretek-AI/GDevelop-Heretek) fork
(unlocked premium gates + Bring-Your-Own-Key local AI studio) into a
maintainable delivery shape — no 205-file merge treadmill.

Three delivery mechanisms, all applied onto stock upstream GDevelop:

| Mechanism | Lives in | What it does |
|---|---|---|
| **Tier-1 patches** (`01`–`06`) | `patches/` | Curated minimal hunks: subscription/capability unlocks, checker no-ops, logo/watermark + preview/debugger gate removal, Electron loader line |
| **Tier-2 glue** (`07`–`11`) | `patches/` + `packages/ai-studio/` | Fork's BYOK AI routing ported as patches; runtime (`CustomAIClient`, 12 Studio modules) extracted verbatim into `packages/ai-studio/` and overlaid by the driver |
| **Launcher hook** | `launcher/` | Main-process preload injection + `fetch`/XHR spoof + `webRequest` backstop, so a stock build unlocks at runtime |

Patches `07/08/11` are **curated forward-ports** (see `patches/REBASE.md`);
`09/10` are verbatim fork deltas. Full audit trail: `AUDIT_REPORT.md`.

## Quickstart

```bash
npm test                                   # full suite (unit + integration), offline
node scripts/apply-patches.mjs --check     # seam gate only, no filesystem changes

# Apply everything to a pristine upstream checkout:
node scripts/apply-patches.mjs --target <upstream-checkout-or-extracted-asar>

# Release-asis path (bundled code — source hunks can't apply):
node scripts/inject-launcher.mjs --appdir <extracted-asar-dir>
```

Requirements: Node ≥ 22, `patch`, git. Test fixtures (`review/GDevelop`,
`review/GDevelop-Heretek`, multi-GB) are gitignored; CI clones its pins.

## Layout

- `patches/` — 11 patches + `README.md` (per-patch targets) + `REBASE.md`
- `scripts/` — `apply-patches.mjs` (driver), `generate-tier1/2-patches.mjs`
  (generators), `extract-tier2.mjs`, `inject-launcher.mjs`
- `launcher/` — `heretek-hook.cjs`, `preload-unlock.cjs`, `unlock-payloads.cjs`
- `packages/ai-studio/` — extracted Tier-2 runtime + `dev-harness/` mock provider
- `packages/unlock-shim/` — routing/leak-guard invariants (reference impl)
- `tests/` — `seams/`, `patches/`, `launcher/`, `tier2/`, `web/`, `integration/`
- `docs/` — `upstream-ai-provider-rfc.md` and friends
- `web-userscript/` — web-editor demo userscript (not a delivery path)

## CI

- `seam-tests` — full `npm test` + patcher gate against pinned upstream/fork commits
- `e2e` — release-artifact smoke under `xvfb` (`tier1-smoke`), OpenAI-contract
  check against the committed mock (`byok-mock`), real Ollama on schedule (`byok-ollama`)

## Status & provenance

- Upstream baseline and donor pin: `UPSTREAM_BASELINE.json`
- Retirement plan for the donor fork: `RETIREMENT.md`
- Latest audit verdict: **conditional PASS** (`AUDIT_REPORT.md` §7) —
  remaining work is live CI/model/browser proof, not code changes.
