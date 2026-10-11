# Phase 6: Fork independence — DONE in-repo (issue #6)

The 205-file fork (`Heretek-AI/GDevelop-Heretek`) is no longer referenced
by any build, test, or CI path in this repo. Code independence landed
2026-10-11: donor-comparison tests were replaced with self-contained
integrity pins, the fork clone was removed from CI, and the extractor
was deleted. What remains is owner-side archival of the old repo
(destructive, needs a human — do not close issue #6 until ticked).

## Preconditions (re-verified at independence cutover)

- [x] `npm test` green with the fork checkout absent (no test reads any
      `FORK_DIR`; self-contained `MANIFEST.json` hashes pin the runtime).
- [x] `node scripts/apply-patches.mjs --target <pristine-upstream>` green
      (all 11 patches + launcher sync + Tier-2 overlay + marker verify).
- [ ] Desktop smoke on the patched build: logo uncheck, watermark
      uncheck, hot reload x17, wifi preview, debugger open (issue #2).
- [ ] Desktop E2E: `http://localhost:11434/v1` generation + subagent
      spawn/finalize loop, zero `api.gdevelop.io/generation` calls in
      BYOK mode (issue #4, procedure in `packages/ai-studio/README.md`).

## Retirement steps (human, in order)

1. Delete the daily sync: remove `.github/workflows/upstream-sync.yml`
   from the fork (last sync first — record its commit hash below).
2. Mark the fork read-only: repository Settings → Archive, with the
   description pointing here:
   `Retired as delivery vehicle; Tier-2 donor archive for
   Heretek-AI/GDevelop-Unlocked. Donor commit f7d450a1d9aa068e33c0a0c9a3f9caaee3701f2f.`
3. After archiving, Tier-1 ships only as `patches/` + `launcher/`
   (Phases 2–3); Tier-2 only as versioned `packages/ai-studio`
   (Phase 4). Any future fork-sync need is a `scripts/extract-tier2.mjs`
   re-run + `scripts/generate-tier2-patches.mjs` regeneration, reviewed
   as a normal PR — never a merge treadmill.

```bash
# 1. (in the fork checkout, final state)
git log -1 --format=%H  # record as last-sync hash: ________________
gh workflow disable upstream-sync.yml --repo Heretek-AI/GDevelop-Heretek
# 2. (owner only)
gh repo archive Heretek-AI/GDevelop-Heretek --yes
```

## Post-retirement invariant

The delivery path (patcher, hook, preload, shim, userscript) never
*reads* the fork: the name `GDevelop-Heretek` appears only in historical
provenance notes and in unlock-marker strings shipped by design
(`Unlocked in GDevelop-Heretek`). No test, script, or workflow clones,
reads, or regenerates from a donor checkout — verified: the full suite
passes with no fork fixture present.
