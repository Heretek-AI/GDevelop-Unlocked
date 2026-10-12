# SonarCloud triage (ticket T01, issues #14 / #26)

Date: 2026-10-12. Branch: `ticket-T01` (merge target `integration/v0.2`).

## Verified state

- No `.sonarcloud.properties` / `sonar-project.properties` exists in the
  repo (checked 2026-10-12: neither file present, no `sonar` references in
  `.github/workflows/`). No Sonar exclusions are configured in code.
- SonarCloud is **advisory only**: `main` has no required checks (ruleset
  blocks only deletion and non-fast-forward), so a red Sonar gate never
  blocked a merge. Per issue #14, "bypassed" meant merging with a red
  advisory check.
- The S2/G3/D1/G4 hygiene items from #14 were already closed on the
  handoff branch (shim-wiring contract test, `--verify-only` + negative
  controls, launcher README rewrite, non-configurable fake test).

## Residuals (accepted, owner action only)

Per the #14 thread, after PR #15 Sonar reports Reliability **A** (was C)
and Security **C** (was E); blocker and all criticals are gone. What
remains is 6 MAJOR findings of two kinds that cannot be fixed in code
without harming the product:

1. `npm install` with lifecycle scripts in `release.yml` (x4) —
   upstream's own build needs lifecycle scripts (and upstream deletes
   the lock files on Windows). Removing them breaks the release build.
2. "Path from a CLI argument" (x2) — CLI scripts whose argument is
   legitimately a path (`apply-patches --target`, `inject-launcher
   --appdir`). Sanitization beyond current validation would break the
   tool's contract.

Earlier triage on the same thread also accepted as inherent: S4036
(PATH lookup when spawning `patch`/`diff`/`git`/`node`), S2245
(`Math.random` request ids in hash-pinned `CustomAIClient.js`), S8707
(CLI directory argument), S5122 (CORS `*` in the dev-only mock),
S6505/S8543 (same lifecycle-script class). CodeQL stays strict and
green (one real race in `strip-updater-feed.mjs` was fixed).

## Decision (owner-only, not committable)

No code change in this ticket can turn the gate green: the remaining
findings need an "Accept"/"Safe" click each in the SonarCloud UI, rule
tuning ("A on new code" goes red on any PR adding a `spawnSync` to
`scripts/`), or uninstalling SonarCloud. Deliberately **no**
`.sonarcloud.properties` was added: it only scopes paths, only takes
effect from the default branch, and could not be tested from a ticket
branch (per #14). This file documents the accepted residuals; the
UI-side accept/uninstall step is the owner's.
