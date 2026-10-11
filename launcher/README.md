# launcher/ — Tier-1 runtime hook (Phase 3, issue #3)

Runtime guarantee of the Tier-1 unlock when `patches/` alone cannot hold
(a hunk drifted, or the operator runs a stock build). Defense in depth,
three layers:

| Layer | File | Mechanism |
|---|---|---|
| Preload seed | `preload-unlock.cjs` | `webPreferences.preload` **where the export is wrappable**; runs before the bundle: seeds `window.__HERETEK__`, wraps `fetch` + `XHR` for exactly two GET endpoints |
| Window fallback (usual production path) | `heretek-hook.cjs` | `browser-window-created` + `did-finish-load` `executeJavaScript` of the composed fallback source — same wrappers, applied before React hydrates. Production Electron's `BrowserWindow` export is non-configurable, so this (not the preload) carries the unlock there |
| Network backstop | `heretek-hook.cjs` | `webRequest.onBeforeRequest` redirects usage GETs to `data:` URLs. **Not effective on current Electron** — see "Known limits" |

## Known limits (measured on a real build, Electron 32.3.3 / Chromium 128)

- **The network backstop does not serve anything.** Chromium refuses the
  https → `data:` redirect for XHR and fetch (`net::ERR_UNSAFE_REDIRECT`):
  a usage GET that reaches this layer *fails* instead of returning the
  unlocked body. Only requests issued before the window fallback has
  installed its wrappers (or from another realm, e.g. an iframe) reach
  it. The `--heretek-smoke` verdict proves the renderer `fetch` and XHR
  wrappers, not this layer.
- **The renderer wrappers carry the unlock**, installed at
  `did-finish-load`. A usage request the app issues before that point is
  not wrapped (timing residual; not measured — needs a logged-in session).
- The app's own client is axios 0.18.1 over XHR. The smoke probe issues
  an XHR that settles exactly as that adapter does (`readyState === 4`,
  non-zero status), so a fetch-only spoof fails the verdict
  (`XHR limits not unlocked (app client path)`). The wrapper has not been
  observed serving a real logged-in profile fetch.

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

Pick the path by what you are holding. They are not interchangeable.

### A. Source checkout (you will build the app yourself)

```bash
node scripts/apply-patches.mjs --target <upstream-checkout>
```

Applies patch 06 (loader line at the top of `electron-app/app/main.js`)
together with the rest of the stack, and copies the three `.cjs` files
next to `main.js`. This is what `release.yml` builds from. Re-check an
already-patched tree at any time, read-only:

```bash
node scripts/apply-patches.mjs --verify-only --target <patched-checkout>
```

### B. Release artifact (a stock, already-built GDevelop)

A release `app.asar` holds the **bundled** renderer, so source patches
cannot apply to it. The launcher alone is enough for Tier-1 there:

```bash
npx --yes @electron/asar extract <app>/resources/app.asar <workdir>
node scripts/inject-launcher.mjs --appdir <workdir>
npx --yes @electron/asar pack <workdir> <app>/resources/app.asar
```

`inject-launcher.mjs` inserts the loader above the
`const electron = require('electron');` anchor and syncs the three
`.cjs` files. It is idempotent (a re-run is a verified no-op) and fails
loudly if the anchor is gone. This is the path the `e2e` workflow's
`tier1-smoke` job proves on every PR and every push to `main`/`develop`.
Tier-2 (BYOK AI) is **not**
delivered this way — it needs a source build (path A).

### What does not work

`apply-patches.mjs --asar <app.asar>` on a release asar: the driver
extracts it, then every source hunk fails the dry-run against bundled
code. That mode is only meaningful for an asar that holds source with
`newIDE/` at its top level. `--check` runs the seam suite only; it
verifies upstream shape, not an install.

## Verifying a build

Launch with `--heretek-smoke`. The hook rides the first window, probes
the renderer after load, prints one line and exits:

```
HERETEK_SMOKE:{"ok":true,"failures":[],"results":{…}}
```

Exit `0` unlocked, `1` locked (see `failures`), `2` no window within
180 s. The probe checks the seed, both usage GETs over `fetch`, the
limits GET over XHR (the app's real client path), and that a POST is
not intercepted. Headless Linux needs a display (`xvfb-run -a <bin>
--no-sandbox --disable-gpu --heretek-smoke`); see the workflow steps in
`.github/workflows/e2e.yml` and `release.yml` for the exact invocation.
On a machine with a vendor (e.g. NVIDIA) GL stack, Mesa software
rendering can be forced with
`__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
LIBGL_ALWAYS_SOFTWARE=1`; the smoke itself has run green both with and
without it.

## Auto-updater pin

`electron-updater` replaces the whole `app.asar` on update — the loader
line and these files vanish on restart.

- **Builds from `release.yml`** cannot update: the workflow strips the
  update feed before building (`scripts/strip-updater-feed.mjs`) and
  refuses to build if it survives.
- **Stock build + path B** still has the upstream feed. `watchUpdater`
  logs `UPDATER_PIN_MESSAGE` (loud, in all logs) when an update is
  staged and sets `globalThis.__HERETEK__.updatePending`. After the
  update, repeat path B on the new `app.asar` **before** launching.

Do not enable `autoUpdater.autoDownload = true` unattended on hooked
builds: a silent overnight update silently drops Tier-1.

## Test doubles vs production

`tests/launcher/` drives the hook with fake Electron objects. Two
production facts the fakes must reproduce, each pinned by a test in
`hook.test.cjs`:

- `electron.BrowserWindow` is a **non-configurable** getter in real
  Electron. Assignment and `defineProperty` both throw, the wrap returns
  `false`, and the window fallback + network backstop carry the unlock
  (`non-configurable export: wrap fails, fallbacks still deliver…`).
  The `configurable: true` fake only models the wrappable case.
- `session.defaultSession` throws before `app.whenReady()`; `webRequest`
  setup is deferred, not dropped (`defers webRequest setup until app
  ready`).

No fake can prove real Chromium timing (seed before React hydrates);
that is what the `--heretek-smoke` run on a real build is for.
