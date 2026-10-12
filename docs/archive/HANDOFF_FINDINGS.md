# Handoff findings log — 2026-10-11 (untracked working notes)

Branch: `handoff/verify-and-tracker-2026-10-11` (cut from `main` @ 6912f56).

## Phase 1 — verification (all pass)

- 1a `npm test`: 102/102 pass, 34 suites, 0 fail.
- 1b `node scripts/apply-patches.mjs --check`: seam suite 29/29, exit 0.
- 2 scratch full-apply (git-archive copy of `review/GDevelop` @ 8301cdc):
  14 dry-run clean, 14 applied, 3 launcher synced, 13 Tier-2 synced,
  `[verify]` green. Re-apply: exit 1 ("Reversed (or previously applied)
  patch detected" on 01). Fixture `git status --short`: empty.
- 3 negative control (patch 12 held out): import-closure test exit 1,
  failure list names `canStartAiRequestCreate` (+11 other missing
  exports). Patch restored, sha256 verified, `git status` clean.
- 4 fork-reference grep over `tests/ scripts/ .github/`: 8 hits. 7 are
  unlock-marker strings. 1 is code, not a comment:
  `scripts/generate-tier2-patches.mjs:44` defaults `--fork` to
  `review/GDevelop-Heretek`. Nothing invokes that script (no test, no
  workflow, no package.json script), so nothing reads the fork at runtime.
- 5 tracker/CI: open = #6 #7 #8 #10 #11 #12 #13 #14; closed = #1–#5;
  #9 is the merged PR. Release run 38106050979 = success, ref
  8301cdcaa4…, publish step skipped, smoke `"ok": true`. Latest `e2e`,
  `seam-tests`, `CodeQL` on main @ 6912f56 all success.

## Phase 1 — discrepancies (none blocking)

- D-a Handoff says "confirm tracker/CI state matches Part C below" —
  there is no Part C in the file (only Parts A and B). Compared against
  Part A + the Phase 2 issue list instead; consistent.
- D-b Handoff Part A says "11 applied + 3 launcher + 13 Tier-2"; actual
  is 14 applied. Same stale "11 patches" count in `README.md` (also
  "Tier-2 glue (07–11)"), `RETIREMENT.md`, `release.yml` release body,
  `AUDIT_REPORT.md` header (historical).
- D-c `AGENTS.md` ground rules still name `review/GDevelop-Heretek` as a
  pinned fixture "every test depends on"; it does not exist and nothing
  reads it. `README.md` CI section says "pinned upstream/fork commits"
  and "Upstream baseline and donor pin".
- D-d `generate-tier2-patches.mjs` scratch fallback is the literal
  `/tmp/opencode` (AGENTS.md: never hard-code `/tmp`); same check needed
  on `generate-tier1-patches.mjs`.
- D-e `[verify]` success line says "all Tier-1 unlock markers" but
  covers Tier-2 markers + overlay too (cosmetic).
- D-f **Upstream moved**: `4ian/GDevelop` HEAD is `ce7be6913f…`, pin is
  `8301cdcaa4`. Behavior check against HEAD pending (see #13 below).

## #13 — upstream drift check (done early; result: no rebase needed)

- Upstream HEAD `ce7be6913f` (2026-10-11, #9218) is exactly 1 commit
  ahead of pin `8301cdcaa4`; compare API: 2 files changed, none under
  `newIDE/`.
- Against a scratch sparse clone of HEAD (fixture untouched):
  seam suite 29/29; `apply-patches --target` 14/14 applied + verify
  green (exit 0); `UPSTREAM_DIR=<head> npm test` 102/102.
- Conclusion: pin hash is one commit stale but behavior matches. Pin NOT
  bumped (bump is part of the human-gated rebase checklist and needs a
  publish=false validation build).

## #14 — hygiene tail (done; 6 commits f5db650..d718216)

- Suite now 121/121, 37 suites (was 102/34). Seam gate green, fixture clean.
- S2: shim README was false (patch 07 inlines, never imports). Documented
  the duplication contract; `tests/integration/shim-wiring-contract.test.mjs`
  (5 tests) pins it on a real patch-07 apply, negative control = pristine.
- **NEW FINDING (product, not fixed)**: `createAiAttachmentUploads` /
  `createAiAttachmentDownloads` in patched `Generation.js` have no BYOK
  branch; the 3 callers under `AiGeneration/AiAttachments/` have no BYOK
  awareness either. A chat attachment in BYOK mode goes to the hosted
  Generation API. Source-level evidence only; UI reachability unproven.
  Pinned as `unguarded` in the contract test. Belongs to #12 zero-egress.
- Also by design, not zero-egress: logged-in user + custom endpoint still
  calls hosted `/ai-request-summary` and status for hosted ids.
- G3: driver `--verify-only --target`; apply.test applies with verify on
  + 4 negative controls (LEFTOVER gate, MISSING marker, STALE Tier-2,
  MISSING launcher).
- D1: launcher README rewritten; `UPDATER_PIN_MESSAGE` no longer
  prescribes `apply-patches --asar` (cannot work on release asar).
- G4: non-configurable `BrowserWindow` fake + test (wrap fails, both
  fallbacks still seed).
- Generators: mkdtemp under `os.tmpdir()`; `--fork` required (no default
  donor path). Verified byte-identical: 01–06 regenerate, 09/10
  round-trip via synthetic donor. New `generate.test.mjs`, `pins.test.mjs`.
- SonarCloud (advisory: `main` has no required checks; ruleset only blocks
  deletion + non-FF). 41 bug/vuln issues via public API. PR #9 gate
  failed on new_security_rating=E, new_reliability_rating=C.
  Fixed here: S5443 x7 CRITICAL (generator tmp), S9383 BUG (hook promise).
  To fix in #10 workflow pass: S8482 BLOCKER (`curl | sh` ollama),
  S6506, S7637 (unpinned softprops action), npx on-demand installs.
  Residual, needs owner UI accept or rule tuning: S4036 x9 (PATH lookup
  for `patch`/`diff`/`git`/`node` — inherent), S2245 x6 (Math.random ids
  in hash-pinned CustomAIClient.js), S8707 x2 (CLI path arg by design),
  S5122 x1 (CORS * in dev mock), S6505 on release `npm install`
  (upstream build needs lifecycle scripts).
  `.sonarcloud.properties` only takes effect from the default branch and
  only scopes paths — not added (untestable here, marginal gain).
- CI uses Node 20 (seam-tests, e2e); `engines` says >=22; release uses 22.

## #12 — layer-3 proofs on this machine (in progress)

Setup: CI artifact from run 38106050979 (`gdevelop-5.6.283.zip`, sha256
886aa23a…5262a0, all 14 patches) unpacked in scratch; run under
`xvfb-run` + `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
LIBGL_ALWAYS_SOFTWARE=1`, isolated `HOME` + `--user-data-dir`. Driven over
`--remote-debugging-port` with a ~90-line Node CDP client (scratch only).
Electron 32.3.3 / Chromium 128.0.6613.186.

- PROVEN local smoke: `--heretek-smoke` → exit 0,
  `HERETEK_SMOKE:{"ok":true,…limits 999, gdevelop_startup, POST 403 not spoofed}`.
- PROVEN (real Electron): `BrowserWindow export not wrappable (Cannot
  redefine property)` → fallback path is THE production path.
  `window.__HERETEK__.unlocked === true` in the live renderer.
- **BUG FOUND + FIXED (381e486)**: spoofed XHR GETs never settle in real
  Chromium. Before: `readyState 1, status 0`, only `onreadystatechange`
  (at state 1) + `onload` called; `loadend`/listeners never. axios
  0.18.1 (upstream's client for `/limits`, `/subscription-v2`) settles
  only at readyState 4 → hangs forever. Cause: sloppy-mode fallback
  source + assign-then-catch. After (fixed launcher re-injected with
  `inject-launcher --appdir`, same build): readyState 4, status 200,
  maxCloudProjects 999 / planId gdevelop_startup, events
  readystatechange→load→loadend incl. listeners; POST and other
  endpoints pass through (real 403). Suite 123/123.
  NOT proven: a real logged-in profile fetch (no account used).
- **FINDING (documented, not fixed)**: webRequest backstop is dead on
  Chromium 128 — pristine-realm XHR + fetch to the usage GETs fail with
  `net::ERR_UNSAFE_REDIRECT` (https→data: refused). It fails requests
  instead of serving them. The README's "proven live" claim was the
  fetch wrapper, not this layer. Untested idea for the owner:
  `session.defaultSession.setPreloads([preload])` gives a true preload
  on every window without wrapping BrowserWindow (removes the
  did-finish-load timing residual).
- Login-time consequence (source reading, `AuthenticatedUserProvider.js`
  ~:403–470): limits/subscription fetches are fire-and-forget `.then`s,
  so a hung XHR leaves both unset with no error.
- Smoke probe extended with an axios-0.18-style XHR (a321bdc). Live:
  fixed preload → ok:true, xhr 200/999, exit 0; original preload →
  ok:false "XHR limits not unlocked (app client path): never settled",
  exit 1. Suite 124/124.
- DISCREPANCY vs handoff: plain `xvfb-run` (no Mesa override) did NOT
  crash here — smoke exit 0, ok:true. Override not needed for the smoke
  with `--disable-gpu`; I used it for the long UI session anyway.

Desktop smoke on the real patched build (CI artifact renderer + fixed
launcher re-injected; logged out; local project in isolated HOME):
- PROVEN logo uncheck + watermark uncheck: real clicks, boxes
  [true,true]→[false,true]→[false,false], 0 extra dialogs, no paywall
  text; Apply; reopened dialog reads [false,false].
- PROVEN 18 consecutive hot reloads (Update button; 18 ×
  "[LocalPreviewLauncher] Triggering hot reload" in console), dialog
  count 0 after every one. Upstream would gate #1 and #17.
- PROVEN network preview (F8): "Your preview is ready!
  http://192.168.31.27:2929", no paywall; `curl 127.0.0.1:2929` → 200.
- PROVEN debugger (F6): Debugger tab, `preview-ws-1 (Playing)`,
  "Debugger connection open", 0 dialogs.
- Also seen: Wallet 999999 on Create page (unlocked credits seed).

BYOK E2E on the same build (Preferences → AI Settings, real UI):
- PROVEN config UI: toggle + Base URL + model persisted to
  `gd-custom-ai-config` (no apiKey field stored); "Successfully
  connected to endpoint" for both mock and Ollama.
- PROVEN sub-agent loop with the committed mock
  (`MOCK_SCRIPT=mock-script-multi.json`): orchestrator request
  `local-ai-…`, userId `local-byok-user`, tool calls
  create_or_update_plan + spawn_agent×3; 3 children persisted with roles
  designer/developer/tester, all `ready`; 8 POSTs to the mock.
  NOT with a real model (a 0.5b model cannot drive orchestration).
  LoopGuard not specifically triggered.
- PROVEN generation against a real local model: Ollama 0.34.3,
  `qwen2.5:0.5b` (pulled for the test, removed afterwards), project
  open; request `ready`, assistant text returned; 2 POSTs to
  localhost:11434.
- PROVEN zero generation egress for these flows: 83 renderer requests
  recorded over the whole session, 0 to `api.gdevelop.io/generation`,
  0 presigned/ai-user-content/attachment. Scope: logged out, text-only.
  NOT covered: logged-in + custom endpoint (hosted summary listing is
  by design), chat attachments (unguarded at source level).
- Observed, upstream behavior: 6 POSTs to `us.i.posthog.com` (analytics)
  during the session incl. after BYOK sends; payload not inspected.
  Other hosted calls: `game/resource-signed-url` (template thumbnails),
  `usage/subscription-plan*` catalogue, gravatar, image CDNs.
- Side effects left behind: `/tmp/GDTMP-1000/preview` (GDevelop's own
  preview temp dir). Ollama restored to its prior model list.

## #10 — release hardening (commits 9ceb42e, 56d966f, bc8a67b; pushed)

- **FINDING + FIX**: CI artifact contains `resources/app-update.yml`
  (`owner: 4ian, repo: GDevelop, provider: github`). The strip deleted
  the `publish` key; electron-builder 26.4.0 then derives the feed from
  package.json `repository` (read `PublishManager.js` from the published
  package: `getPublishConfigsForUpdateInfo`, "default publish config is
  github, file should be generated regardless"). Only `publish: null`
  returns null there. Inert on Linux zip (log: "not an AppImage"); would
  be live on Win NSIS / macOS. Strip now sets `publish: null`, evaluates
  the config, refuses a keyless config. Each OS job asserts no
  `app-update.yml` under `dist/`. Local check: app with the file
  removed boots, smoke ok:true.
- **FINDING + FIX**: green Linux run built with `master/latest`
  libGD.js, not the pinned commit's (detached HEAD → `unknown-branch`,
  5 failed lookups, fallback; from the run log). Per-commit builds exist
  on S3 for 8301cdc, ce7be69 and the v5.6.283 tag (HEAD requests → 200).
  Now `checkout -B master` + `REQUIRES_EXACT_LIBGD_JS_VERSION=true`.
- Win job mirrors upstream `.circleci/config.yml` build-windows
  (setuptools, drop lock files); mac job builds `--mac dir --universal`,
  ad-hoc signs, smokes, `ditto` zips. `GD_PORTABLE_BUILD` → identity
  null + afterSign undefined (and the hook itself skips without
  `APPLEID`) — notarization skipped by construction; CI to confirm.
- `npm ci` NOT adopted: upstream itself deletes lock files on Windows
  and uses `npm install` everywhere; Sonar S8543/S6505 on release.yml
  stay as accepted residuals.
- Validation runs on the branch (publish=false): release 38169760800,
  e2e 38169762424, seam-tests 38169764070.
- e2e 38169762424 @757ddba: tier1-smoke ✅ (stock v5.6.283 + launcher,
  verdict includes `xhr 200/999`), byok-mock ✅, byok-ollama ✅ (pinned
  image service container). seam-tests 38169764070 ✅ on Node 22.

## #13 / #7 / #6 (bd71e54, 6b21bc7; pushed)

- #13: runbook at top of `patches/REBASE.md`; recipe run as written vs
  upstream HEAD → 128 pass / 1 skip, apply green. Pin not bumped.
- #7: `docs/upstream-drafts/credit-read-hardening.{diff,md}`; diff
  applies to upstream@8301cdc (`git apply --check`), +31/−6, no BYOK
  strings. NOT SENT. Upstream flow/jest not run (no node_modules).
- #6: fork not archived, `upstream-sync.yml` active, HEAD f7d450a1
  (read-only checks). In-repo grep on branch: marker strings only.
- Issue comments posted on #14 #12 #13 #7 #6; boxes ticked on #14 (4/5)
  and #12 (6/8). AUDIT_REPORT §9 added.

## Release validation run 38169760800 (@757ddba, publish=false) — ALL GREEN

- build-linux ✅ 16 min: `set publish: null`; libGD.js downloaded for
  HEAD on first try; "no app-update.yml in build output."; smoke ok:true
  with xhr 200/999.
- build-windows ✅ 22 min: nsis `GDevelop 5 Setup 5.6.283.exe` + zip,
  "file signing skipped via signExts"; no feed; smoke ok:true (xhr ok,
  POST 403 not spoofed) on `win-unpacked/GDevelop.exe`.
- build-macos ✅ 21 min: "skipped macOS code signing reason=identity
  explicitly is set to null" + "arm64 requires signing, but identity is
  set to null" → ad-hoc sign step: valid on disk, `Signature=adhoc`,
  `TeamIdentifier=not set`, `x86_64 arm64`; notarize hook never ran;
  smoke ok:true; zip 269M.
- publish: skipped. Never exercised.
- Issues: #10 (3/4 ticked) and #11 (3/6 ticked) updated + commented.

## Follow-up session: PR #15 + attachment fix (A2) + review fixes

- PR #15 opened (branch → main). MERGEABLE.
- A2 FIXED in patch 07 (38fce1a): `createAiAttachmentUploads` throws
  before any hosted call when endpoint enabled or user `local-*`;
  `createAiAttachmentDownloads` → not-found for `local-*`. Re-derived
  with plain `diff -U3` (reproduces the old patch byte-for-byte; new one
  differs only by the two insertions; minus-lines 66 = unchanged).
  Reachability: only logged-in + endpoint on (`UseAiAttachmentDrafts`
  refuses when `!profile`). Not exercised live (needs login).
  Release run 38172371449 (linux, publish=false): "Compiled
  successfully", verify + smoke ok. Guard string found in the shipped
  `app.asar` bundle, throw precedes auth header + POST; zip has no
  app-update.yml.
- CodeQL on PR flagged `js/file-system-race` in strip-updater-feed
  (check-then-write). Fixed with a single fd (ab3c405); alert 22 →
  fixed, CodeQL green.
- SonarCloud on PR: reliability A (was C); security C (was E) — 6 MAJOR
  residuals: S6505/S8543 ×2 each (`npm install` in release.yml), S8707
  ×2 (CLI path arg in strip-updater-feed + assert-smoke-verdict). Gate
  stays red by design; owner accepts or uninstalls.
- CodeRabbit review, valid points fixed: XHR reuse keeps spoofed state
  (becd5a2, red test first); contract test holes — offline-user branch
  + stray hosted calls (2017aee, negative controls); run-wide
  SHA256SUMS going stale on partial publish → per-OS sums files;
  persist-credentials/permissions; signing doc macOS claim; audit
  report "how to read" pointer (5131080). Suite 131/131.
- Validation run after workflow change: release 38173968043 @5131080.

## Branch state check (after all commits)

129/129, seam gate green, 14 applied, `--verify-only` green, re-apply
exit 1, negative control names `canStartAiRequestCreate`, patch 12
restored (sha ok), tree clean, fixture clean.
