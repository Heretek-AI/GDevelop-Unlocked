# launcher/ — Tier-1 runtime hook (Phase 3, issue #3)

Runtime guarantee of the Tier-1 unlock when `patches/` alone cannot hold
(e.g. a hunk drifted, or the operator runs a stock build). Defense in
depth, three layers:

| Layer | File | Mechanism |
|---|---|---|
| Preload seed | `preload-unlock.cjs` | `webPreferences.preload`, runs before the bundle: seeds `window.__HERETEK__`, wraps `fetch` + `XHR` for exactly two GET endpoints |
| Window wrap | `heretek-hook.cjs` | Wraps `electron.BrowserWindow` (loader runs before the main.js:6 destructure), `browser-window-created` + `did-finish-load` fallback for pop-outs/preview |
| Network fallback | `heretek-hook.cjs` | `webRequest.onBeforeRequest` redirects usage GETs to `data:` URLs |

## Why not `Module._load`?

The issue draft proposed intercepting `Module._load` for the Usage
module. Production renderers execute a **webpack bundle**, not Node
modules, so that intercept cannot reach `hasValidSubscriptionPlan`.
The app's axios client rides on XHR, and `AuthenticatedUserProvider`
hydrates context from `GET /limits` + `GET /subscription-v2` — spoofing
exactly those two responses unlocks every downstream gate on a stock
build. Only those two GETs are ever intercepted; generation, builds,
auth, and all mutations pass through untouched.

## Payload contract

`unlock-payloads.cjs` is the single source of truth, also serialized
into patch 01 by `scripts/generate-tier1-patches.mjs`:

- `GET {base}/limits` → `{quotas:{}, capabilities, credits:{userBalance:{amount:999999},…}}`
  (satisfies `ensureObjectHasProperty(…, 'capabilities')`)
- `GET {base}/subscription-v2` → `{userId:'local-byok-user', planId:'gdevelop_startup',…}`
  (satisfies `ensureObjectHasProperty(…, 'userId')`)

## Install

`node scripts/apply-patches.mjs --target <checkout>` (or `--asar`) applies
patch 06 (loader line at the top of `main.js`) and syncs these three
files next to it. Verify with `node scripts/apply-patches.mjs --check`.

## Auto-updater pin

`electron-updater` replaces the whole `app.asar` on update — the loader
line and these files vanish on restart. Mitigations, in order:

1. `watchUpdater` logs `UPDATER_PIN_MESSAGE` (loud, in all logs) when an
   update is staged, and sets `globalThis.__HERETEK__.updatePending`.
2. After every update, re-run
   `node scripts/apply-patches.mjs --asar <new-app.asar> --out <patched.asar>`
   **before** launching. The driver refuses a silent no-op.
3. The Phase 1 seam suite (`npm test`) runs weekly against the upstream
   baseline — a red suite after an upstream release means the loader
   anchor or a hunk moved; regenerate before repacking.

Do not enable `autoUpdater.autoDownload = true` unattended on hooked
builds: a silent overnight update silently drops Tier-1.
