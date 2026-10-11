# Phase 6: Decommission fork — retirement runbook (issue #6)

The 205-file fork (`Heretek-AI/GDevelop-Heretek`) stops being the
delivery vehicle and stays only as the Tier-2 donor archive. Nothing
here is automated: archiving and workflow deletion are destructive and
need a human owner. Do not close issue #6 until every box is ticked.

## Preconditions (M1 + M2 must hold without the fork present)

- [ ] `npm test` green with the fork checkout absent
      (`FORK_DIR` pointed at an empty dir — only `tests/tier2/extract.test.mjs`
      needs the donor, and only to re-verify byte-identity).
- [ ] `node scripts/apply-patches.mjs --target <pristine-upstream>` green
      (all 8 patches + launcher sync + marker verify).
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
   Heretek-AI/GDevelop-Unlocked. Donor commit b9109cfbaaaf19c31b5af4d315317fb67d8903c3.`
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
*reads* the fork: `GDevelop-Heretek` appears in delivery code only in
provenance comments (`Unlocked in GDevelop-Heretek`) and in donor-dir
defaults owned by the extractor (`scripts/extract-tier2.mjs`,
`scripts/generate-tier2-patches.mjs`) and the two provenance tests
(`tests/tier2/extract.test.mjs`, `tests/tier2/tier2-patches.test.mjs`),
which fail loudly — by design — when the donor is absent. Everything
else in `npm test` is fork-free (verified: 63 pass with `FORK_DIR`
pointed at an empty dir; the 1 failure + 2 cancellations are the
donor-provenance tests failing loudly by design — not silent drift).
