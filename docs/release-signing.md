# Release signing — options (issue #10)

Status 2026-10-11: every release artifact is **unsigned**
(`GD_PORTABLE_BUILD=true`), and the release notes say so. This page
records what signing would take, so the decision can be made once.
Nothing here has been purchased or wired; no secret exists in this repo.

Vendor prices and eligibility rules change — the "verify" notes mark
what was not checked against a current vendor page.

## What users see today

| OS | Unsigned behavior | Workaround in the release notes |
|---|---|---|
| Windows | SmartScreen "Windows protected your PC" on the installer; browsers may flag the download | "More info → Run anyway" |
| macOS | Gatekeeper refuses a quarantined download ("cannot be opened" / "is damaged") | right-click → Open, or `xattr -dr com.apple.quarantine "GDevelop 5.app"` |
| Linux | none (zip) | — |

The macOS app is **ad-hoc signed** in CI (`codesign --sign -`). That is
not a publisher signature: it needs no certificate, identifies no one,
and exists only because Apple Silicon will not execute code with no
signature at all.

## What the build already supports (read from upstream at the pin)

`newIDE/electron-app/electron-builder-config.js` switches on environment
variables; this repo only sets `GD_PORTABLE_BUILD`:

- `GD_PORTABLE_BUILD=true` → `mac.identity = null`, hardened runtime off,
  `afterSign` hook removed, Windows `.exe` excluded from signing.
- Without it, Windows signs with `signtool` when
  `GD_SIGNTOOL_SUBJECT_NAME` + `GD_SIGNTOOL_THUMBPRINT` (+ `SIGNTOOL_PATH`)
  are set — i.e. a certificate already loaded in the runner's store.
- Without it, macOS signs with the identity electron-builder finds
  (`CSC_LINK` / `CSC_KEY_PASSWORD`), and
  `scripts/electron-builder-after-sign.js` notarizes when `APPLEID`,
  `APPLEIDPASS`, `APPLETEAMID` are set (it skips quietly when `APPLEID`
  is absent).

So upstream's build code needs no change — but `release.yml` does, and
differently per OS:

- **Windows:** supply the credentials as GitHub Actions secrets and drop
  `GD_PORTABLE_BUILD` for `build-windows`.
- **macOS:** the same, **and remove the ad-hoc step.** `build-macos`
  builds the bare `.app` (`--mac dir`), then runs
  `codesign --force --deep --sign -`, which would *replace* a Developer
  ID signature with an ad-hoc one — after notarization, at that. A signed
  macOS job must build the normal targets, skip that step, and verify
  what it actually ships (`codesign --verify --deep --strict`,
  `spctl --assess --type execute`, `xcrun stapler validate`) before
  upload.

## Options

| # | Option | Covers | Needs | Notes |
|---|---|---|---|---|
| 0 | Stay unsigned + publish `SHA256SUMS.txt` | all | nothing | What `release.yml` does now. Integrity only if the user checks the sums. |
| 1 | GitHub build-provenance attestations (`actions/attest-build-provenance`) | all | `id-token: write` + `attestations: write` on the build jobs; no secret | Proves "this file was built by this workflow from this commit" (`gh attestation verify`). Does **not** quiet SmartScreen or Gatekeeper. Free on public repos (verify). Cheapest real improvement. |
| 2 | Windows Authenticode via a cloud-HSM certificate (upstream uses SSL.com eSigner; DigiCert KeyLocker is the same idea) | Windows | Paid OV/EV certificate bound to a legal identity; signing credentials as secrets | Private keys must live on hardware/cloud HSM, so there is no `.pfx` to store. SmartScreen reputation still builds over time for OV. Verify price and validation requirements. |
| 3 | Microsoft's managed signing service (Azure Trusted Signing) | Windows | Azure subscription + identity validation; service credentials as secrets | Lower cost than a CA certificate; eligibility is restricted by country and organization history (verify). |
| 4 | SignPath Foundation (free signing for open-source projects) | Windows | Application + their build-origin policy | Their terms decide whether a project qualifies (verify before assuming). |
| 5 | Apple Developer ID + notarization | macOS | Apple Developer Program membership (paid, annual); Developer ID Application certificate as `CSC_LINK`/`CSC_KEY_PASSWORD`; `APPLEID`/`APPLEIDPASS`/`APPLETEAMID` | The only way to remove the Gatekeeper block. Notarization submits every build to Apple under that account. |

## Things to decide before buying anything

- **Whose name goes on it.** A publisher signature states a legal
  identity to every user and to Microsoft/Apple. Options 2, 3 and 5 all
  require one.
- **Identity collision with upstream.** The build still calls itself
  `GDevelop 5` with bundle id `com.gdevelop-app.ide` (both upstream's).
  Signing that under a different publisher, or submitting it for
  notarization, puts a third party's product name under your
  certificate. A signed release should probably carry its own product
  name and bundle id first — that is a patch-stack change, not a
  workflow change. This is a risk flag, not legal advice.
- **Account exposure.** Notarization and CA validation tie the release
  to an account that the vendor can revoke.

## Recommendation

1. Keep option 0 for the first release (already implemented and
   disclosed).
2. Add option 1 next — no cost, no identity, no secret, and it can be
   proven on a `publish=false` run before it matters.
3. Treat options 2–5 as a deliberate owner decision, after the naming
   question above is settled.

## CI runner health + pre-release drift gate (T12, issues #10 #13)

Reviewed 2026-10-12 against `release.yml` / `seam-tests.yml` at the
`8301cdcaa4` pin. No workflow changes needed for signing either way —
this section records the confirmation so the next rebase does not
re-derive it.

- **Windows** (`build-windows`, `windows-latest`): builds **nsis + zip**
  (`--win nsis zip --x64`), unsigned portable. Renderer/electron
  `npm install` drops lockfiles per upstream's own Windows CI note
  (`setuptools` for a native dep). Smoke-gated on the real `.exe`.
- **macOS** (`build-macos`, `macos-latest`): builds the **universal**
  `.app` (`--mac dir --universal`), ad-hoc signed only so the arm64
  slice can launch, then ditto-zipped. Smoke-gated on the real binary.
- **Pinning:** `actions/checkout@v4` + `actions/setup-node@v4`
  (Node 22, matching `package.json` engines), `UPSTREAM_REF` default
  equals the `UPSTREAM_BASELINE.json` pin, `GD_PORTABLE_BUILD=true`,
  `REQUIRES_EXACT_LIBGD_JS_VERSION=true`. The `pins.test.mjs` suite
  fails on a partial pin bump, so workflows and baseline cannot drift
  apart silently.
- **Signing-relevant gotcha (unchanged):** a future signed macOS job
  must drop the ad-hoc `codesign --sign -` step (it would replace a
  Developer ID signature) and verify with `codesign --verify --deep
  --strict` + `spctl --assess` + `stapler validate` before upload —
  see "What the build already supports" above.

Pre-release drift check (run any time, changes nothing):

```bash
node scripts/verify-upstream-rebase.mjs   # UPSTREAM_DIR or review/GDevelop
```

It archives a pristine `newIDE/app/src + newIDE/electron-app` copy into
TMPDIR scratch, runs the real driver (`--target`, dry-run-then-apply
plus marker verify) and a read-only `--verify-only` second gate, then
removes the scratch tree. Exit 0 names the clean upstream SHA; exit 1
lists the failing patch file(s). CI runs the same script as the
"Rebase gate" step of `seam-tests.yml` on every push/PR and weekly.
