# patches/ — Tier-1 entitlement unlocks (Phase 2, issue #2)

Stock upstream `app.asar` + these hunks = fork parity for Tier-1, with no
205-file merge treadmill. Applied by `scripts/apply-patches.mjs`
(extract -> patch -> repack); every hunk is gated by the Phase 1 seam suite.

## Files

| Patch | Upstream target(s) | Unlock |
|---|---|---|
| `01-usage-predicate.patch` | `Utils/GDevelopServices/Usage.js` | `hasValidSubscriptionPlan` -> `return true`; seeds `UNLOCKED_HERETEK_SUBSCRIPTION` / `UNLOCKED_HERETEK_CAPABILITIES` (`planId: 'gdevelop_startup'`) |
| `02-auth-context-seed.patch` | `Profile/AuthenticatedUserContext.js` | Import + logged-in/logged-out default seeds |
| `03-subscription-checker.patch` | `Profile/Subscription/SubscriptionChecker.js` | Both closures stubbed to `return true` |
| `04-loading-screen.patch` | `ProjectManager/LoadingScreenEditor.js` | Logo guard + watermark guard/clamp deleted |
| `05-preview-debugger.patch` | `.../LocalPreviewLauncher/index.js`, `.../DebuggerEditorContainer.js` | `% 16` block deleted; network-preview + debugger stubs |
| `06-electron-hook.patch` | `electron-app/app/main.js` (loader line only) + `launcher/*.cjs` sync by the driver | Main-process hook install before the `BrowserWindow` destructure |
| `07-generation-glue.patch` | `Utils/GDevelopServices/Generation.js` (verbatim fork delta) | Tier-2 branch points: `local-ai-*` / `isCustomEndpointEnabled()` routing into the extracted client |
| `08-preferences-ai.patch` | `Preferences{Dialog,Context,Provider}.js` (verbatim fork deltas) + fork-only `PreferencesStorage.js` (new file) | `ai` preferences tab + persistable-preferences leaf (API key never persisted) |

Out of scope: local HTML5/desktop exports (never gated upstream);
online-build quotas (server-enforced); the duration-slider gate
(`LoadingScreenEditor` ~:387, fork-kept).

## Regeneration

Patches are generated, not hand-edited — anchors assert a single match
and fail loudly on drift:

```bash
node scripts/generate-tier1-patches.mjs --upstream review/GDevelop
```

Each generated patch round-trips (`patch -p1 --dry-run` on a pristine
copy) before it is written. Patched output matches the fork byte-for-byte
on 3 of 6 files; the only residuals are intentional non-Tier-1 exclusions:

- `Usage.js` quota type fields (`nextCreditsBackAt`, …) — fork cleanup
- `AuthenticatedUserContext.js` `type` import tweak — fork cleanup
- `LocalPreviewLauncher` `previewContext`/`sourceGameId` — upstream-sync drift
