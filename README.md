# Proof of Typeface

**know what your text actually wears.** A pre-export lie detector for fonts. `document.fonts.check('16px Arial')` answers `true` for faces your machine does not have, because it only checks that *some* face will accept the request — so a document that says Georgia and renders Liberation Serif looks perfectly correct right up until it exports. Proof of Typeface renders each declared font family to an offscreen canvas, hashes the pixels, and compares that hash to the pixels of generic stand-ins (`serif`, `sans-serif`, `monospace`, Arial-as-generic-sans): identical hashes mean the browser read your font name and ignored it. A seeded marketing one-pager carries the truth for every run — declared vs measured, ink pixels, glyph hashes, wrap-fingerprint deltas under the export substitute face, a fixed-height page-spill meter — and a **waiver-gated export gate** blocks the Export button (disabled + counted) until every flagged run is fixed by a real family swap or signed away by a human reason. All measurement runs on a separate **proof origin** reached over the WebMCP cross-origin tool bridge (`getTools({fromOrigins})` → `executeTool` by name), with a static-host single-origin fallback.

## Run the demo

```bash
# single-origin, easiest: python3 ../../kit/serve.py --app .
# multi-origin (the real thing: separate proof origin + cross-origin tools) — run the harness from the repo root:
cd ../.. && python3 kit/harness.py --app apps/typeface
```

Then open the `main` URL the harness prints, click a run underlined in red, and either waive it in the modal or run `substitute_safe` from the Simulate Agent panel. The Export button unlocks only when nothing is flagged.

## How agents use it

16 tools on the main origin — `doc_get`, `run_list`, `run_audit`, `explain_diff`, `substitute_safe`, `waiver_add`, `waiver_remove`, `waiver_list`, `export_gate`, `export_document`, `metrics_report`, `page_spill`, `doc_edit`, `proof_verdicts`, `reset_document`, and the declarative form tool `doc_find` — plus 5 exposed to main on the proof origin (`proof_glyph_hash`, `proof_metrics`, `proof_compare`, `proof_font_check`, `proof_export_preview`) and one deliberately unexposed `decoy_proof`. The main page calls the proof tools cross-origin via the kit (`mc.getTools({fromOrigins})` then `mc.executeTool(name, input)`); the Simulate Agent panel and the tests use the same `window.__agent` path.

```js
await window.mc.registerTool({
  name: 'run_audit',
  title: 'Audit runs via proof origin',
  description: 'Full truth table. For each run, asks the PROOF ORIGIN for proof_glyph_hash and ' +
    'proof_metrics (cross-origin), so every hash/width/wrap number carries originLabel "proof".',
  inputSchema: { type: 'object', properties: { family: { type: 'string' } } },
  annotations: { readOnlyHint: true, openWorldHint: false },
  execute: async (input) => { /* cross-origin audit, gate mirrors the DOM */ }
}, { signal: ac.signal });
```
