# AGENTS.md — working agreements for AI agents in this repo

## Ground rules

- **Verify, don't assert.** Every claim about code behavior must be backed by
  executed evidence (test output, command output, file reads). Green unit
  tests against mocks do not prove production behavior — say so when true.
- **Never mutate the fixtures.** `review/GDevelop` and
  `review/GDevelop-Heretek` are pinned baselines every test depends on.
  For apply/patch experiments, use a scratch copy:
  `git -C review/GDevelop archive HEAD newIDE/app/src newIDE/electron-app | tar -x -C <scratch>`.
  Confirm `git -C review/GDevelop status --short` is empty when done.
- **Prefer dedicated tools** (`read`/`edit`/`write`) over shell redirection
  for file work. Use `shell` for commands, `node --test` runs, and git/gh.
- **Write findings to disk incrementally** as short entries when doing
  multi-step investigations, so interrupted sessions lose nothing.

## Patch discipline (load-bearing)

- Patches `09/10` are **verbatim generator output** — never hand-edit;
  `tests/tier2/tier2-patches.test.mjs` pins them byte-for-byte.
- Patches `07/08/11` are **curated forward-ports** (`patches/REBASE.md`).
  Never regenerate them with `generate-tier2-patches.mjs` (it emits
  verbatim deltas that revert upstream-new code). The test suite pins them
  with anti-revert assertions instead.
- New Tier-1 hunks belong in `scripts/generate-tier1-patches.mjs`
  (single-match anchors, fail loudly on drift), not hand-written patch files.
- Scratch/temp paths must honor `TMPDIR`/`TMP`/`TEMP` — never hard-code `/tmp`.

## Test commands

```bash
npm test                                    # everything (must be 102/102+)
npm run test:integration                     # tests/integration/ only
node scripts/apply-patches.mjs --check      # seam gate
```

- `tests/integration/` must use real I/O (live `http` servers, real
  wrappers, real patch application) — no mocks of the code under test.
  The suite stays offline: no React/JSDOM (not installed); if a test can't
  execute something, it must state the limit in its header, not fake it.
- If full-suite count changes, say the new count explicitly.

## Repo-specific facts (don't re-derive the hard way)

- Repo root is `"type": "module"` — `.js` files are ESM (`import`, never
  `require`); launcher stays `.cjs` deliberately.
- No `node_modules` in-repo; tests run on bare `node:test` + builtins.
- `packages/ai-studio/dev-harness/` is an ESM **port**, exempt from donor
  byte-identity (see `MANIFEST.json` note + `extract.test.mjs`).
- The driver (`apply-patches.mjs`) owns two install paths: launcher `.cjs`
  sync and Tier-2 overlay (`syncTier2Files`); `--asar` and `--target` must
  both run both. Markers live in `MARKERS` — extend them with any new patch.
- Upstream pin lives in one place: `UPSTREAM_BASELINE.json`
  (`verifiedAtUpstreamCommit`). There is deliberately **no donor/fork pin
  anywhere** — this repo is fork-independent (see `RETIREMENT.md`).
- Patch provenance: 07/08/11 are curated forward-ports of fork work
  (`patches/REBASE.md`); any *new* verbatim delta must still be audited
  for deletions of upstream-new symbols before shipping (the R1–R3
  regression class in `AUDIT_REPORT.md`).
