# web-userscript — web demo, optional (Phase 5, issue #5)

Zero-install demo on `editor.gdevelop.io` only — not a delivery path for
the Studio loop. Non-blocking for Phase 6.

## Mechanism (Vector D)

`heretek-unlock.user.js` (Tampermonkey/Violentmonkey, `@run-at
document-start`): taps the `window.webpackChunk*` registry (convention
frozen by `tests/seams/electron.seam.test.mjs`) to **re-apply** `fetch` /
`XHR` wrappers on every chunk push — deliberately no module-factory
surgery (hash churn would break it on each rebuild). Spoofs only the two
Tier-1 GETs (`usage/limits`, `usage/subscription-v2`); generation is
untouched. A floating widget persists the BYOK base URL to the same
`gd-custom-ai-config` key the desktop client reads.

## Ollama CORS setup (required for any BYOK call from the web demo)

The editor page is `https`; Ollama serves `http://localhost:11434`, so
the browser blocks calls unless Ollama allows the origin:

```bash
OLLAMA_ORIGINS=https://editor.gdevelop.io ollama serve
```

Without this, Tier-1 unlocks still work but every BYOK generation fails
with a CORS error in the console. Desktop builds do not need this.

## Known limits

- LAN preview unreachable from the hosted page (private IPs are not
  routable from `editor.gdevelop.io`) — use desktop for wifi preview.
- No filesystem access; the Studio sub-agent loop is desktop-only.
- Chunk-hash churn may require reinstalling wrappers (handled
  automatically) but can break the demo on any web rebuild.
